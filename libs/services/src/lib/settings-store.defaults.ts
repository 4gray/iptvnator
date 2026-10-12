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
    watchEmbeddedMpvSupport,
} from '@iptvnator/shared/interfaces';

/** Defaults and boot-time helpers of `SettingsStore`, split out for size. */
export const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    webPlayerSharedControls: true,
    playerAmbientMode: false,
    detailTrailerBackdrop: false,
    playerUpNextRail: true,
    playerUpNextCard: true,
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
    updateChannel: 'stable',
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
    showCoverTitles: true,
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

/**
 * Checks a saved Embedded MPV selection against this machine: schedules the
 * idle prepare when it is supported, and calls `fallBack` when it is not or
 * when the check itself fails. An inconclusive answer is no verdict: the
 * selection stays and the answer is followed until it is final. Nothing is
 * done once `isSaved` turns false, because the user picked another player
 * meanwhile. Resolves when the first answer has been handled.
 */
export function verifySavedEmbeddedMpvPlayer(
    isSaved: () => boolean,
    fallBack: () => Promise<void>
): Promise<void> {
    const electron =
        typeof window === 'undefined' ? undefined : window.electron;
    if (!electron?.getEmbeddedMpvSupport) {
        return fallBack();
    }

    return new Promise<void>((handled, failed) => {
        const stop = watchEmbeddedMpvSupport(
            () => electron.getEmbeddedMpvSupport(),
            (support) => {
                if (!isSaved()) {
                    stop();
                    handled();
                } else if (support.supported) {
                    scheduleEmbeddedMpvPrepare();
                    handled();
                } else if (support.inconclusive) {
                    handled();
                } else {
                    fallBack().then(handled, failed);
                }
            },
            (error) => {
                console.warn(
                    'Failed to verify embedded MPV support; reverting to the default inline player.',
                    error
                );
                if (isSaved()) {
                    fallBack().then(handled, failed);
                } else {
                    handled();
                }
            }
        );
    });
}
