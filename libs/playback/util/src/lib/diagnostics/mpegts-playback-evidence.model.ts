export const MpegTsPlaybackEngineType = {
    Network: 'NetworkError',
    Media: 'MediaError',
    Other: 'OtherError',
    Unknown: 'unknown',
} as const;

export type MpegTsPlaybackEngineType =
    (typeof MpegTsPlaybackEngineType)[keyof typeof MpegTsPlaybackEngineType];

export const MpegTsPlaybackEngineDetails = {
    NetworkException: 'Exception',
    HttpStatusCodeInvalid: 'HttpStatusCodeInvalid',
    ConnectingTimeout: 'ConnectingTimeout',
    UnrecoverableEarlyEof: 'UnrecoverableEarlyEof',
    MediaMseError: 'MediaMSEError',
    FormatError: 'FormatError',
    FormatUnsupported: 'FormatUnsupported',
    CodecUnsupported: 'CodecUnsupported',
    Unknown: 'unknown',
} as const;

export type MpegTsPlaybackEngineDetails =
    (typeof MpegTsPlaybackEngineDetails)[keyof typeof MpegTsPlaybackEngineDetails];

export const MpegTsPlaybackDisposition = {
    Terminal: 'terminal',
} as const;

export type MpegTsPlaybackDisposition =
    (typeof MpegTsPlaybackDisposition)[keyof typeof MpegTsPlaybackDisposition];

export const MpegTsPlaybackStage = {
    Loader: 'loader',
    Demux: 'demux',
    MediaSource: 'media-source',
    Unknown: 'unknown',
} as const;

export type MpegTsPlaybackStage =
    (typeof MpegTsPlaybackStage)[keyof typeof MpegTsPlaybackStage];

export const MpegTsPlaybackFailure = {
    Http: 'http',
    Timeout: 'timeout',
    Network: 'network',
    TruncatedStream: 'truncated-stream',
    Format: 'format',
    Codec: 'codec',
    MediaSource: 'media-source',
    Unknown: 'unknown',
} as const;

export type MpegTsPlaybackFailure =
    (typeof MpegTsPlaybackFailure)[keyof typeof MpegTsPlaybackFailure];

export interface MpegTsPlaybackEvidence {
    readonly engineType: MpegTsPlaybackEngineType;
    readonly engineDetails: MpegTsPlaybackEngineDetails;
    readonly disposition: MpegTsPlaybackDisposition;
    readonly stage: MpegTsPlaybackStage;
    readonly failure: MpegTsPlaybackFailure;
    readonly httpStatus?: number;
}
