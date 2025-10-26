import { ipcMain } from 'electron';
import {
    MPV_REUSE_INSTANCE,
    store,
} from '../services/store.service';

export default class SettingsEvents {
    static bootstrapSettingsEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('SETTINGS_UPDATE', (_event, arg) => {
    console.log('Received SETTINGS_UPDATE with data:', arg);
    
    // Only set values that are defined
    if (arg.mpvReuseInstance !== undefined) {
        store.set(MPV_REUSE_INSTANCE, arg.mpvReuseInstance);
    }
});
