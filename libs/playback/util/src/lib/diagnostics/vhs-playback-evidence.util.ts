import type {
    NativePlaybackErrorInput,
    VhsPlaybackEngineType as VhsPlaybackEngineTypeValue,
    VhsPlaybackEvidence,
    VhsPlaybackMediaErrorCode as VhsPlaybackMediaErrorCodeValue,
    VhsPlaybackStage as VhsPlaybackStageValue,
} from './playback-diagnostics.model';
import {
    VhsPlaybackDisposition,
    VhsPlaybackEngineType,
    VhsPlaybackMediaErrorCode,
    VhsPlaybackStage,
    VhsPlaybackUnknownEngineType,
} from './playback-diagnostics.model';

const ENGINE_TYPES = new Set<string>(Object.values(VhsPlaybackEngineType));
const SEGMENT_ENGINE_TYPES = new Set<VhsPlaybackEngineTypeValue>([
    VhsPlaybackEngineType.StreamingFailedToSelectNextSegment,
    VhsPlaybackEngineType.StreamingFailedToDecryptSegment,
    VhsPlaybackEngineType.StreamingFailedToTransmuxSegment,
    VhsPlaybackEngineType.StreamingFailedToAppendSegment,
]);

export function createVhsPlaybackEvidence(
    error: NativePlaybackErrorInput
): VhsPlaybackEvidence {
    const engineType = getEngineType(error.metadata?.errorType);
    const httpStatus = getHttpStatus(error.status);
    const evidence: VhsPlaybackEvidence = {
        engineType,
        mediaErrorCode: getMediaErrorCode(error.code),
        disposition: VhsPlaybackDisposition.Terminal,
        stage: getStage(engineType),
    };

    return httpStatus === undefined ? evidence : { ...evidence, httpStatus };
}

function getEngineType(value: unknown): VhsPlaybackEngineTypeValue {
    return typeof value === 'string' && ENGINE_TYPES.has(value)
        ? (value as VhsPlaybackEngineTypeValue)
        : VhsPlaybackUnknownEngineType;
}

function getMediaErrorCode(value: unknown): VhsPlaybackMediaErrorCodeValue {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= VhsPlaybackMediaErrorCode.Custom &&
        value <= VhsPlaybackMediaErrorCode.Encrypted
        ? (value as VhsPlaybackMediaErrorCodeValue)
        : VhsPlaybackMediaErrorCode.Unknown;
}

function getHttpStatus(value: unknown): number | undefined {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 400 &&
        value <= 599
        ? value
        : undefined;
}

function getStage(
    engineType: VhsPlaybackEngineTypeValue
): VhsPlaybackStageValue {
    if (engineType === VhsPlaybackEngineType.StreamingHlsPlaylistParserError) {
        return VhsPlaybackStage.Playlist;
    }
    if (engineType === VhsPlaybackEngineType.StreamingDashManifestParserError) {
        return VhsPlaybackStage.Manifest;
    }
    if (SEGMENT_ENGINE_TYPES.has(engineType)) {
        return VhsPlaybackStage.Segment;
    }
    return VhsPlaybackStage.Unknown;
}
