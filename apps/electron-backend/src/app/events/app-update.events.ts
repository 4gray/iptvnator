import { ipcMain } from 'electron';
import {
    APP_UPDATE_CHECK,
    APP_UPDATE_DOWNLOAD,
    APP_UPDATE_GET_RELEASE_NOTES,
    APP_UPDATE_GET_STATUS,
    APP_UPDATE_INSTALL,
    ElectronBridgeAppUpdateReleaseNotes,
    ElectronBridgeAppUpdateReleaseNotesRequest,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateService } from '../services/app-update.service';

export interface AppUpdateServiceContract {
    getStatus(): ElectronBridgeAppUpdateStatus;
    checkForUpdates(): Promise<ElectronBridgeAppUpdateStatus>;
    downloadUpdate(): Promise<ElectronBridgeAppUpdateStatus>;
    installUpdate(): ElectronBridgeAppUpdateStatus;
    getReleaseNotes(
        request?: ElectronBridgeAppUpdateReleaseNotesRequest
    ): Promise<ElectronBridgeAppUpdateReleaseNotes>;
}

export default class AppUpdateEvents {
    static bootstrapAppUpdateEvents(
        service: AppUpdateServiceContract | AppUpdateService
    ): Electron.IpcMain {
        ipcMain.handle(APP_UPDATE_GET_STATUS, () => service.getStatus());
        ipcMain.handle(APP_UPDATE_CHECK, () => service.checkForUpdates());
        ipcMain.handle(APP_UPDATE_DOWNLOAD, () => service.downloadUpdate());
        ipcMain.handle(APP_UPDATE_INSTALL, () => service.installUpdate());
        ipcMain.handle(APP_UPDATE_GET_RELEASE_NOTES, (_event, request) =>
            service.getReleaseNotes(
                request as ElectronBridgeAppUpdateReleaseNotesRequest
            )
        );

        return ipcMain;
    }
}
