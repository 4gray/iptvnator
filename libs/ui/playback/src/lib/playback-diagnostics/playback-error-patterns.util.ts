import type {
    HlsPlaybackErrorInput,
    MpegTsPlaybackErrorInput,
} from './playback-diagnostics.model';

export function normalizeErrorDetails(
    error: HlsPlaybackErrorInput | MpegTsPlaybackErrorInput
): string {
    const hlsError = 'error' in error ? error.error : undefined;
    const mpegTsInfo = 'info' in error ? error.info : undefined;
    const errorMessage = normalizeErrorPayload(hlsError);
    const info = normalizeErrorPayload(mpegTsInfo);

    return [error.details, error.message, errorMessage, info]
        .filter((part): part is string => Boolean(part))
        .join(' ');
}

export function isNetworkFailure(type: string, details: string): boolean {
    return (
        type.includes('network') ||
        details.includes('network') ||
        details.includes('loaderror') ||
        details.includes('timeout') ||
        details.includes('status')
    );
}

export function isBrowserAccessFailure(details: string): boolean {
    return (
        details.includes('cors') ||
        details.includes('cross-origin') ||
        details.includes('cross origin') ||
        details.includes('access-control') ||
        details.includes('access control') ||
        details.includes('content security policy') ||
        details.includes('mixed content') ||
        details.includes('private network access') ||
        details.includes('blocked by content security') ||
        details.includes('blocked by cors') ||
        details.includes('blocked by mixed content') ||
        details.includes('not allowed to load local resource') ||
        details.includes('err_blocked') ||
        details.includes('err_cleartext')
    );
}

export function isEarlyEofFailure(details: string): boolean {
    const compactDetails = details.replace(/[^a-z0-9]/g, '');
    return compactDetails.includes('earlyeof');
}

export function isCodecFailure(details: string): boolean {
    return (
        details.includes('codec') ||
        details.includes('incompatiblecodecs') ||
        details.includes('addcodec')
    );
}

export function isDrmOrEncryptionFailure(details: string): boolean {
    return (
        details.includes('decrypt') ||
        details.includes('keysystem') ||
        details.includes('keyload') ||
        details.includes('license') ||
        details.includes('drm')
    );
}

function normalizeErrorPayload(payload: unknown): string {
    if (!payload) {
        return '';
    }

    if (typeof payload === 'string') {
        return payload;
    }

    if (payload instanceof Error) {
        const extraDetails = stringifyUnknown(payload);
        return [payload.message, extraDetails === '{}' ? '' : extraDetails]
            .filter(Boolean)
            .join(' ');
    }

    return stringifyUnknown(payload);
}

function stringifyUnknown(value: unknown): string {
    try {
        return JSON.stringify(value) || '';
    } catch {
        return String(value);
    }
}
