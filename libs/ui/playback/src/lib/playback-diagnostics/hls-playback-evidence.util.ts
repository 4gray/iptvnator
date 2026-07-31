import {
    ErrorDetails,
    ErrorTypes,
    type ErrorData,
} from 'hls.js';
import {
    type HlsPlaybackEngineType,
    type HlsPlaybackEvidence,
    HlsPlaybackDisposition,
    HlsPlaybackFailure,
    HlsPlaybackStage,
    HlsPlaybackUnknownEngineType,
    type PlaybackDiagnosticCode,
    PlaybackDiagnosticCode as DiagnosticCode,
} from './playback-diagnostics.model';

const ENGINE_TYPES = new Set<string>(Object.values(ErrorTypes));
const ENGINE_DETAILS = new Set<string>(Object.values(ErrorDetails));

const MANIFEST_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.MANIFEST_LOAD_ERROR,
    ErrorDetails.MANIFEST_LOAD_TIMEOUT,
    ErrorDetails.MANIFEST_PARSING_ERROR,
    ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
]);

const LEVEL_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.LEVEL_EMPTY_ERROR,
    ErrorDetails.LEVEL_LOAD_ERROR,
    ErrorDetails.LEVEL_LOAD_TIMEOUT,
    ErrorDetails.LEVEL_PARSING_ERROR,
    ErrorDetails.LEVEL_SWITCH_ERROR,
    ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
    ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT,
    ErrorDetails.SUBTITLE_LOAD_ERROR,
    ErrorDetails.SUBTITLE_TRACK_LOAD_TIMEOUT,
]);

const SEGMENT_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.FRAG_LOAD_ERROR,
    ErrorDetails.FRAG_LOAD_TIMEOUT,
    ErrorDetails.FRAG_DECRYPT_ERROR,
    ErrorDetails.FRAG_PARSING_ERROR,
    ErrorDetails.FRAG_GAP,
]);

const KEY_SYSTEM_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.KEY_SYSTEM_NO_KEYS,
    ErrorDetails.KEY_SYSTEM_NO_ACCESS,
    ErrorDetails.KEY_SYSTEM_NO_SESSION,
    ErrorDetails.KEY_SYSTEM_NO_CONFIGURED_LICENSE,
    ErrorDetails.KEY_SYSTEM_LICENSE_REQUEST_FAILED,
    ErrorDetails.KEY_SYSTEM_SERVER_CERTIFICATE_REQUEST_FAILED,
    ErrorDetails.KEY_SYSTEM_SERVER_CERTIFICATE_UPDATE_FAILED,
    ErrorDetails.KEY_SYSTEM_SESSION_UPDATE_FAILED,
    ErrorDetails.KEY_SYSTEM_STATUS_OUTPUT_RESTRICTED,
    ErrorDetails.KEY_SYSTEM_STATUS_INTERNAL_ERROR,
    ErrorDetails.KEY_SYSTEM_DESTROY_MEDIA_KEYS_ERROR,
    ErrorDetails.KEY_SYSTEM_DESTROY_CLOSE_SESSION_ERROR,
    ErrorDetails.KEY_SYSTEM_DESTROY_REMOVE_SESSION_ERROR,
]);

const KEY_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.KEY_LOAD_ERROR,
    ErrorDetails.KEY_LOAD_TIMEOUT,
    ...KEY_SYSTEM_DETAILS,
]);

const MEDIA_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.REMUX_ALLOC_ERROR,
    ErrorDetails.BUFFER_ADD_CODEC_ERROR,
    ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR,
    ErrorDetails.BUFFER_APPEND_ERROR,
    ErrorDetails.BUFFER_APPENDING_ERROR,
    ErrorDetails.BUFFER_STALLED_ERROR,
    ErrorDetails.BUFFER_FULL_ERROR,
    ErrorDetails.BUFFER_SEEK_OVER_HOLE,
    ErrorDetails.BUFFER_NUDGE_ON_STALL,
    ErrorDetails.ATTACH_MEDIA_ERROR,
]);

const TIMEOUT_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.MANIFEST_LOAD_TIMEOUT,
    ErrorDetails.LEVEL_LOAD_TIMEOUT,
    ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT,
    ErrorDetails.SUBTITLE_TRACK_LOAD_TIMEOUT,
    ErrorDetails.FRAG_LOAD_TIMEOUT,
    ErrorDetails.KEY_LOAD_TIMEOUT,
    ErrorDetails.ASSET_LIST_LOAD_TIMEOUT,
]);

