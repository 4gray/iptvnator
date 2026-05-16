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
export type BackgroundMetadataWarmupSchedule =
    | 'every-opening'
    | 'weekly'
    | 'monthly';
export type VpnProvider = 'none' | 'proton';

export interface VpnIntegrationStatus {
    enabled: boolean;
    provider: VpnProvider;
    location: string;
    localAddress?: string;
    platform: string;
    status: 'configured' | 'disabled' | 'failed' | 'skipped' | 'timeout';
    reason?: string;
    clientRunning?: boolean;
    startedClient?: boolean;
    lastCheckedAt: number;
}

export type SourceVpnPreparationReason =
    | 'source-open'
    | 'default-source-startup';

export interface SourceVpnPreparationRequest {
    location?: string;
    provider?: VpnProvider;
    reason?: SourceVpnPreparationReason;
    sourceId?: string;
    sourceTitle?: string;
}

export type SourceVpnRequestContext = Pick<
    SourceVpnPreparationRequest,
    'location' | 'provider' | 'sourceId' | 'sourceTitle'
>;

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
    /** Use the desktop accelerated Range downloader when the server supports it */
    acceleratedDownloads?: boolean;
    /** Prefer provider-supplied direct_source URLs over generated Xtream URLs */
    redirectIndirectStreamsToDirectSource?: boolean;
    /**
     * Allow Electron to keep running after the last window closes until pending
     * Xtream media metadata probes have filled the local filter cache.
     */
    backgroundMetadataWarmup?: boolean;
    /**
     * Controls how often the app schedules a full missing-metadata sweep.
     * Pending persisted jobs can still continue between openings.
     */
    backgroundMetadataWarmupSchedule?: BackgroundMetadataWarmupSchedule;
    /** Start a hidden desktop process at OS login to finish persisted metadata jobs. */
    backgroundMetadataWarmupAtLogin?: boolean;
    /** Number of concurrent background media probes, clamped by the desktop backend. */
    backgroundMetadataWarmupConcurrency?: number;
    /** Prepare a configured VPN provider before opening the desktop app. */
    vpnIntegrationEnabled?: boolean;
    /** Optional desktop VPN provider adapter. */
    vpnProvider?: VpnProvider;
    /** VPN provider location/country code used by the desktop integration. */
    vpnLocation?: string;
    /** Restore VPN state after app-managed sessions end when possible. */
    vpnRestoreOnExit?: boolean;
    /** Deprecated: migrated to vpnIntegrationEnabled + vpnProvider. */
    protonVpnIntegrationEnabled?: boolean;
    /** Deprecated: migrated to vpnLocation. */
    protonVpnLocation?: string;
    /** Alias for acceleratedDownloads for public settings/backups. */
    fastDownloadEnabled?: boolean;
    /** Alias for redirectIndirectStreamsToDirectSource for public settings/backups. */
    redirectIndirectSourcesToDirect?: boolean;
    /** Custom live recording folder path (uses system Downloads folder if not set) */
    recordingFolder?: string;
    /** Cover/poster sizing preset applied across grids and rails */
    coverSize?: CoverSize;
    /**
     * When true, the locally-parsed XMLTV programs (loaded from `epgUrl`)
     * take precedence over the Xtream provider's EPG for live TV channels.
     * When false (default), the Xtream provider's EPG is preferred and
     * XMLTV is consulted only when the provider returns no programs.
     * Only meaningful for Xtream playlists in Electron.
     */
    preferUploadedEpgOverXtream?: boolean;
}
