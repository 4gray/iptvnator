import { ipcMain } from 'electron';

export default class EpgEvents {
    static bootstrapEpgEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('GET_CHANNEL_PROGRAMS', async (event, channelId) => {
    // fetch EPG data for the given channelId
});

ipcMain.handle('FETCH_EPG', async (event, urls: string[]) => {
    // fetch EPG data from the given URLs
});
