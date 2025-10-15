import { ipcMain } from 'electron';

export default class EpgEvents {
    static bootstrapEpgEvents(): Electron.IpcMain {
        return ipcMain;
    }
}
