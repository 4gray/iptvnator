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

/**
 * Whether a failed stream on this player reaches the app at all.
 *
 * Only the built-in web players raise a playback diagnostic: Embedded MPV has
 * its diagnostics suppressed, and MPV/VLC play outside the app entirely. On
 * those, anything keyed off a playback failure — VOD auto-failover above all —
 * can never fire, so offering the control there promises a feature that does
 * nothing.
 */
export function reportsPlaybackFailures(
    player: VideoPlayer | null | undefined
): boolean {
    return (
        player === VideoPlayer.VideoJs ||
        player === VideoPlayer.Html5Player ||
        player === VideoPlayer.ArtPlayer
    );
}

export enum StartupBehavior {
    FirstView = 'first-view',
    RestoreLastView = 'restore-last-view',
}

/**
 * How the desktop window is presented when the app launches. Electron only.
 *
 * Persisted like every other setting in the renderer and mirrored into the
 * main-process config file by the `SETTINGS_UPDATE` handler, because the
 * window is created before the renderer exists — so a change applies on the
 * next launch. `--fullscreen` on the command line forces `'fullscreen'` for
 * that launch only, and F11 toggles fullscreen at any time.
 */
export type StartupWindowMode = 'normal' | 'maximized' | 'fullscreen';

export const STARTUP_WINDOW_MODES: readonly StartupWindowMode[] = [
    'normal',
    'maximized',
    'fullscreen',
];

/**
 * Collapses anything that is not a known mode to `'normal'`. Shared by the
 * renderer form and the main-process mirror so junk never reaches the
 * config file or the window options.
 */
export function normalizeStartupWindowMode(value: unknown): StartupWindowMode {
    return STARTUP_WINDOW_MODES.includes(value as StartupWindowMode)
        ? (value as StartupWindowMode)
        : 'normal';
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
    /**
     * TMDB "Because you watched" rail seeded from recently watched
     * movies/series (needs the TMDB opt-in; Electron)
     */
    tmdbRecommendations: boolean;
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
    tmdbRecommendations: true,
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
    /**
     * Use IPTVnator's shared controls in HTML5, Video.js, and ArtPlayer.
     * Default ON: a missing value means the user never chose, and gets the
     * shared controls; only an explicit false keeps the legacy vendor chrome.
     */
    webPlayerSharedControls?: boolean;
    /**
     * Fill the empty space around the inline VOD/series player with a blurred,
     * dimmed copy of the poster (YouTube "Ambient mode" style) instead of plain
     * black bars. Off by default; only affects the built-in web players.
     */
    playerAmbientMode?: boolean;
    /**
     * Dock the inline series player to the left and show an "Up Next"
     * episode rail in the leftover stage column on wide windows. On by
     * default (the rail only appears when there is genuinely unused space);
     * missing values mean enabled. Only affects the built-in web players.
     */
    playerUpNextRail?: boolean;
    /**
     * Slide the live channel list over the video in fullscreen — resting the
     * mouse on the left edge, tapping that edge on touch, or pressing `C` —
     * so a channel can be switched without leaving fullscreen. On by
     * default; missing values mean enabled. Applies to the shared player
     * controls (HTML5, Video.js, ArtPlayer, Embedded MPV frame-copy).
     */
    fullscreenChannelPanel?: boolean;
    /**
     * When a movie fails to play and the same film exists in another imported
     * playlist, switch to it automatically instead of showing the error.
     *
     * Off by default and deliberately opt-in: another source can carry a
     * different dub or cut, so switching is never silent — the toast always
     * announces it and offers an undo. Each source is tried at most once per
     * session, so this cannot loop.
     */
    vodAutoFailover?: boolean;
    /**
     * Present M3U entries recognized as movie files (by URL shape) in the
     * VOD detail view with TMDB metadata instead of the EPG zone. On by
     * default; missing values mean enabled. Only takes effect while TMDB
     * enrichment itself is enabled — without it there is no metadata to
     * show, so recognition never runs.
     */
    m3uVodDetails?: boolean;
    epgUrl: string[];
    streamFormat: StreamFormat;
    openStreamOnDoubleClick: boolean;
    language: Language;
    showCaptions: boolean;
    showDashboard: boolean;
    startupBehavior: StartupBehavior;
    /**
     * Desktop window presentation at launch: normal (last size), maximized,
     * or fullscreen. Electron only and applied on the next launch; a missing
     * value means `'normal'`. F11 leaves or re-enters fullscreen.
     */
    startupWindowMode?: StartupWindowMode;
    /** Show the desktop footer bar for external playback status */
    showExternalPlaybackBar?: boolean;
    /** Strip country/group prefixes like "US | " or "UK - " from channel names */
    stripCountryPrefix?: boolean;
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
    /**
     * Extra libmpv options for the embedded engine, one `key=value` per line
     * (no leading `--`), applied on every engine after the built-in options
     * and the network defaults, so a line here overrides them. Keys the
     * embed depends on (`EMBEDDED_MPV_FORBIDDEN_OPTION_KEYS`) are refused by
     * the form and skipped at session creation. Mirrored into the
     * main-process config like `embeddedMpvFrameCopy`; a change applies to
     * the next embedded session.
     */
    embeddedMpvExtraOptions?: string;
    /**
     * Reload a dropped embedded MPV stream automatically (mpv error, or EOF
     * on a live stream) with capped backoff. Default on; only a stream that
     * already played is retried, so a dead URL stays on the manual Retry.
     * Captured per session, so a change applies to the next session.
     */
    embeddedMpvAutoReconnect?: boolean;
    /** Cover/poster sizing preset applied across grids and rails */
    coverSize?: CoverSize;
    /** Live EPG panel layout: horizontal timeline (default) or vertical list */
    epgViewMode?: EpgViewMode;
    /**
     * Display-only correction, in whole minutes, for guides whose provider
     * labels programme times with the wrong timezone. Clamped to ±720 by
     * `normalizeEpgOffsetMinutes`; the two equivalent ways of applying it are
     * documented in `epg-display-offset.util.ts`. Electron only in practice
     * (the control is gated behind `supportsEpg`, like `epgViewMode`).
     */
    epgOffsetMinutes?: number;
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
