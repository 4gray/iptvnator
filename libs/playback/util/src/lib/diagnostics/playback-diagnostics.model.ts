import type {
    ExternalPlayerName,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { ErrorDetails, ErrorTypes } from 'hls.js';
import type { MpegTsPlaybackEvidence } from './mpegts-playback-evidence.model';

export * from './mpegts-playback-evidence.model';

export const PlaybackDiagnosticCode = {
    UnsupportedContainer: 'unsupported-container',
    UnsupportedCodec: 'unsupported-codec',
    MediaDecodeError: 'media-decode-error',
    NetworkError: 'network-error',
    BrowserAccessError: 'browser-access-error',
    DrmOrEncryption: 'drm-or-encryption',
    UnknownPlaybackError: 'unknown-playback-error',
} as const;

export type PlaybackDiagnosticCode =
    (typeof PlaybackDiagnosticCode)[keyof typeof PlaybackDiagnosticCode];

export const PlaybackDiagnosticSource = {
    Source: 'source',
    Native: 'native',
    Vhs: 'vhs',
    Hls: 'hls',
    MpegTs: 'mpegts',
    Shaka: 'shaka',
} as const;

export type PlaybackDiagnosticSource =
    (typeof PlaybackDiagnosticSource)[keyof typeof PlaybackDiagnosticSource];

export const PlaybackRuntimeSupport = {
    ShakaBrowserUnsupported: 'shaka-browser-unsupported',
} as const;

export type PlaybackRuntimeSupport =
    (typeof PlaybackRuntimeSupport)[keyof typeof PlaybackRuntimeSupport];

export const InlinePlaybackPlayer = {
    VideoJs: 'videojs',
    Html5: 'html5',
    ArtPlayer: 'artplayer',
} as const;

export type InlinePlaybackPlayer =
    (typeof InlinePlaybackPlayer)[keyof typeof InlinePlaybackPlayer];

export interface PlaybackSourceMetadataInput {
    readonly url: string;
    readonly mimeType?: string;
    readonly player?: InlinePlaybackPlayer;
    readonly audioCodecs?: readonly string[];
    readonly videoCodecs?: readonly string[];
}

export interface PlaybackSourceMetadata {
    readonly url: string;
    readonly extension: string;
    readonly container: string;
    readonly mimeType?: string;
    readonly player?: InlinePlaybackPlayer;
    readonly audioCodecs: readonly string[];
    readonly videoCodecs: readonly string[];
}

export interface NativePlaybackErrorMetadataInput {
    readonly errorType?: unknown;
}

export interface NativePlaybackErrorInput {
    readonly code?: number;
    readonly message?: string;
    readonly status?: number;
    readonly metadata?: NativePlaybackErrorMetadataInput;
}

export const VhsPlaybackEngineType = {
    NetworkBadStatus: 'networkbadstatus',
    NetworkRequestFailed: 'networkrequestfailed',
    NetworkRequestAborted: 'networkrequestaborted',
    NetworkRequestTimeout: 'networkrequesttimeout',
    NetworkBodyParserFailed: 'networkbodyparserfailed',
    StreamingHlsPlaylistParserError: 'streaminghlsplaylistparsererror',
    StreamingDashManifestParserError: 'streamingdashmanifestparsererror',
    StreamingContentSteeringParserError: 'streamingcontentsteeringparsererror',
    StreamingVttParserError: 'streamingvttparsererror',
    StreamingFailedToSelectNextSegment: 'streamingfailedtoselectnextsegment',
    StreamingFailedToDecryptSegment: 'streamingfailedtodecryptsegment',
    StreamingFailedToTransmuxSegment: 'streamingfailedtotransmuxsegment',
    StreamingFailedToAppendSegment: 'streamingfailedtoappendsegment',
    StreamingCodecsChangeError: 'streamingcodecschangeerror',
} as const;

export const VhsPlaybackUnknownEngineType = 'unknown' as const;

export type VhsPlaybackEngineType =
    | (typeof VhsPlaybackEngineType)[keyof typeof VhsPlaybackEngineType]
    | typeof VhsPlaybackUnknownEngineType;

export const VhsPlaybackMediaErrorCode = {
    Custom: 0,
    Aborted: 1,
    Network: 2,
    Decode: 3,
    SourceNotSupported: 4,
    Encrypted: 5,
    Unknown: 'unknown',
} as const;

export type VhsPlaybackMediaErrorCode =
    (typeof VhsPlaybackMediaErrorCode)[keyof typeof VhsPlaybackMediaErrorCode];

export const VhsPlaybackDisposition = {
    Terminal: 'terminal',
} as const;

export type VhsPlaybackDisposition =
    (typeof VhsPlaybackDisposition)[keyof typeof VhsPlaybackDisposition];

export const VhsPlaybackStage = {
    Manifest: 'manifest',
    Playlist: 'playlist',
    Segment: 'segment',
    Unknown: 'unknown',
} as const;

export type VhsPlaybackStage =
    (typeof VhsPlaybackStage)[keyof typeof VhsPlaybackStage];

export interface VhsPlaybackEvidence {
    readonly engineType: VhsPlaybackEngineType;
    readonly mediaErrorCode: VhsPlaybackMediaErrorCode;
    readonly disposition: VhsPlaybackDisposition;
    readonly stage: VhsPlaybackStage;
    readonly httpStatus?: number;
}

export const HlsPlaybackDisposition = {
    Fatal: 'fatal',
    Recoverable: 'recoverable',
} as const;

export type HlsPlaybackDisposition =
    (typeof HlsPlaybackDisposition)[keyof typeof HlsPlaybackDisposition];

export const HlsPlaybackStage = {
    Manifest: 'manifest',
    Level: 'level',
    Segment: 'segment',
    Key: 'key',
    Media: 'media',
    Unknown: 'unknown',
} as const;

export type HlsPlaybackStage =
    (typeof HlsPlaybackStage)[keyof typeof HlsPlaybackStage];

export const HlsPlaybackFailure = {
    Http: 'http',
    Timeout: 'timeout',
    Network: 'network',
    Access: 'access',
    Unknown: 'unknown',
} as const;

export type HlsPlaybackFailure =
    (typeof HlsPlaybackFailure)[keyof typeof HlsPlaybackFailure];

export const HlsPlaybackUnknownEngineType = 'unknown' as const;

export type HlsPlaybackEngineType =
    ErrorTypes | typeof HlsPlaybackUnknownEngineType;

export interface HlsPlaybackEvidence {
    readonly engineType: HlsPlaybackEngineType;
    readonly engineDetails: ErrorDetails;
    readonly disposition: HlsPlaybackDisposition;
    readonly stage: HlsPlaybackStage;
    readonly failure: HlsPlaybackFailure;
    readonly httpStatus?: number;
}

export const ShakaPlaybackSeverity = {
    Recoverable: 'recoverable',
    Critical: 'critical',
    Unknown: 'unknown',
} as const;

export type ShakaPlaybackSeverity =
    (typeof ShakaPlaybackSeverity)[keyof typeof ShakaPlaybackSeverity];

export const ShakaPlaybackCategory = {
    Network: 'network',
    Text: 'text',
    Media: 'media',
    Manifest: 'manifest',
    Streaming: 'streaming',
    Drm: 'drm',
    Player: 'player',
    Cast: 'cast',
    Storage: 'storage',
    Ads: 'ads',
    Unknown: 'unknown',
} as const;

export type ShakaPlaybackCategory =
    (typeof ShakaPlaybackCategory)[keyof typeof ShakaPlaybackCategory];

export const ShakaPlaybackDisposition = {
    Terminal: 'terminal',
    Recoverable: 'recoverable',
} as const;

export type ShakaPlaybackDisposition =
    (typeof ShakaPlaybackDisposition)[keyof typeof ShakaPlaybackDisposition];

export const ShakaPlaybackStage = {
    Manifest: 'manifest',
    Segment: 'segment',
    Media: 'media',
    License: 'license',
    Unknown: 'unknown',
} as const;

export type ShakaPlaybackStage =
    (typeof ShakaPlaybackStage)[keyof typeof ShakaPlaybackStage];

export const ShakaPlaybackFailure = {
    Network: 'network',
    Drm: 'drm',
    Manifest: 'manifest',
    Media: 'media',
    Unknown: 'unknown',
} as const;

export type ShakaPlaybackFailure =
    (typeof ShakaPlaybackFailure)[keyof typeof ShakaPlaybackFailure];

export const ShakaPlaybackUnknownCode = 'unknown' as const;

export type ShakaPlaybackEngineCode = number | typeof ShakaPlaybackUnknownCode;

export interface ShakaPlaybackEvidence {
    readonly severity: ShakaPlaybackSeverity;
    readonly category: ShakaPlaybackCategory;
    readonly engineCode: ShakaPlaybackEngineCode;
    readonly disposition: ShakaPlaybackDisposition;
    readonly stage: ShakaPlaybackStage;
    readonly failure: ShakaPlaybackFailure;
    readonly httpStatus?: number;
}

export interface PlaybackDiagnostic {
    readonly code: PlaybackDiagnosticCode;
    readonly source: PlaybackDiagnosticSource;
    readonly sourceUrl: string;
    readonly container: string;
    readonly mimeType?: string;
    readonly player?: InlinePlaybackPlayer;
    readonly audioCodecs: readonly string[];
    readonly videoCodecs: readonly string[];
    readonly runtimeSupport?: PlaybackRuntimeSupport;
    readonly details?: string;
    readonly nativeErrorCode?: number;
    readonly nativeErrorMessage?: string;
    readonly httpStatus?: number;
    readonly nativeErrorType?: string;
    readonly vhs?: VhsPlaybackEvidence;
    readonly hls?: HlsPlaybackEvidence;
    readonly mpegTs?: MpegTsPlaybackEvidence;
    readonly shaka?: ShakaPlaybackEvidence;
}

export interface PlaybackFallbackRequest {
    readonly player: ExternalPlayerName;
    readonly playback: ResolvedPortalPlayback;
    readonly diagnostic: PlaybackDiagnostic;
    readonly trackLaunch: (
        launch: Promise<ExternalPlayerSession | void>
    ) => void;
}
