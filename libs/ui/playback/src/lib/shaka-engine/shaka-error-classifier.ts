import type {
    PlaybackDiagnostic,
    PlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.model';
import {
    PlaybackDiagnosticCode as DiagnosticCode,
    PlaybackDiagnosticSource as DiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.model';
import { createPlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';
import {
    isBrowserAccessFailure,
    isCodecFailure,
    isDrmOrEncryptionFailure,
} from '../playback-diagnostics/playback-error-patterns.util';
import type { ShakaErrorLike } from './shaka-module.types';

/**
 * Numeric `shaka.util.Error.Category` values (stable public Shaka API). Kept
 * local so classification stays a pure function that does not need the lazily
 * loaded module.
 */
const SHAKA_CATEGORY = {
    Network: 1,
    Text: 2,
    Media: 3,
    Manifest: 4,
    Streaming: 5,
    Drm: 6,
} as const;

/** `shaka.util.Error.Code.RESTRICTIONS_CANNOT_BE_MET` — in practice this fires
 * when every variant is restricted by unusable decryption keys. */
const RESTRICTIONS_CANNOT_BE_MET = 4012;

export function classifyShakaPlaybackIssue(
    error: Partial<ShakaErrorLike> | null | undefined,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const details = formatShakaErrorDetails(error);
    const lowerDetails = details.toLowerCase();
    const category = error?.category;

    if (
        category === SHAKA_CATEGORY.Drm ||
        error?.code === RESTRICTIONS_CANNOT_BE_MET ||
        isDrmOrEncryptionFailure(lowerDetails)
    ) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.DrmOrEncryption,
            source: DiagnosticSource.Shaka,
            metadata,
            details,
        });
    }

    if (category === SHAKA_CATEGORY.Network) {
        return createPlaybackDiagnostic({
            code: isBrowserAccessFailure(lowerDetails)
                ? DiagnosticCode.BrowserAccessError
                : DiagnosticCode.NetworkError,
            source: DiagnosticSource.Shaka,
            metadata,
            details,
        });
    }

    if (
        category === SHAKA_CATEGORY.Media ||
        category === SHAKA_CATEGORY.Streaming
    ) {
        return createPlaybackDiagnostic({
            code: isCodecFailure(lowerDetails)
                ? DiagnosticCode.UnsupportedCodec
                : DiagnosticCode.MediaDecodeError,
            source: DiagnosticSource.Shaka,
            metadata,
            details,
        });
    }

    if (category === SHAKA_CATEGORY.Manifest) {
        return createPlaybackDiagnostic({
            code: DiagnosticCode.UnsupportedContainer,
            source: DiagnosticSource.Shaka,
            metadata,
            details,
        });
    }

    return createPlaybackDiagnostic({
        code: DiagnosticCode.UnknownPlaybackError,
        source: DiagnosticSource.Shaka,
        metadata,
        details,
    });
}

/**
 * Diagnostic for `.mpd` channels that declare a DRM system the app cannot
 * handle (Widevine, PlayReady, malformed ClearKey config, …). Emitted before
 * any Shaka engine is started.
 */
export function createUnsupportedDrmDiagnostic(
    licenseType: string,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    return createPlaybackDiagnostic({
        code: DiagnosticCode.DrmOrEncryption,
        source: DiagnosticSource.Shaka,
        metadata,
        details: licenseType
            ? `Unsupported DRM license configuration: ${licenseType}`
            : 'Unsupported DRM license configuration',
    });
}

function formatShakaErrorDetails(
    error: Partial<ShakaErrorLike> | null | undefined
): string {
    if (!error) {
        return '';
    }

    const parts = [
        typeof error.category === 'number'
            ? `Shaka category ${error.category}`
            : '',
        typeof error.code === 'number' ? `code ${error.code}` : '',
        error.message ?? '',
        stringifyErrorData(error.data),
    ];

    return parts.filter((part) => part.length > 0).join(' ');
}

function stringifyErrorData(data: unknown[] | undefined): string {
    if (!data || data.length === 0) {
        return '';
    }

    try {
        const serialized = JSON.stringify(data);
        return serialized === '[]' ? '' : serialized;
    } catch {
        return '';
    }
}
