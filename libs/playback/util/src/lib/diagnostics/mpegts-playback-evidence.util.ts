import {
    type MpegTsPlaybackEngineDetails as MpegTsPlaybackEngineDetailsValue,
    type MpegTsPlaybackEngineType as MpegTsPlaybackEngineTypeValue,
    type MpegTsPlaybackEvidence,
    type MpegTsPlaybackFailure as MpegTsPlaybackFailureValue,
    type MpegTsPlaybackStage as MpegTsPlaybackStageValue,
    MpegTsPlaybackDisposition,
    MpegTsPlaybackEngineDetails,
    MpegTsPlaybackEngineType,
    MpegTsPlaybackFailure,
    MpegTsPlaybackStage,
} from './mpegts-playback-evidence.model';

export const MPEGTS_DIAGNOSTIC_VERSION = '1.8.0';

interface MpegTsPlaybackCause {
    readonly stage: MpegTsPlaybackStageValue;
    readonly failure: MpegTsPlaybackFailureValue;
}

export function createMpegTsPlaybackEvidence(
    type: unknown,
    details: unknown,
    info: unknown
): MpegTsPlaybackEvidence {
    const engineType = normalizeEngineType(type);
    const engineDetails = normalizeEngineDetails(details);
    const cause = deriveMpegTsPlaybackCause(engineType, engineDetails);
    const httpStatus =
        engineType === MpegTsPlaybackEngineType.Network &&
        engineDetails ===
            MpegTsPlaybackEngineDetails.HttpStatusCodeInvalid
            ? readHttpStatus(info)
            : undefined;

    return {
        engineType,
        engineDetails,
        disposition: MpegTsPlaybackDisposition.Terminal,
        ...cause,
        ...(httpStatus === undefined ? {} : { httpStatus }),
    };
}

function normalizeEngineType(value: unknown): MpegTsPlaybackEngineTypeValue {
    switch (value) {
        case MpegTsPlaybackEngineType.Network:
        case MpegTsPlaybackEngineType.Media:
        case MpegTsPlaybackEngineType.Other:
            return value;
        default:
            return MpegTsPlaybackEngineType.Unknown;
    }
}

function normalizeEngineDetails(
    value: unknown
): MpegTsPlaybackEngineDetailsValue {
    switch (value) {
        case MpegTsPlaybackEngineDetails.NetworkException:
        case MpegTsPlaybackEngineDetails.HttpStatusCodeInvalid:
        case MpegTsPlaybackEngineDetails.ConnectingTimeout:
        case MpegTsPlaybackEngineDetails.UnrecoverableEarlyEof:
        case MpegTsPlaybackEngineDetails.MediaMseError:
        case MpegTsPlaybackEngineDetails.FormatError:
        case MpegTsPlaybackEngineDetails.FormatUnsupported:
        case MpegTsPlaybackEngineDetails.CodecUnsupported:
            return value;
        default:
            return MpegTsPlaybackEngineDetails.Unknown;
    }
}

function deriveMpegTsPlaybackCause(
    type: MpegTsPlaybackEngineTypeValue,
    details: MpegTsPlaybackEngineDetailsValue
): MpegTsPlaybackCause {
    if (type === MpegTsPlaybackEngineType.Network) {
        return deriveNetworkCause(details);
    }
    if (type === MpegTsPlaybackEngineType.Media) {
        return deriveMediaCause(details);
    }
    return unknownCause();
}

function deriveNetworkCause(
    details: MpegTsPlaybackEngineDetailsValue
): MpegTsPlaybackCause {
    switch (details) {
        case MpegTsPlaybackEngineDetails.HttpStatusCodeInvalid:
            return cause(
                MpegTsPlaybackStage.Loader,
                MpegTsPlaybackFailure.Http
            );
        case MpegTsPlaybackEngineDetails.ConnectingTimeout:
            return cause(
                MpegTsPlaybackStage.Loader,
                MpegTsPlaybackFailure.Timeout
            );
        case MpegTsPlaybackEngineDetails.NetworkException:
            return cause(
                MpegTsPlaybackStage.Loader,
                MpegTsPlaybackFailure.Network
            );
        case MpegTsPlaybackEngineDetails.UnrecoverableEarlyEof:
            return cause(
                MpegTsPlaybackStage.Loader,
                MpegTsPlaybackFailure.TruncatedStream
            );
        default:
            return unknownCause();
    }
}

function deriveMediaCause(
    details: MpegTsPlaybackEngineDetailsValue
): MpegTsPlaybackCause {
    switch (details) {
        case MpegTsPlaybackEngineDetails.FormatError:
        case MpegTsPlaybackEngineDetails.FormatUnsupported:
            return cause(
                MpegTsPlaybackStage.Demux,
                MpegTsPlaybackFailure.Format
            );
        case MpegTsPlaybackEngineDetails.CodecUnsupported:
            return cause(
                MpegTsPlaybackStage.Demux,
                MpegTsPlaybackFailure.Codec
            );
        case MpegTsPlaybackEngineDetails.MediaMseError:
            return cause(
                MpegTsPlaybackStage.MediaSource,
                MpegTsPlaybackFailure.MediaSource
            );
        default:
            return unknownCause();
    }
}

function cause(
    stage: MpegTsPlaybackStageValue,
    failure: MpegTsPlaybackFailureValue
): MpegTsPlaybackCause {
    return { stage, failure };
}

function unknownCause(): MpegTsPlaybackCause {
    return cause(
        MpegTsPlaybackStage.Unknown,
        MpegTsPlaybackFailure.Unknown
    );
}

function readHttpStatus(info: unknown): number | undefined {
    if (typeof info !== 'object' || info === null || Array.isArray(info)) {
        return undefined;
    }

    const code = (info as Readonly<Record<string, unknown>>)['code'];
    return typeof code === 'number' &&
        Number.isInteger(code) &&
        code >= 400 &&
        code <= 599
        ? code
        : undefined;
}
