const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
app.use(express.static('public'));
app.use(express.json());

// Map of jobId -> resolve function for interactive stealth pause
const pendingContinue = new Map();

// Called by the UI "Continue" button to resume a paused stealth job
app.post('/api/continue/:jobId', (req, res) => {
    const { jobId } = req.params;
    const resolve = pendingContinue.get(jobId);
    if (resolve) {
        pendingContinue.delete(jobId);
        resolve();
        res.json({ ok: true });
    } else {
        res.status(404).json({ error: 'Job not found or already continued' });
    }
});

// Pre-initialize stealth launcher once at startup (avoids double-attach & cache issues)
let stealthLauncher = chromium;
try {
    const { chromium: extraChromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    extraChromium.use(stealth);
    stealthLauncher = extraChromium;
} catch (e) {
    console.error('Stealth plugin not available, falling back to vanilla Chromium:', e.message);
}

app.post('/api/capture', async (req, res) => {
    const { urls, desktop, mobile, stealth } = req.body;

    if (!urls || urls.length === 0) {
        return res.status(400).json({ error: 'No URLs provided' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendMsg = (msg) => {
        res.write(JSON.stringify(msg) + '\n');
    };

    const modes = [];
    if (desktop) modes.push({ name: 'desktop', width: 1440, height: 900 });
    if (mobile) modes.push({ name: 'mobile', width: 390, height: 844 });

    if (modes.length === 0) {
        sendMsg({ type: 'error', data: { error: 'No modes selected' } });
        res.end();
        return;
    }

    sendMsg({ type: 'start', data: { total: urls.length * modes.length } });

    let browser;
    let persistentCtx;

    try {
        if (stealth) {
            // ─── STEALTH / INTERACTIVE PATH ───
            // Use launchPersistentContext with a local user-data dir.
            // This preserves cookies (CAPTCHA clearance) between runs and uses the stealth plugin.
            // Use a writable persistent location in the home directory
            const userDataDir = path.join(os.homedir(), '.stealth-batch-shot-v2');
            if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

            persistentCtx = await stealthLauncher.launchPersistentContext(userDataDir, {
                headless: false,
                viewport: null, // Let page set viewport individually
                args: ['--disable-blink-features=AutomationControlled']
            });
        } else {
            // ─── NORMAL PATH ───
            browser = await chromium.launch({
                headless: true,
                args: ['--window-size=1920,1080']
            });
        }

        for (const url of urls) {
            for (const mode of modes) {
                const jobId = `${url}-${mode.name}`;
                sendMsg({ type: 'progress', data: { url, mode: mode.name, status: 'processing', jobId } });

                let context;
                try {
                    let page;

                    if (stealth) {
                        page = await persistentCtx.newPage();
                        await page.setViewportSize({ width: mode.width, height: mode.height });
                    } else {
                        context = await browser.newContext({
                            viewport: { width: mode.width, height: mode.height },
                            deviceScaleFactor: 1
                        });

                        // Force width via init script (for headless CSS bypass)
                        await context.addInitScript((targetWidth) => {
                            const style = document.createElement('style');
                            style.textContent = `html, body { min-width: ${targetWidth}px !important; max-width: none !important; overflow-x: visible !important; width: ${targetWidth}px !important; }`;
                            document.addEventListener('DOMContentLoaded', () => { document.head.appendChild(style); }, { once: true });
                        }, mode.width);

                        page = await context.newPage();
                    }

                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // In non-interactive mode, try to wait for network idle
                    if (!stealth) {
                        try {
                            await page.waitForLoadState('networkidle', { timeout: 15000 });
                        } catch (_) { }
                    }

                    if (stealth) {
                        // Pause: let user interact with visible browser (solve CAPTCHA, move mouse)
                        sendMsg({ type: 'waiting', data: { url, mode: mode.name, jobId } });
                        await new Promise((resolve) => { pendingContinue.set(jobId, resolve); });
                        sendMsg({ type: 'progress', data: { url, mode: mode.name, status: 'processing', jobId } });
                    }

                    // Disable animations
                    await page.addStyleTag({
                        content: '* { animation: none !important; transition: none !important; scroll-behavior: auto !important; }'
                    });

                    // Auto-scroll for lazy load
                    await page.evaluate(async () => {
                        await new Promise((resolve) => {
                            let totalHeight = 0;
                            const distance = 400;
                            const timer = setInterval(() => {
                                const scrollHeight = document.body.scrollHeight;
                                window.scrollBy(0, distance);
                                totalHeight += distance;
                                if (totalHeight >= scrollHeight) {
                                    clearInterval(timer);
                                    window.scrollTo(0, 0);
                                    resolve();
                                }
                            }, 100);
                        });
                    });

                    await page.waitForTimeout(1000);

                    // Save screenshot
                    const urlObj = new URL(url);
                    const hostname = urlObj.hostname.replace(/[\\/?%*:|"<>\s]/gi, '-').toLowerCase();
                    const pathname = urlObj.pathname.replace(/[\\/?%*:|"<>\s]/gi, '-').toLowerCase();
                    const rawFilename = `${hostname}${pathname}-${mode.name}-${Date.now()}.png`
                        .replace(/-+/g, '-').replace(/^-|-$/g, '').replace('-.png', '.png');

                    const downloadsFolder = path.join(os.homedir(), 'Downloads');
                    if (!fs.existsSync(downloadsFolder)) fs.mkdirSync(downloadsFolder, { recursive: true });
                    const filepath = path.join(downloadsFolder, rawFilename);

                    // Re-enforce the correct viewport width and height before taking full page screenshot.
                    // DO NOT stretch the height to pageHeight since it evaluates `100vh` to 10000px and breaks mobile!
                    await page.setViewportSize({ width: mode.width, height: mode.height });

                    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });

                    if (!stealth) {
                        await context.close();
                    } else {
                        await page.close();
                    }

                    sendMsg({ type: 'success', data: { url, mode: mode.name, filepath, jobId } });
                } catch (err) {
                    pendingContinue.delete(jobId);
                    sendMsg({ type: 'error', data: { url, mode: mode.name, error: err.message || 'Unknown error', jobId } });
                    if (!stealth && context) {
                        try { await context.close(); } catch (_) { }
                    }
                }
            }
        }
    } catch (err) {
        sendMsg({ type: 'fatal', data: { error: err.message || 'Fatal browser error' } });
    } finally {
        if (browser) await browser.close();
        if (stealth && persistentCtx) await persistentCtx.close();
        sendMsg({ type: 'done' });
        res.end();
    }
});

// Export the Express app so Electron's main.js can control the port.
// When run directly with `node server.js`, start the server on PORT 3000.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`StealthBatchShot Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
