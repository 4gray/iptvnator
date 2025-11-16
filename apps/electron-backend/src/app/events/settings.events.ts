import { ipcMain } from 'electron';
import {
    MPV_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { httpServer } from '../server/http-server';

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

    // Handle remote control settings
    if (arg.remoteControl !== undefined || arg.remoteControlPort !== undefined) {
        const enabled = arg.remoteControl ?? store.get('remoteControl', false);
        const port = arg.remoteControlPort ?? store.get('remoteControlPort', 8765);

        // Save to store
        if (arg.remoteControl !== undefined) {
            store.set('remoteControl', enabled);
        }
        if (arg.remoteControlPort !== undefined) {
            store.set('remoteControlPort', port);
        }

        // Update HTTP server
        httpServer.updateSettings(enabled, port);
    }
});
