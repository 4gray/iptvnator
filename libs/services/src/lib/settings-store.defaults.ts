import {
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    DEFAULT_PARENTAL_LOCK_RELOCK_MINUTES,
    DEFAULT_TMDB_SETTINGS,
    Language,
    normalizeAppLanguage,
    normalizeAppUpdateChannel,
    normalizeDashboardRailsSettings,
    normalizeEpgOffsetMinutes,
    normalizeParentalLockRelockMinutes,
    normalizeTheme,
    normalizeStartupWindowMode,
    Settings,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    coerceProvidedDefaultOnSettings,
    resolveDefaultOnSettings,
} from './settings-opt-out.util';

/** Defaults and boot-time helpers of `SettingsStore`, split out for size. */
export const DEFAULT_SETTINGS = {
    player: VideoPlayer.VideoJs,
    webPlayerSharedControls: true,
    playerAmbientMode: false,
    detailTrailerBackdrop: false,
    seriesAutoplay: true,
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
    epgEnabled: true,
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
    ageRatingCountry: 'auto',
    parentalLockEnabled: false,
    parentalLockRelockMinutes: DEFAULT_PARENTAL_LOCK_RELOCK_MINUTES,
} satisfies Settings;

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
    savedTmdbApiKey: string | undefined;
}

export const TMDB_KEY_CHANGE = 'iptvnator:tmdb-key-change';

export function notifyTmdbKeyChange(): void {
    try {
        // A storage event invalidates other tabs without carrying the key.
        localStorage.setItem(TMDB_KEY_CHANGE, Math.random().toString(36));
    } catch {
        // Settings can persist in IndexedDB when localStorage is disabled.
    }
}

export function normalizeSettingsPatch(
    settings: Partial<Settings>
): Partial<Settings> {
    return {
        ...settings,
        ...('theme' in settings
            ? { theme: normalizeTheme(settings.theme) }
            : {}),
        ...(settings.language !== undefined
            ? { language: normalizeAppLanguage(settings.language) }
            : {}),
        ...coerceProvidedDefaultOnSettings(settings),
        ...(settings.dashboardRails !== undefined
            ? {
                  dashboardRails: normalizeDashboardRailsSettings(
                      settings.dashboardRails
                  ),
              }
            : {}),
        ...(settings.epgOffsetMinutes !== undefined
            ? {
                  epgOffsetMinutes: normalizeEpgOffsetMinutes(
                      settings.epgOffsetMinutes
                  ),
              }
            : {}),
        ...(settings.parentalLockEnabled !== undefined
            ? {
                  parentalLockEnabled: settings.parentalLockEnabled === true,
              }
            : {}),
        ...(settings.parentalLockRelockMinutes !== undefined
            ? {
                  parentalLockRelockMinutes: normalizeParentalLockRelockMinutes(
                      settings.parentalLockRelockMinutes
                  ),
              }
            : {}),
    };
}

const settingsKeys = Object.keys(DEFAULT_SETTINGS) as Array<
    keyof typeof DEFAULT_SETTINGS
>;
type SettingsSnapshot = {
    [Key in (typeof settingsKeys)[number]]-?: Settings[Key];
};

const nullishDefaults = [
    'playerAmbientMode',
    'detailTrailerBackdrop',
    'playerUpNextRail',
    'playerUpNextCard',
    'fullscreenChannelPanel',
    'vodAutoFailover',
    'm3uVodDetails',
    'showExternalPlaybackBar',
    'stripCountryPrefix',
    'downloadFolder',
    'recordingFolder',
    'embeddedMpvFrameCopy',
    'embeddedMpvExtraOptions',
    'coverSize',
    'epgViewMode',
    'preferUploadedEpgOverXtream',
    'trustedPrivateNetworkEpgUrls',
    'trustedInsecureTlsHosts',
    'tmdb',
    'ageRatingCountry',
] as const;

type DefaultedSettings = {
    [Key in (typeof nullishDefaults)[number]]: NonNullable<Settings[Key]>;
};

export function snapshotSettings(current: Settings) {
    // Copy only supported persisted settings, excluding store state and legacy fields.
    const snapshot: Partial<
        Record<keyof SettingsSnapshot, Settings[keyof Settings]>
    > = {};
    for (const key of settingsKeys) snapshot[key] = current[key];
    for (const key of nullishDefaults) snapshot[key] ??= DEFAULT_SETTINGS[key];
    return Object.assign(
        snapshot as SettingsSnapshot & DefaultedSettings,
        resolveDefaultOnSettings(current),
        {
            startupWindowMode: normalizeStartupWindowMode(
                current.startupWindowMode
            ),
            updateChannel: normalizeAppUpdateChannel(current.updateChannel),
            epgOffsetMinutes: normalizeEpgOffsetMinutes(
                current.epgOffsetMinutes
            ),
            dashboardRails: normalizeDashboardRailsSettings(
                current.dashboardRails
            ),
            parentalLockEnabled: current.parentalLockEnabled === true,
            parentalLockRelockMinutes: normalizeParentalLockRelockMinutes(
                current.parentalLockRelockMinutes
            ),
        }
    );
}
