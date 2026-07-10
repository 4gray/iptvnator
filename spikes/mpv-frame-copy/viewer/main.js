/*
 * mpv frame-copy spike — Electron viewer harness.
 *
 * Deliberately minimal: nodeIntegration on, no preload, renderer console is
 * mirrored to stdout so an automated run can scrape the STATS lines.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const shmName = process.env.SPIKE_SHM || '/mpv-frame-spike';

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 1600,
        height: 980,
        backgroundColor: '#101014',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    win.webContents.on('console-message', (_event, _level, message) => {
        console.log(`[viewer] ${message}`);
    });
    win.loadFile(path.join(__dirname, 'index.html'), {
        query: { shm: shmName },
    });
});

app.on('window-all-closed', () => app.quit());
