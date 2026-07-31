import type {
    HlsPlaybackEvidence,
    MpegTsPlaybackErrorInput,
    NativePlaybackErrorInput,
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    PlaybackSourceMetadata,
    VhsPlaybackEngineType as VhsPlaybackEngineTypeValue,
    VhsPlaybackEvidence,
} from './playback-diagnostics.model';
import { PlaybackDiagnosticCode as DiagnosticCode } from './playback-diagnostics.model';
import { HlsPlaybackDisposition } from './playback-diagnostics.model';
import { PlaybackDiagnosticSource as DiagnosticSource } from './playback-diagnostics.model';
import {
    VhsPlaybackEngineType,
    VhsPlaybackMediaErrorCode,
} from './playback-diagnostics.model';
import { getHlsPlaybackDiagnosticCode } from './hls-playback-evidence.util';
import {
    isBrowserAccessFailure,
    isEarlyEofFailure,
    isNetworkFailure,
    normalizeErrorDetails,
} from './playback-error-patterns.util';
import { isLikelyContainerIssue } from './playback-media-source.util';
import { createVhsPlaybackEvidence } from './vhs-playback-evidence.util';

export * from './playback-diagnostics.model';
export { createHlsPlaybackEvidence } from './hls-playback-evidence.util';
export { createVhsPlaybackEvidence } from './vhs-playback-evidence.util';
export {
    createPlaybackSourceMetadata,
    getLikelyBrowserUnsupportedCodecLabels,
    getPlaybackMediaExtensionFromUrl,
} from './playback-media-source.util';

const SOURCE_NOT_SUPPORTED_CODE = 4;
const DECODE_ERROR_CODE = 3;
const NETWORK_ERROR_CODE = 2;
const NATIVE_ERROR_TYPE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const VHS_NETWORK_ERROR_TYPES: ReadonlySet<VhsPlaybackEngineTypeValue> =
    new Set([
        VhsPlaybackEngineType.NetworkBadStatus,
        VhsPlaybackEngineType.NetworkRequestFailed,
        VhsPlaybackEngineType.NetworkRequestAborted,
        VhsPlaybackEngineType.NetworkRequestTimeout,
        VhsPlaybackEngineType.NetworkBodyParserFailed,
    ]);

export function classifyNativePlaybackIssue(
    error: NativePlaybackErrorInput | MediaError | null | undefined,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const nativeErrorCode = error?.code;
    const nativeErrorMessage = error?.message || undefined;
    const nativeErrorInput = error as
        NativePlaybackErrorInput | null | undefined;
    const httpStatus = getNativeHttpStatus(nativeErrorInput?.status);
    const nativeErrorType = getNativeErrorType(
        nativeErrorInput?.metadata?.errorType
    );
    const lowerNativeErrorMessage = nativeErrorMessage?.toLowerCase() ?? '';

    if (httpStatus !== undefined) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.NetworkError,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
            httpStatus,
            nativeErrorType,
        });
    }

    if (nativeErrorCode === NETWORK_ERROR_CODE) {
        // Native MediaError details are often opaque for browser security
        // failures. Only classify browser access when the runtime exposes a
        // concrete CORS/mixed-content/CSP-style message.
        return createPlaybackDiagnostic({
            code: isBrowserAccessFailure(lowerNativeErrorMessage)
                ? DiagnosticCode.BrowserAccessError
                : DiagnosticCode.NetworkError,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
            nativeErrorType,
        });
    }

    if (nativeErrorCode === DECODE_ERROR_CODE) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
            nativeErrorType,
        });
    }

    if (nativeErrorCode === SOURCE_NOT_SUPPORTED_CODE) {
        return createPlaybackDiagnostic({
            code: isLikelyContainerIssue(metadata)
                ? DiagnosticCode.UnsupportedContainer
                : DiagnosticCode.UnknownPlaybackError,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
            nativeErrorType,
        });
    }

    return createPlaybackDiagnostic({
        code: DiagnosticCode.UnknownPlaybackError,
        source: DiagnosticSource.Native,
        metadata,
        nativeErrorCode,
        nativeErrorMessage,
        nativeErrorType,
    });
}

export function classifyVhsPlaybackIssue(
    error: NativePlaybackErrorInput,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const evidence = createVhsPlaybackEvidence(error);
    const code = getVhsPlaybackDiagnosticCode(evidence, metadata);

    return createPlaybackDiagnostic({
        code,
        source: DiagnosticSource.Vhs,
        metadata,
        nativeErrorCode:
            typeof evidence.mediaErrorCode === 'number'
                ? evidence.mediaErrorCode
                : undefined,
        httpStatus: evidence.httpStatus,
        vhs: evidence,
    });
}