const NETWORK_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.MANIFEST_LOAD_ERROR,
    ErrorDetails.LEVEL_LOAD_ERROR,
    ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
    ErrorDetails.SUBTITLE_LOAD_ERROR,
    ErrorDetails.FRAG_LOAD_ERROR,
    ErrorDetails.KEY_LOAD_ERROR,
    ErrorDetails.ASSET_LIST_LOAD_ERROR,
]);

const CODEC_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
    ErrorDetails.BUFFER_ADD_CODEC_ERROR,
    ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR,
]);

const DRM_DETAILS = new Set<ErrorDetails>([
    ErrorDetails.FRAG_DECRYPT_ERROR,
    ...KEY_SYSTEM_DETAILS,
]);

export function createHlsPlaybackEvidence(
    data: ErrorData
): HlsPlaybackEvidence {
    const engineType = getEngineType(data.type);
    const engineDetails = getEngineDetails(data.details);
    const httpStatus = getHttpStatus(data.response?.code);
    const evidence: HlsPlaybackEvidence = {
        engineType,
        engineDetails,
        disposition:
            data.fatal === true
                ? HlsPlaybackDisposition.Fatal
                : HlsPlaybackDisposition.Recoverable,
        stage: getStage(engineDetails),
        failure: getFailure(engineType, engineDetails, httpStatus),
    };

    return httpStatus === undefined
        ? evidence
        : { ...evidence, httpStatus };
}

export function getHlsPlaybackDiagnosticCode(
    evidence: HlsPlaybackEvidence
): PlaybackDiagnosticCode {
    if (CODEC_DETAILS.has(evidence.engineDetails)) {
        return DiagnosticCode.UnsupportedCodec;
    }

    if (
        evidence.engineType === ErrorTypes.KEY_SYSTEM_ERROR ||
        DRM_DETAILS.has(evidence.engineDetails)
    ) {
        return DiagnosticCode.DrmOrEncryption;
    }

    if (evidence.failure === HlsPlaybackFailure.Access) {
        return DiagnosticCode.BrowserAccessError;
    }

    if (
        evidence.engineType === ErrorTypes.NETWORK_ERROR ||
        evidence.failure === HlsPlaybackFailure.Http ||
        evidence.failure === HlsPlaybackFailure.Timeout ||
        evidence.failure === HlsPlaybackFailure.Network
    ) {
        return DiagnosticCode.NetworkError;
    }

    if (
        evidence.engineType === ErrorTypes.MEDIA_ERROR ||
        evidence.engineType === ErrorTypes.MUX_ERROR
    ) {
        return DiagnosticCode.MediaDecodeError;
    }

    return DiagnosticCode.UnknownPlaybackError;
}

function getEngineType(value: unknown): HlsPlaybackEngineType {
    return typeof value === 'string' && ENGINE_TYPES.has(value)
        ? (value as ErrorTypes)
        : HlsPlaybackUnknownEngineType;
}

function getEngineDetails(value: unknown): ErrorDetails {
    return typeof value === 'string' && ENGINE_DETAILS.has(value)
        ? (value as ErrorDetails)
        : ErrorDetails.UNKNOWN;
}

function getHttpStatus(value: unknown): number | undefined {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
        ? value
        : undefined;
}

function getStage(details: ErrorDetails): HlsPlaybackEvidence['stage'] {
    if (MANIFEST_DETAILS.has(details)) {
        return HlsPlaybackStage.Manifest;
    }
    if (LEVEL_DETAILS.has(details)) {
        return HlsPlaybackStage.Level;
    }
    if (SEGMENT_DETAILS.has(details)) {
        return HlsPlaybackStage.Segment;
    }
    if (KEY_DETAILS.has(details)) {
        return HlsPlaybackStage.Key;
    }
    if (MEDIA_DETAILS.has(details)) {
        return HlsPlaybackStage.Media;
    }
    return HlsPlaybackStage.Unknown;
}

function getFailure(
    engineType: HlsPlaybackEngineType,
    details: ErrorDetails,
    httpStatus: number | undefined
): HlsPlaybackEvidence['failure'] {
    if (TIMEOUT_DETAILS.has(details)) {
        return HlsPlaybackFailure.Timeout;
    }
    if (
        httpStatus !== undefined &&
        httpStatus >= 400 &&
        httpStatus <= 599
    ) {
        return HlsPlaybackFailure.Http;
    }
    if (
        engineType === ErrorTypes.NETWORK_ERROR ||
        NETWORK_DETAILS.has(details)
    ) {
        return HlsPlaybackFailure.Network;
    }
    return HlsPlaybackFailure.Unknown;
}
