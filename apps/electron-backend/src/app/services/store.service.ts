import { Conf } from 'electron-conf/main';
import { getElectronConfigDirectory } from '@iptvnator/shared/database';

export const WINDOW_BOUNDS = 'WINDOW_BOUNDS';
export const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
export const MPV_PLAYER_ARGUMENTS = 'MPV_PLAYER_ARGUMENTS';
export const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';
export const VLC_PLAYER_ARGUMENTS = 'VLC_PLAYER_ARGUMENTS';
export const MPV_REUSE_INSTANCE = 'MPV_REUSE_INSTANCE';
export const VLC_REUSE_INSTANCE = 'VLC_REUSE_INSTANCE';
/**
 * Embedded MPV frame-copy engine opt-in (macOS arm64). Lives in the main
 * process config file because it must be readable synchronously before the
 * BrowserWindow is created — the engine relaxes the window sandbox for its
 * preload frame pump, which cannot change after window creation.
 */
export const EMBEDDED_MPV_FRAME_COPY = 'EMBEDDED_MPV_FRAME_COPY';

export type StoreType = {
    [WINDOW_BOUNDS]: Electron.Rectangle;
    [MPV_PLAYER_PATH]: string;
    [MPV_PLAYER_ARGUMENTS]: string;
    [VLC_PLAYER_PATH]: string;
    [VLC_PLAYER_ARGUMENTS]: string;
    [MPV_REUSE_INSTANCE]: boolean;
    [VLC_REUSE_INSTANCE]: boolean;
    [EMBEDDED_MPV_FRAME_COPY]: boolean;
};

// Export singleton store instance
const electronConfigDirectory = getElectronConfigDirectory();
const storeOptions = electronConfigDirectory
    ? { dir: electronConfigDirectory }
    : {};

export const store = new Conf<StoreType>(storeOptions);
