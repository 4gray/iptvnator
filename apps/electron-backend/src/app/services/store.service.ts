import { Conf } from 'electron-conf/main';
import { getElectronConfigDirectory } from '@iptvnator/shared/database';
import type { StartupWindowMode } from '@iptvnator/shared/interfaces';

export const WINDOW_BOUNDS = 'WINDOW_BOUNDS';
export const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
export const MPV_PLAYER_ARGUMENTS = 'MPV_PLAYER_ARGUMENTS';
export const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';
export const VLC_PLAYER_ARGUMENTS = 'VLC_PLAYER_ARGUMENTS';
export const MPV_REUSE_INSTANCE = 'MPV_REUSE_INSTANCE';
export const VLC_REUSE_INSTANCE = 'VLC_REUSE_INSTANCE';

/**
 * Embedded MPV frame-copy engine opt-in (macOS arm64, Linux x64). Lives in the
 * main process config file because it must be readable synchronously before
 * the BrowserWindow is created — the engine relaxes the window sandbox for
 * its preload frame pump, which cannot change after window creation.
 */
export const EMBEDDED_MPV_FRAME_COPY = 'EMBEDDED_MPV_FRAME_COPY';
/**
 * Window presentation at launch (`normal` / `maximized` / `fullscreen`).
 * Mirrored here from the renderer's settings by the SETTINGS_UPDATE handler
 * for the same reason as the frame-copy flag: `initMainWindow` needs it
 * synchronously, before any renderer exists to ask.
 */
export const STARTUP_WINDOW_MODE = 'STARTUP_WINDOW_MODE';

/**
 * Extra libmpv options for embedded sessions, one "key=value" per line, as
 * typed in Settings > Playback. Mirrored here by the SETTINGS_UPDATE handler
 * because sessions are created in the main process, where the renderer's
 * IndexedDB settings are unreachable. Turned into addon arguments by
 * `readEmbeddedMpvSessionOptions()`.
 */
export const EMBEDDED_MPV_EXTRA_OPTIONS = 'EMBEDDED_MPV_EXTRA_OPTIONS';

/**
 * Whether a dropped embedded MPV stream is reloaded automatically. Same
 * mirror as above; absent means enabled.
 */
export const EMBEDDED_MPV_AUTO_RECONNECT = 'EMBEDDED_MPV_AUTO_RECONNECT';

export type StoreType = {
    [WINDOW_BOUNDS]: Electron.Rectangle;
    [MPV_PLAYER_PATH]: string;
    [MPV_PLAYER_ARGUMENTS]: string;
    [VLC_PLAYER_PATH]: string;
    [VLC_PLAYER_ARGUMENTS]: string;
    [MPV_REUSE_INSTANCE]: boolean;
    [VLC_REUSE_INSTANCE]: boolean;
    [EMBEDDED_MPV_FRAME_COPY]: boolean;
    [EMBEDDED_MPV_EXTRA_OPTIONS]: string;
    [EMBEDDED_MPV_AUTO_RECONNECT]: boolean;
    [STARTUP_WINDOW_MODE]: StartupWindowMode;
};

// Export singleton store instance
const electronConfigDirectory = getElectronConfigDirectory();
const storeOptions = electronConfigDirectory
    ? { dir: electronConfigDirectory }
    : {};

export const store = new Conf<StoreType>(storeOptions);
