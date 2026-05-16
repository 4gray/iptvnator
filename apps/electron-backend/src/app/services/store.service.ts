import { Conf } from 'electron-conf/main';
import { getElectronConfigDirectory } from 'database';

export const WINDOW_BOUNDS = 'WINDOW_BOUNDS';
export const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
export const MPV_PLAYER_ARGUMENTS = 'MPV_PLAYER_ARGUMENTS';
export const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';
export const VLC_PLAYER_ARGUMENTS = 'VLC_PLAYER_ARGUMENTS';
export const MPV_REUSE_INSTANCE = 'MPV_REUSE_INSTANCE';
export const VLC_REUSE_INSTANCE = 'VLC_REUSE_INSTANCE';
export const APP_LANGUAGE = 'APP_LANGUAGE';
export const ACCELERATED_DOWNLOADS = 'ACCELERATED_DOWNLOADS';
export const REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE =
    'REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE';
export const BACKGROUND_METADATA_WARMUP = 'BACKGROUND_METADATA_WARMUP';
export const BACKGROUND_METADATA_WARMUP_AT_LOGIN =
    'BACKGROUND_METADATA_WARMUP_AT_LOGIN';
export const BACKGROUND_METADATA_WARMUP_SCHEDULE =
    'BACKGROUND_METADATA_WARMUP_SCHEDULE';
export const BACKGROUND_METADATA_WARMUP_CONCURRENCY =
    'BACKGROUND_METADATA_WARMUP_CONCURRENCY';
export const VPN_INTEGRATION_ENABLED = 'VPN_INTEGRATION_ENABLED';
export const VPN_PROVIDER = 'VPN_PROVIDER';
export const VPN_LOCATION = 'VPN_LOCATION';
export const VPN_RESTORE_ON_EXIT = 'VPN_RESTORE_ON_EXIT';
export const PROTON_VPN_INTEGRATION_ENABLED =
    'PROTON_VPN_INTEGRATION_ENABLED';
export const PROTON_VPN_LOCATION = 'PROTON_VPN_LOCATION';

export type StoreType = {
    [WINDOW_BOUNDS]: Electron.Rectangle;
    [MPV_PLAYER_PATH]: string;
    [MPV_PLAYER_ARGUMENTS]: string;
    [VLC_PLAYER_PATH]: string;
    [VLC_PLAYER_ARGUMENTS]: string;
    [MPV_REUSE_INSTANCE]: boolean;
    [VLC_REUSE_INSTANCE]: boolean;
    [APP_LANGUAGE]: string;
    [ACCELERATED_DOWNLOADS]: boolean;
    [REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE]: boolean;
    [BACKGROUND_METADATA_WARMUP]: boolean;
    [BACKGROUND_METADATA_WARMUP_AT_LOGIN]: boolean;
    [BACKGROUND_METADATA_WARMUP_SCHEDULE]: 'every-opening' | 'weekly' | 'monthly';
    [BACKGROUND_METADATA_WARMUP_CONCURRENCY]: number;
    [VPN_INTEGRATION_ENABLED]: boolean;
    [VPN_PROVIDER]: 'none' | 'proton';
    [VPN_LOCATION]: string;
    [VPN_RESTORE_ON_EXIT]: boolean;
    [PROTON_VPN_INTEGRATION_ENABLED]: boolean;
    [PROTON_VPN_LOCATION]: string;
};

// Export singleton store instance
const electronConfigDirectory = getElectronConfigDirectory();
const storeOptions = electronConfigDirectory
    ? { dir: electronConfigDirectory }
    : {};

export const store = new Conf<StoreType>(storeOptions);
