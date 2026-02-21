const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Error logging for debugging packaged app
const logFile = path.join(os.homedir(), 'stealth-batch-shot-error.log');
function logError(err) {
    const msg = `${new Date().toISOString()} - ${err && err.stack ? err.stack : err}\n`;
    fs.appendFileSync(logFile, msg);
    if (app.isReady()) {
        dialog.showErrorBox('JavaScript Error', err && err.message ? err.message : String(err));
    }
}

process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

let PORT = null;
let appReady = false;
let mainWindow;

// Start the Express server right away on a dynamic port
const serverApp = require('./server.js');
const server = serverApp.listen(0, '127.0.0.1', () => {
    PORT = server.address().port;
    console.log(`Embedded server started on port ${PORT}`);
    maybeCreateWindow();
});

function maybeCreateWindow() {
    // Only create window once BOTH the server is up AND Electron is ready
    if (!PORT || !appReady) return;

    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        minWidth: 700,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        title: 'StealthBatchShot',
        backgroundColor: '#111111',
        show: false
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// Explicit cleanup on quit
app.on('before-quit', () => {
    if (server) {
        console.log('Stopping embedded server...');
        server.close();
    }
});

app.on('will-quit', () => {
    console.log('Quitting app. Ensuring all browser processes are terminated...');
    // Playwright browsers launched from server.js are child processes and 
    // should be naturally killed by the OS when the main process exits.
});

app.whenReady().then(() => {
    appReady = true;
    maybeCreateWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) maybeCreateWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
