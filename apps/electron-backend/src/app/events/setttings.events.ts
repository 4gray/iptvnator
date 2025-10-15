import { ipcMain } from 'electron';
import { SETTINGS_UPDATE } from 'shared-interfaces';

export default class SettingsEvents {
    static bootstrapSettingsEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(SETTINGS_UPDATE, (_event, arg) => {
    /* TODO: Implement settings update logic */
    /* this.settings = arg;
    this.server.updateSettings(); */
});
