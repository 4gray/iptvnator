import type {
    HlsPlaybackErrorInput,
    MpegTsPlaybackErrorInput,
    NativePlaybackErrorInput,
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    PlaybackSourceMetadata,
} from './playback-diagnostics.model';
import { PlaybackDiagnosticCode as DiagnosticCode } from './playback-diagnostics.model';
import { PlaybackDiagnosticSource as DiagnosticSource } from './playback-diagnostics.model';
import {
    isBrowserAccessFailure,
    isCodecFailure,
    isDrmOrEncryptionFailure,
    isEarlyEofFailure,
    isNetworkFailure,
    normalizeErrorDetails,
} from './playback-error-patterns.util';
import {
    isLikelyContainerIssue,
    mergeCodecMetadata,
} from './playback-media-source.util';

export * from './playback-diagnostics.model';
export {
    createPlaybackSourceMetadata,
    getLikelyBrowserUnsupportedCodecLabels,
    getPlaybackMediaExtensionFromUrl,
} from './playback-media-source.util';

const SOURCE_NOT_SUPPORTED_CODE = 4;
const DECODE_ERROR_CODE = 3;
const NETWORK_ERROR_CODE = 2;

export function classifyNativePlaybackIssue(
    error: NativePlaybackErrorInput | MediaError | null | undefined,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const nativeErrorCode = error?.code;
    const nativeErrorMessage = error?.message || undefined;
    const lowerNativeErrorMessage = nativeErrorMessage?.toLowerCase() ?? '';

    if (nativeErrorCode === NETWORK_ERROR_CODE) {
        // Native MediaError details are often opaque for browser security
        // failures. Only classify browser access when the runtime exposes a
        // concrete CORS/mixed-content/CSP-style message.
        return createDiagnostic({
            code: isBrowserAccessFailure(lowerNativeErrorMessage)
                ? DiagnosticCode.BrowserAccessError
                : DiagnosticCode.NetworkError,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
        });
    }

    if (nativeErrorCode === DECODE_ERROR_CODE) {
        return createDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
        });
    }

    if (nativeErrorCode === SOURCE_NOT_SUPPORTED_CODE) {
        return createDiagnostic({
            code: isLikelyContainerIssue(metadata)
                ? DiagnosticCode.UnsupportedContainer
                : DiagnosticCode.UnsupportedCodec,
            source: DiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
        });
    }

    return createDiagnostic({
        code: DiagnosticCode.UnknownPlaybackError,
        source: DiagnosticSource.Native,
        metadata,
        nativeErrorCode,
        nativeErrorMessage,
    });
}

export function classifyHlsPlaybackIssue(
    error: HlsPlaybackErrorInput,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const details = normalizeErrorDetails(error);
    const lowerDetails = details.toLowerCase();
    const lowerType = (error.type ?? '').toLowerCase();
    const mergedMetadata = mergeCodecMetadata(metadata, {
        audioCodecs: error.audioCodecs,
        videoCodecs: error.videoCodecs,
    });

    if (isNetworkFailure(lowerType, lowerDetails)) {
        return createDiagnostic({
            code: isBrowserAccessFailure(lowerDetails)
                ? DiagnosticCode.BrowserAccessError
                : DiagnosticCode.NetworkError,
            source: DiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    if (isDrmOrEncryptionFailure(lowerDetails)) {
        return createDiagnostic({
            code: DiagnosticCode.DrmOrEncryption,
            source: DiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    if (isCodecFailure(lowerDetails)) {
        return createDiagnostic({
            code: DiagnosticCode.UnsupportedCodec,
            source: DiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    if (lowerType.includes('media') || lowerType.includes('mux')) {
        return createDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    return createDiagnostic({
        code: DiagnosticCode.UnknownPlaybackError,
        source: DiagnosticSource.Hls,
        metadata: mergedMetadata,
        details,
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
        return createDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (isNetworkFailure(lowerType, lowerDetails)) {
        return createDiagnostic({
            code: isBrowserAccessFailure(lowerDetails)
                ? DiagnosticCode.BrowserAccessError
                : DiagnosticCode.NetworkError,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerDetails.includes('codec')) {
        return createDiagnostic({
            code: DiagnosticCode.UnsupportedCodec,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerDetails.includes('format') || lowerDetails.includes('mse')) {
        return createDiagnostic({
            code: DiagnosticCode.UnsupportedContainer,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerType.includes('media')) {
        return createDiagnostic({
            code: DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    return createDiagnostic({
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

    return createDiagnostic({
        code: DiagnosticCode.UnsupportedCodec,
        source: DiagnosticSource.Source,
        metadata,
        details: mimeType,
    });
}

function createDiagnostic(options: {
    readonly code: PlaybackDiagnosticCode;
    readonly source: PlaybackDiagnosticSource;
    readonly metadata: PlaybackSourceMetadata;
    readonly details?: string;
    readonly nativeErrorCode?: number;
    readonly nativeErrorMessage?: string;
}): PlaybackDiagnostic {
    const {
        code,
        source,
        metadata,
        details,
        nativeErrorCode,
        nativeErrorMessage,
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
        externalFallbackRecommended: isExternalFallbackRecommended(code),
    };
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
