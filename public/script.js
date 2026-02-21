document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const chipContainer = document.getElementById('chipContainer');
    const inputBox = document.getElementById('inputBox');
    const captureBtn = document.getElementById('captureBtn');

    const checkDesktop = document.getElementById('checkDesktop');
    const checkMobile = document.getElementById('checkMobile');
    const checkStealth = document.getElementById('checkStealth');

    const progressSection = document.getElementById('progressSection');
    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');

    const statusSection = document.getElementById('statusSection');
    const statusList = document.getElementById('statusList');

    let urls = new Set();
    let isProcessing = false;

    // Focus input when clicking anywhere in the input box
    inputBox.addEventListener('click', () => {
        urlInput.focus();
    });

    const isValidUrl = (string) => {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    };

    const addUrl = (urlStr) => {
        let trimmed = urlStr.trim();
        if (!trimmed) return;

        // Auto-prepend http:// if missing and not localhost for ease of use
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            trimmed = 'https://' + trimmed;
        }

        if (!isValidUrl(trimmed)) {
            // Optional: Show brief warning tooltip, ignoring for minimalist UI
            return;
        }

        if (!urls.has(trimmed)) {
            urls.add(trimmed);
            renderChips();
        }
    };

    const processInputString = (str) => {
        const split = str.split(/[\n, ]+/);
        split.forEach(addUrl);
    };

    // Keyboard entry
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            processInputString(urlInput.value);
            urlInput.value = '';
        }
    });

    // Paste handling
    urlInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasteData = (e.clipboardData || window.clipboardData).getData('text');
        processInputString(pasteData);
    });

    const renderChips = () => {
        chipContainer.innerHTML = '';
        urls.forEach(url => {
            const chip = document.createElement('div');
            chip.className = 'chip';

            const text = document.createElement('span');
            // Clean display url
            const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
            text.textContent = displayUrl;

            const closeBtn = document.createElement('button');
            closeBtn.className = 'chip-close';
            closeBtn.innerHTML = '×';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                urls.delete(url);
                renderChips();
                validateRunButton();
            };

            chip.appendChild(text);
            chip.appendChild(closeBtn);
            chipContainer.appendChild(chip);
        });
        validateRunButton();
    };

    const validateRunButton = () => {
        const modeSelected = checkDesktop.checked || checkMobile.checked;
        captureBtn.disabled = urls.size === 0 || !modeSelected || isProcessing;
    };

    [checkDesktop, checkMobile].forEach(cb => {
        cb.addEventListener('change', validateRunButton);
    });

    // Helper to format string
    const formatMode = str => str.charAt(0).toUpperCase() + str.slice(1);

    // Initial validation
    validateRunButton();

    let totalTasks = 0;
    let completedTasks = 0;

    const createStatusItem = (jobId, url, mode) => {
        const li = document.createElement('div');
        li.className = 'status-item';
        li.id = `job-${jobId.replace(/[^a-zA-Z0-9-]/g, '-')}`;

        const displayUrl = url.replace(/^https?:\/\//, '');

        li.innerHTML = `
            <div class="status-item-info">
                <span class="status-item-url" title="${url}">${displayUrl}</span>
                <span class="status-item-mode">${formatMode(mode)}</span>
            </div>
            <div class="status-badge processing" id="badge-${li.id}">
                <div class="spinner"></div>
                Waiting...
            </div>
        `;
        return li;
    };

    const updateStatusItem = (jobId, status, details) => {
        const safeId = `job-${jobId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        const badge = document.getElementById(`badge-${safeId}`);
        if (!badge) return;

        if (status === 'processing') {
            badge.className = 'status-badge processing';
            badge.innerHTML = `<div class="spinner"></div>Capturing`;
        } else if (status === 'waiting') {
            badge.className = 'status-badge waiting';
            const btn = document.createElement('button');
            btn.className = 'continue-btn';
            btn.textContent = 'Continue →';
            btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = 'Capturing...';
                badge.className = 'status-badge processing';
                badge.innerHTML = `<div class="spinner"></div>Capturing`;
                await fetch(`/api/continue/${encodeURIComponent(jobId)}`, { method: 'POST' });
            };
            badge.innerHTML = '';
            badge.appendChild(btn);
        } else if (status === 'success') {
            badge.className = 'status-badge success';
            badge.innerHTML = `Success`;
        } else if (status === 'error') {
            badge.className = 'status-badge error';
            badge.innerHTML = `Failed`;
            if (details) {
                badge.title = details;
            }
        }
    };

    captureBtn.addEventListener('click', async () => {
        if (urls.size === 0) return;

        // Any pending text in input? Add it!
        if (urlInput.value.trim() !== '') {
            processInputString(urlInput.value);
            urlInput.value = '';
        }

        isProcessing = true;
        validateRunButton();

        progressSection.style.display = 'block';
        statusSection.style.display = 'block';
        statusList.innerHTML = '';
        progressBar.style.width = '0%';
        progressText.textContent = `0 / ${totalTasks}`; // Will update when API responds
        completedTasks = 0;

        captureBtn.textContent = 'Processing...';

        const payload = {
            urls: Array.from(urls),
            desktop: checkDesktop.checked,
            mobile: checkMobile.checked,
            stealth: checkStealth.checked
        };

        try {
            const response = await fetch('/api/capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || response.statusText);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                }

                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep partial line for next chunk

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const msg = JSON.parse(line);
                        handleStreamMessage(msg);
                    } catch (e) {
                        console.error('Failed to parse NDJSON line:', line, e);
                    }
                }

                if (done) {
                    if (buffer.trim()) {
                        try {
                            handleStreamMessage(JSON.parse(buffer));
                        } catch (e) { }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(error);
            alert('Failed to start batch capture: ' + error.message);
        } finally {
            isProcessing = false;
            validateRunButton();
            captureBtn.textContent = 'Capture All';
        }
    });

    const handleStreamMessage = (msg) => {
        const { type, data } = msg;

        if (type === 'start') {
            totalTasks = data.total;
            progressText.textContent = `${completedTasks} / ${totalTasks}`;
        }
        else if (type === 'progress') {
            // Append to list if not exists
            const safeId = `job-${data.jobId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
            if (!document.getElementById(safeId)) {
                statusList.appendChild(createStatusItem(data.jobId, data.url, data.mode));
            }
            updateStatusItem(data.jobId, 'processing');
        }
        else if (type === 'waiting') {
            updateStatusItem(data.jobId, 'waiting');
        }
        else if (type === 'success') {
            updateStatusItem(data.jobId, 'success', data.filepath);
            completedTasks++;
            updateProgress();
        }
        else if (type === 'error') {
            updateStatusItem(data.jobId, 'error', data.error);
            completedTasks++;
            updateProgress();
        }
        else if (type === 'fatal') {
            alert('Fatal Error: ' + data.error);
        }
        else if (type === 'done') {
            // Done!
            if (completedTasks === totalTasks && totalTasks > 0) {
                // All success/fail recorded
                setTimeout(() => {
                    progressBar.style.backgroundColor = 'var(--success)';
                }, 300);
            }
        }
    };

    const updateProgress = () => {
        progressText.textContent = `${completedTasks} / ${totalTasks}`;
        if (totalTasks > 0) {
            const percent = (completedTasks / totalTasks) * 100;
            progressBar.style.width = `${percent}%`;
        }
    };
});
