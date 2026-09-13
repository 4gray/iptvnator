import {
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    DEFAULT_PARENTAL_LOCK_RELOCK_MINUTES,
    DEFAULT_TMDB_SETTINGS,
    Language,
    Settings,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

/** Defaults and boot-time helpers of `SettingsStore`, split out for size. */
export const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    webPlayerSharedControls: true,
    playerAmbientMode: false,
    playerUpNextRail: true,
    fullscreenChannelPanel: true,
    vodAutoFailover: false,
    m3uVodDetails: true,
    streamFormat: StreamFormat.AutoStreamFormat,
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
    startupWindowMode: 'normal',
    showExternalPlaybackBar: true,
    stripCountryPrefix: false,
    theme: Theme.SystemTheme,
    mpvPlayerPath: '',
    mpvPlayerArguments: '',
    mpvReuseInstance: false,
    vlcPlayerPath: '',
    vlcPlayerArguments: '',
    vlcReuseInstance: false,
    remoteControl: false,
    remoteControlPort: 8765,
    epgUrl: [],
    downloadFolder: '',
    recordingFolder: '',
    embeddedMpvFrameCopy: false,
    embeddedMpvExtraOptions: '',
    embeddedMpvAutoReconnect: true,
    portalConnectivityGuard: true,
    coverSize: 'medium',
    epgViewMode: 'timeline',
    epgOffsetMinutes: 0,
    dashboardRails: DEFAULT_DASHBOARD_RAILS_SETTINGS,
    preferUploadedEpgOverXtream: false,
    trustedPrivateNetworkEpgUrls: [],
    trustedInsecureTlsHosts: [],
    tmdb: DEFAULT_TMDB_SETTINGS,
    parentalLockEnabled: false,
    parentalLockRelockMinutes: DEFAULT_PARENTAL_LOCK_RELOCK_MINUTES,
};

/**
 * Which half of the settings persistence round-trip failed, if any.
 *
 * Settings live in the renderer's IndexedDB, which can be unavailable for
 * reasons the app cannot control (a second instance holding the Chromium
 * storage lock, a corrupted profile, storage blocked by security software).
 * Both failures used to be swallowed: `updateSettings` patches the in-memory
 * state before persisting, so a failed write still looked applied until the
 * next restart (issue #1156). Recording the failure lets the settings UI say
 * so instead of pretending the change stuck.
 */
export type SettingsStorageFailure = 'load' | 'save';

export interface SettingsStorageState {
    storageFailure: SettingsStorageFailure | null;
}

let embeddedMpvPrepareScheduled = false;

export function scheduleEmbeddedMpvPrepare(): void {
    if (
        embeddedMpvPrepareScheduled ||
        typeof window === 'undefined' ||
        !window.electron?.prepareEmbeddedMpv
    ) {
        return;
    }

    embeddedMpvPrepareScheduled = true;
    const prepare = () => {
        void window.electron
            .prepareEmbeddedMpv?.()
            .then((support) => {
                if (!support?.supported) {
                    embeddedMpvPrepareScheduled = false;
                }
            })
            .catch((error) => {
                embeddedMpvPrepareScheduled = false;
                console.warn('Failed to prepare embedded MPV.', error);
            });
    };
    const idleWindow = window as typeof window & {
        requestIdleCallback?: (
            callback: IdleRequestCallback,
            options?: IdleRequestOptions
        ) => number;
    };

    if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(prepare, { timeout: 5000 });
    } else {
        window.setTimeout(prepare, 2000);
    }
}
