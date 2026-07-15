import { RECORDINGS_UPDATE_EVENT } from '@iptvnator/shared/interfaces';
import App from '../app';

export function broadcastRecordingUpdate(): void {
    if (!App.mainWindow || App.mainWindow.isDestroyed()) {
        return;
    }
    App.mainWindow.webContents.send(RECORDINGS_UPDATE_EVENT);
}
