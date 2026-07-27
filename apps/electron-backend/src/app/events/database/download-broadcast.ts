import type { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
    mainWindow = win;
}

export function broadcastDownloadUpdate(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('DOWNLOADS_UPDATE_EVENT');
    }
}
