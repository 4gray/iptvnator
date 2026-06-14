import { Language } from './language.enum';
import { StreamFormat } from './stream-format.enum';
import { Theme } from './theme.enum';

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

export interface DashboardRailsSettings {
    hero: boolean;
    continueWatching: boolean;
    liveFavorites: boolean;
    recentlyWatchedLive: boolean;
    favoriteMoviesAndSeries: boolean;
    recentSources: boolean;
    xtreamRecentlyAdded: boolean;
}

export const DEFAULT_DASHBOARD_RAILS_SETTINGS: DashboardRailsSettings = {
    hero: true,
    continueWatching: true,
    liveFavorites: true,
    recentlyWatchedLive: true,
    favoriteMoviesAndSeries: true,
    recentSources: true,
    xtreamRecentlyAdded: true,
};

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
    /** Cover/poster sizing preset applied across grids and rails */
    coverSize?: CoverSize;
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
}
