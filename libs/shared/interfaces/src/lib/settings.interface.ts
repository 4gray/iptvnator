import { Language } from './language.enum';
import { StreamFormat } from './stream-format.enum';
import { Theme } from './theme.enum';
import { TmdbSettings } from './tmdb.interface';

/**
 * Contains all types of supported video players
 */
export enum VideoPlayer {
    VideoJs = 'videojs',
    Html5Player = 'html5',
    EmbeddedMpv = 'embedded-mpv',
    MPV = 'mpv',
    VLC = 'vlc',
    ArtPlayer = 'artplayer',
}

export enum StartupBehavior {
    FirstView = 'first-view',
    RestoreLastView = 'restore-last-view',
}

export type CoverSize = 'small' | 'medium' | 'large';

/** Rendering of the live EPG panel under the player. */
export type EpgViewMode = 'timeline' | 'list';

export interface DashboardRailsSettings {
    hero: boolean;
    continueWatching: boolean;
    liveFavorites: boolean;
    recentlyWatchedLive: boolean;
    favoriteMoviesAndSeries: boolean;
    recentSources: boolean;
    xtreamRecentlyAdded: boolean;
    /** TMDB "Trending this week" rail (needs the TMDB opt-in; Electron) */
    tmdbTrending: boolean;
}

export const DEFAULT_DASHBOARD_RAILS_SETTINGS: DashboardRailsSettings = {
    hero: true,
    continueWatching: true,
    liveFavorites: true,
    recentlyWatchedLive: true,
    favoriteMoviesAndSeries: true,
    recentSources: true,
    xtreamRecentlyAdded: true,
    tmdbTrending: true,
};

/**
 * Local pause-and-rewind buffer used by Electron's built-in inline players.
 * This is deliberately named `localTimeshift` to distinguish it from the
 * provider catch-up metadata stored in `Channel.timeshift`.
 */
export interface LocalTimeshiftSettings {
    enabled: boolean;
    maxDurationMinutes: number;
    /** Empty means the Electron-managed system cache directory. */
    bufferDirectory: string;
}

export const DEFAULT_LOCAL_TIMESHIFT_SETTINGS: LocalTimeshiftSettings = {
    enabled: false,
    maxDurationMinutes: 30,
    bufferDirectory: '',
};

export type LocalTimeshiftSettingsInput = Partial<
    Record<keyof LocalTimeshiftSettings, unknown>
>;

export function normalizeLocalTimeshiftSettings(
    settings?: LocalTimeshiftSettingsInput | null
): LocalTimeshiftSettings {
    const maxDurationMinutes = settings?.maxDurationMinutes;

    return {
        enabled:
            typeof settings?.enabled === 'boolean'
                ? settings.enabled
                : DEFAULT_LOCAL_TIMESHIFT_SETTINGS.enabled,
        maxDurationMinutes:
            typeof maxDurationMinutes === 'number' &&
            Number.isInteger(maxDurationMinutes) &&
            maxDurationMinutes >= 5 &&
            maxDurationMinutes <= 180
                ? maxDurationMinutes
                : DEFAULT_LOCAL_TIMESHIFT_SETTINGS.maxDurationMinutes,
        bufferDirectory:
            typeof settings?.bufferDirectory === 'string'
                ? settings.bufferDirectory.trim()
                : DEFAULT_LOCAL_TIMESHIFT_SETTINGS.bufferDirectory,
    };
}

export type DashboardRailsSettingsInput = Partial<
    Record<keyof DashboardRailsSettings, boolean | null | undefined>
>;

export function normalizeDashboardRailsSettings(
    settings?: DashboardRailsSettingsInput | null
): DashboardRailsSettings {
    const normalized = { ...DEFAULT_DASHBOARD_RAILS_SETTINGS };

    if (!settings) {
        return normalized;
    }

    const keys = Object.keys(
        DEFAULT_DASHBOARD_RAILS_SETTINGS
    ) as (keyof DashboardRailsSettings)[];
    for (const key of keys) {
        if (typeof settings[key] === 'boolean') {
            normalized[key] = settings[key];
        }
    }

    return normalized;
}

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayer;
    epgUrl: string[];
    streamFormat: StreamFormat;
    openStreamOnDoubleClick: boolean;
    language: Language;
    showCaptions: boolean;
    showDashboard: boolean;
    startupBehavior: StartupBehavior;
    /** Show the desktop footer bar for external playback status */
    showExternalPlaybackBar?: boolean;
    theme: Theme;
    mpvPlayerPath: string;
    /**
     * Extra MPV CLI arguments entered one argument per line. Applied only when
     * starting a new external MPV process.
     */
    mpvPlayerArguments: string;
    mpvReuseInstance: boolean;
    vlcPlayerPath: string;
    /**
     * Extra VLC CLI arguments entered one argument per line. Applied only when
     * starting a new external VLC process.
     */
    vlcPlayerArguments: string;
    vlcReuseInstance: boolean;
    remoteControl: boolean;
    remoteControlPort: number;
    /** Custom download folder path (uses system Downloads folder if not set) */
    downloadFolder?: string;
    /** Custom live recording folder path (uses system Downloads folder if not set) */
    recordingFolder?: string;
    /**
     * Embedded MPV frame-copy engine (experimental, macOS Apple Silicon and Linux).
     * Applied on the next app start — the engine relaxes the window sandbox
     * for its preload frame pump, which is fixed at window creation.
     */
    embeddedMpvFrameCopy?: boolean;
    /** Electron-only local pause-and-rewind buffer for built-in inline players. */
    localTimeshift?: LocalTimeshiftSettings;
    /** Cover/poster sizing preset applied across grids and rails */
    coverSize?: CoverSize;
    /** Live EPG panel layout: horizontal timeline (default) or vertical list */
    epgViewMode?: EpgViewMode;
    /** Per-rail dashboard visibility preferences. Missing keys default on. */
    dashboardRails?: DashboardRailsSettings;
    /**
     * When true, the locally-parsed XMLTV programs (loaded from `epgUrl`)
     * take precedence over the Xtream provider's EPG for live TV channels.
     * When false (default), the Xtream provider's EPG is preferred and
     * XMLTV is consulted only when the provider returns no programs.
     * Only meaningful for Xtream playlists in Electron.
     */
    preferUploadedEpgOverXtream?: boolean;
    /**
     * Exact EPG source URLs the user has allowed to resolve to private/LAN
     * network addresses. Kept source-scoped instead of disabling SSRF
     * protection globally.
     */
    trustedPrivateNetworkEpgUrls?: string[];
    /**
     * Lowercase hostnames whose invalid TLS certificates the user has chosen
     * to trust. This is host-scoped and does not disable TLS validation for
     * unrelated playlist or EPG hosts.
     */
    trustedInsecureTlsHosts?: string[];
    /**
     * Opt-in TMDB metadata enrichment for VOD/series detail views.
     * Disabled by default because enrichment sends content titles to TMDB.
     */
    tmdb?: TmdbSettings;
}
