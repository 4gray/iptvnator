import Store from 'electron-store';

export const WINDOW_BOUNDS = 'WINDOW_BOUNDS';
export const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
export const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';
export const MPV_REUSE_INSTANCE = 'MPV_REUSE_INSTANCE';

export type StoreType = {
    [WINDOW_BOUNDS]: Electron.Rectangle;
    [MPV_PLAYER_PATH]: string;
    [VLC_PLAYER_PATH]: string;
    [MPV_REUSE_INSTANCE]: boolean;
};

// Initialize renderer support
Store.initRenderer();

// Export singleton store instance
export const store = new Store<StoreType>();
