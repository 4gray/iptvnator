import { Conf } from 'electron-conf/main';
import { getElectronConfigDirectory } from '@iptvnator/shared/database';

export const WINDOW_BOUNDS = 'WINDOW_BOUNDS';
export const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
export const MPV_PLAYER_ARGUMENTS = 'MPV_PLAYER_ARGUMENTS';
export const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';
export const VLC_PLAYER_ARGUMENTS = 'VLC_PLAYER_ARGUMENTS';
export const MPV_REUSE_INSTANCE = 'MPV_REUSE_INSTANCE';
export const VLC_REUSE_INSTANCE = 'VLC_REUSE_INSTANCE';

export type StoreType = {
    [WINDOW_BOUNDS]: Electron.Rectangle;
    [MPV_PLAYER_PATH]: string;
    [MPV_PLAYER_ARGUMENTS]: string;
    [VLC_PLAYER_PATH]: string;
    [VLC_PLAYER_ARGUMENTS]: string;
    [MPV_REUSE_INSTANCE]: boolean;
    [VLC_REUSE_INSTANCE]: boolean;
};

// Export singleton store instance
const electronConfigDirectory = getElectronConfigDirectory();
const storeOptions = electronConfigDirectory
    ? { dir: electronConfigDirectory }
    : {};

export const store = new Conf<StoreType>(storeOptions);
