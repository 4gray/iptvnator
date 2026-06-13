import { ipcMain } from 'electron';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { DlnaRendererService } from '../services/dlna-renderer.service';

const dlnaRendererService = new DlnaRendererService();

ipcMain.handle('CAST:DLNA_DISCOVER', () => dlnaRendererService.discover());
ipcMain.handle(
    'CAST:DLNA_START',
    (_event, deviceId: string, playback: ResolvedPortalPlayback) =>
        dlnaRendererService.startPlayback(deviceId, playback)
);

export default class CastingEvents {
    static bootstrapCastingEvents(): Electron.IpcMain {
        return ipcMain;
    }
}
