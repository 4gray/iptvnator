import {
    type ShakaPlaybackCategory as ShakaPlaybackCategoryValue,
    type ShakaPlaybackDisposition,
    type ShakaPlaybackEvidence,
    type ShakaPlaybackFailure as ShakaPlaybackFailureValue,
    type ShakaPlaybackStage as ShakaPlaybackStageValue,
    ShakaPlaybackCategory,
    ShakaPlaybackFailure,
    ShakaPlaybackSeverity,
    ShakaPlaybackStage,
    ShakaPlaybackUnknownCode,
} from '../playback-diagnostics/playback-diagnostics.model';
import {
    SHAKA_ERROR_CATEGORY,
    SHAKA_ERROR_CODE,
    SHAKA_ERROR_SEVERITY,
} from './shaka-error-contract';
import {
    SHAKA_AMBIGUOUS_MANIFEST_CODES,
    SHAKA_DRM_CODES,
    SHAKA_LICENSE_STAGE_CODES,
    SHAKA_MANIFEST_CODES,
    SHAKA_MANIFEST_DRM_CODES,
    SHAKA_MANIFEST_MEDIA_CODES,
    SHAKA_MEDIA_CODES,
    SHAKA_MEDIA_STAGE_CODES,
    SHAKA_NESTED_HTTP_CODES,
    SHAKA_NETWORK_CODES,
    SHAKA_PUBLIC_CODES,
    SHAKA_SEGMENT_STAGE_CODES,
} from './shaka-error-mapping';
import type { ShakaErrorLike } from './shaka-module.types';

export function createShakaPlaybackEvidence(
    error: Partial<ShakaErrorLike> | null | undefined,
    disposition: ShakaPlaybackDisposition
): ShakaPlaybackEvidence {
    const category = getCategory(error?.category);
    const engineCode = getEngineCode(error?.code);
    const httpStatus = getHttpStatus(error);
    const evidence: ShakaPlaybackEvidence = {
        severity: getSeverity(error?.severity),
        category,
        engineCode,
        disposition,
        stage: getStage(category, engineCode),
        failure: getFailure(category, engineCode),
    };

    return httpStatus === undefined ? evidence : { ...evidence, httpStatus };
}

function getSeverity(value: unknown): ShakaPlaybackEvidence['severity'] {
    if (value === SHAKA_ERROR_SEVERITY.RECOVERABLE) {
        return ShakaPlaybackSeverity.Recoverable;
    }
    if (value === SHAKA_ERROR_SEVERITY.CRITICAL) {
        return ShakaPlaybackSeverity.Critical;
    }
    return ShakaPlaybackSeverity.Unknown;
}

function getCategory(value: unknown): ShakaPlaybackCategoryValue {
    switch (value) {
        case SHAKA_ERROR_CATEGORY.NETWORK:
            return ShakaPlaybackCategory.Network;
        case SHAKA_ERROR_CATEGORY.TEXT:
            return ShakaPlaybackCategory.Text;
        case SHAKA_ERROR_CATEGORY.MEDIA:
            return ShakaPlaybackCategory.Media;
        case SHAKA_ERROR_CATEGORY.MANIFEST:
            return ShakaPlaybackCategory.Manifest;
        case SHAKA_ERROR_CATEGORY.STREAMING:
            return ShakaPlaybackCategory.Streaming;
        case SHAKA_ERROR_CATEGORY.DRM:
            return ShakaPlaybackCategory.Drm;
        case SHAKA_ERROR_CATEGORY.PLAYER:
            return ShakaPlaybackCategory.Player;
        case SHAKA_ERROR_CATEGORY.CAST:
            return ShakaPlaybackCategory.Cast;
        case SHAKA_ERROR_CATEGORY.STORAGE:
            return ShakaPlaybackCategory.Storage;
        case SHAKA_ERROR_CATEGORY.ADS:
            return ShakaPlaybackCategory.Ads;
        default:
            return ShakaPlaybackCategory.Unknown;
    }
}

function getEngineCode(value: unknown): ShakaPlaybackEvidence['engineCode'] {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        SHAKA_PUBLIC_CODES.has(value)
        ? value
        : ShakaPlaybackUnknownCode;
}