export function classifyHlsPlaybackIssue(
    evidence: HlsPlaybackEvidence,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic | null {
    if (evidence.disposition === HlsPlaybackDisposition.Recoverable) {
        return null;
    }

    return createPlaybackDiagnostic({
        code: getHlsPlaybackDiagnosticCode(evidence),
        source: DiagnosticSource.Hls,
        metadata,
        httpStatus: evidence.httpStatus,
        hls: evidence,
    });
}

export function classifyMpegTsPlaybackIssue(
    error: MpegTsPlaybackErrorInput,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const details = normalizeErrorDetails(error);
    const lowerDetails = details.toLowerCase();
    const lowerType = (error.type ?? '').toLowerCase();

    if (isEarlyEofFailure(lowerDetails)) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (isNetworkFailure(lowerType, lowerDetails)) {
        return createPlaybackDiagnostic({
            code: isBrowserAccessFailure(lowerDetails)
                ? DiagnosticCode.BrowserAccessError
                : DiagnosticCode.NetworkError,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerDetails.includes('codec')) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.UnsupportedCodec,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerDetails.includes('format') || lowerDetails.includes('mse')) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.UnsupportedContainer,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerType.includes('media')) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    return createPlaybackDiagnostic({
        code: DiagnosticCode.UnknownPlaybackError,
        source: DiagnosticSource.MpegTs,
        metadata,
        details,
    });
}

export function classifyUnsupportedHlsManifestCodecs(
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic | null {
    if (!hasCodecs(metadata) || typeof MediaSource === 'undefined') {
        return null;
    }

    const codecList = [...metadata.videoCodecs, ...metadata.audioCodecs];
    const mimeType = `video/mp4; codecs="${codecList.join(',')}"`;

    if (MediaSource.isTypeSupported(mimeType)) {
        return null;
    }

    return createPlaybackDiagnostic({
        code: DiagnosticCode.UnsupportedCodec,
        source: DiagnosticSource.Source,
        metadata,
        details: mimeType,
    });
}

export function createPlaybackDiagnostic(options: {
    readonly code: PlaybackDiagnosticCode;
    readonly source: PlaybackDiagnosticSource;
    readonly metadata: PlaybackSourceMetadata;
    readonly details?: string;
    readonly nativeErrorCode?: number;
    readonly nativeErrorMessage?: string;
    readonly httpStatus?: number;
    readonly nativeErrorType?: string;
    readonly vhs?: VhsPlaybackEvidence;
    readonly hls?: HlsPlaybackEvidence;
    /** Overrides the code-derived recommendation, e.g. when external players
     * are known to be unable to handle the stream either. */
    readonly externalFallbackRecommended?: boolean;
}): PlaybackDiagnostic {
    const {
        code,
        source,
        metadata,
        details,
        nativeErrorCode,
        nativeErrorMessage,
        httpStatus,
        nativeErrorType,
        vhs,
        hls,
    } = options;

    return {
        code,
        source,
        sourceUrl: metadata.url,
        container: metadata.container,
        mimeType: metadata.mimeType,
        player: metadata.player,
        audioCodecs: metadata.audioCodecs,
        videoCodecs: metadata.videoCodecs,
        details: details || undefined,
        nativeErrorCode,
        nativeErrorMessage,
        httpStatus,
        nativeErrorType,
        vhs,
        hls,
        externalFallbackRecommended:
            options.externalFallbackRecommended ??
            isExternalFallbackRecommended(code),
    };
}

function getVhsPlaybackDiagnosticCode(
    evidence: VhsPlaybackEvidence,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnosticCode {
    if (
        evidence.httpStatus !== undefined ||
        VHS_NETWORK_ERROR_TYPES.has(evidence.engineType) ||
        evidence.mediaErrorCode === VhsPlaybackMediaErrorCode.Network
    ) {
        return DiagnosticCode.NetworkError;
    }

    if (
        evidence.engineType ===
            VhsPlaybackEngineType.StreamingFailedToDecryptSegment ||
        evidence.mediaErrorCode === VhsPlaybackMediaErrorCode.Encrypted
    ) {
        return DiagnosticCode.DrmOrEncryption;
    }

    if (
        evidence.mediaErrorCode ===
            VhsPlaybackMediaErrorCode.SourceNotSupported &&
        isLikelyContainerIssue(metadata)
    ) {
        return DiagnosticCode.UnsupportedContainer;
    }

    return DiagnosticCode.UnknownPlaybackError;
}

function getNativeHttpStatus(status: unknown): number | undefined {
    return typeof status === 'number' &&
        Number.isInteger(status) &&
        status >= 400 &&
        status <= 599
        ? status
        : undefined;
}

function getNativeErrorType(errorType: unknown): string | undefined {
    return typeof errorType === 'string' &&
        NATIVE_ERROR_TYPE_PATTERN.test(errorType)
        ? errorType
        : undefined;
}

function isExternalFallbackRecommended(code: PlaybackDiagnosticCode): boolean {
    return (
        code === DiagnosticCode.UnsupportedContainer ||
        code === DiagnosticCode.UnsupportedCodec ||
        code === DiagnosticCode.MediaDecodeError ||
        code === DiagnosticCode.BrowserAccessError ||
        code === DiagnosticCode.DrmOrEncryption
    );
}

function hasCodecs(metadata: PlaybackSourceMetadata): boolean {
    return metadata.audioCodecs.length > 0 || metadata.videoCodecs.length > 0;
}
