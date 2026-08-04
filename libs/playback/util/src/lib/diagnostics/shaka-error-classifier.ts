import type {
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackSourceMetadata,
    ShakaPlaybackDisposition,
    ShakaPlaybackEvidence,
} from './playback-diagnostics.model';
import {
    PlaybackDiagnosticCode as DiagnosticCode,
    PlaybackDiagnosticSource as DiagnosticSource,
    ShakaPlaybackCategory,
    ShakaPlaybackDisposition as ShakaDisposition,
    ShakaPlaybackFailure,
} from './playback-diagnostics.model';
import { createPlaybackDiagnostic } from './playback-diagnostics.util';
import { SHAKA_ERROR_CODE } from './shaka-error-contract';
import { createShakaPlaybackEvidence } from './shaka-playback-evidence.util';
import type { ShakaErrorLike } from './shaka-error.types';

export {
    SHAKA_DIAGNOSTIC_VERSION,
    SHAKA_ERROR_CATEGORY,
    SHAKA_ERROR_CODE,
    SHAKA_ERROR_SEVERITY,
} from './shaka-error-contract';
export { createShakaPlaybackEvidence } from './shaka-playback-evidence.util';

const MEDIA_DECODE_CODES = new Set<number>([
    SHAKA_ERROR_CODE.MEDIA_SOURCE_OPERATION_FAILED,
    SHAKA_ERROR_CODE.MEDIA_SOURCE_OPERATION_THREW,
    SHAKA_ERROR_CODE.VIDEO_ERROR,
]);

export function classifyShakaPlaybackIssue(
    error: Partial<ShakaErrorLike> | null | undefined,
    metadata: PlaybackSourceMetadata,
    disposition: ShakaPlaybackDisposition
): PlaybackDiagnostic | null {
    const evidence = createShakaPlaybackEvidence(error, disposition);
    if (evidence.disposition === ShakaDisposition.Recoverable) {
        return null;
    }

    return createPlaybackDiagnostic({
        code: getDiagnosticCode(evidence),
        source: DiagnosticSource.Shaka,
        metadata,
        httpStatus: evidence.httpStatus,
        shaka: evidence,
    });
}

function getDiagnosticCode(
    evidence: ShakaPlaybackEvidence
): PlaybackDiagnosticCode {
    if (evidence.failure === ShakaPlaybackFailure.Network) {
        return DiagnosticCode.NetworkError;
    }
    if (evidence.failure === ShakaPlaybackFailure.Drm) {
        return DiagnosticCode.DrmOrEncryption;
    }
    if (
        evidence.category === ShakaPlaybackCategory.Manifest &&
        evidence.engineCode === SHAKA_ERROR_CODE.DASH_UNSUPPORTED_CONTAINER
    ) {
        return DiagnosticCode.UnsupportedContainer;
    }
    if (
        evidence.category === ShakaPlaybackCategory.Media &&
        typeof evidence.engineCode === 'number' &&
        MEDIA_DECODE_CODES.has(evidence.engineCode)
    ) {
        return DiagnosticCode.MediaDecodeError;
    }
    return DiagnosticCode.UnknownPlaybackError;
}

/**
 * Diagnostic for `.mpd` channels that declare a DRM system the app cannot
 * handle. Provider-supplied license strings are intentionally not retained.
 */
export function createUnsupportedDrmDiagnostic(
    _licenseType: string,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    return createPlaybackDiagnostic({
        code: DiagnosticCode.DrmOrEncryption,
        source: DiagnosticSource.Shaka,
        metadata,
        details: 'Unsupported DRM license configuration',
    });
}

/** Narrows an unknown rejection to a Shaka-error-like shape, if it is one. */
export function asShakaError(error: unknown): Partial<ShakaErrorLike> | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const candidate = error as Partial<ShakaErrorLike>;
    return typeof candidate.code === 'number' ||
        typeof candidate.category === 'number' ||
        typeof candidate.severity === 'number'
        ? candidate
        : null;
}