function getFailure(
    category: ShakaPlaybackCategoryValue,
    engineCode: ShakaPlaybackEvidence['engineCode']
): ShakaPlaybackFailureValue {
    if (
        category === ShakaPlaybackCategory.Network &&
        typeof engineCode === 'number' &&
        SHAKA_NETWORK_CODES.has(engineCode)
    ) {
        return ShakaPlaybackFailure.Network;
    }
    if (
        category === ShakaPlaybackCategory.Drm &&
        typeof engineCode === 'number' &&
        SHAKA_DRM_CODES.has(engineCode)
    ) {
        return ShakaPlaybackFailure.Drm;
    }
    if (
        category === ShakaPlaybackCategory.Media &&
        typeof engineCode === 'number' &&
        SHAKA_MEDIA_CODES.has(engineCode)
    ) {
        return ShakaPlaybackFailure.Media;
    }
    if (
        category === ShakaPlaybackCategory.Manifest &&
        typeof engineCode === 'number'
    ) {
        if (SHAKA_MANIFEST_DRM_CODES.has(engineCode)) {
            return ShakaPlaybackFailure.Drm;
        }
        if (SHAKA_MANIFEST_MEDIA_CODES.has(engineCode)) {
            return ShakaPlaybackFailure.Media;
        }
        if (
            SHAKA_MANIFEST_CODES.has(engineCode) &&
            !SHAKA_AMBIGUOUS_MANIFEST_CODES.has(engineCode)
        ) {
            return ShakaPlaybackFailure.Manifest;
        }
    }
    return ShakaPlaybackFailure.Unknown;
}

function getStage(
    category: ShakaPlaybackCategoryValue,
    engineCode: ShakaPlaybackEvidence['engineCode']
): ShakaPlaybackStageValue {
    if (typeof engineCode !== 'number') {
        return ShakaPlaybackStage.Unknown;
    }
    if (
        category === ShakaPlaybackCategory.Manifest &&
        SHAKA_MANIFEST_CODES.has(engineCode)
    ) {
        return ShakaPlaybackStage.Manifest;
    }
    if (
        (category === ShakaPlaybackCategory.Network &&
            engineCode === SHAKA_ERROR_CODE.SEGMENT_MISSING) ||
        (category === ShakaPlaybackCategory.Media &&
            SHAKA_SEGMENT_STAGE_CODES.has(engineCode))
    ) {
        return ShakaPlaybackStage.Segment;
    }
    if (
        category === ShakaPlaybackCategory.Media &&
        SHAKA_MEDIA_STAGE_CODES.has(engineCode)
    ) {
        return ShakaPlaybackStage.Media;
    }
    if (
        category === ShakaPlaybackCategory.Drm &&
        SHAKA_LICENSE_STAGE_CODES.has(engineCode)
    ) {
        return ShakaPlaybackStage.License;
    }
    return ShakaPlaybackStage.Unknown;
}

function getHttpStatus(
    error: Partial<ShakaErrorLike> | null | undefined
): number | undefined {
    if (
        error?.category === SHAKA_ERROR_CATEGORY.NETWORK &&
        error.code === SHAKA_ERROR_CODE.BAD_HTTP_STATUS
    ) {
        return asHttpStatus(error.data?.[1]);
    }

    if (
        error?.category !== SHAKA_ERROR_CATEGORY.DRM ||
        typeof error.code !== 'number' ||
        !SHAKA_NESTED_HTTP_CODES.has(error.code)
    ) {
        return undefined;
    }

    const nested = asShakaErrorData(error.data?.[0]);
    return nested?.category === SHAKA_ERROR_CATEGORY.NETWORK &&
        nested.code === SHAKA_ERROR_CODE.BAD_HTTP_STATUS
        ? asHttpStatus(nested.data?.[1])
        : undefined;
}

function asShakaErrorData(value: unknown): Partial<ShakaErrorLike> | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const candidate = value as {
        readonly severity?: unknown;
        readonly category?: unknown;
        readonly code?: unknown;
        readonly data?: unknown;
    };
    return {
        severity:
            typeof candidate.severity === 'number'
                ? candidate.severity
                : undefined,
        category:
            typeof candidate.category === 'number'
                ? candidate.category
                : undefined,
        code: typeof candidate.code === 'number' ? candidate.code : undefined,
        data: Array.isArray(candidate.data) ? candidate.data : undefined,
    };
}

function asHttpStatus(value: unknown): number | undefined {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
        ? value
        : undefined;
}
