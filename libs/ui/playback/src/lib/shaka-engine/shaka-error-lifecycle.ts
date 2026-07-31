import { ShakaPlaybackDisposition as ShakaDisposition } from '../playback-diagnostics/playback-diagnostics.model';
import {
    SHAKA_ERROR_CATEGORY,
    SHAKA_ERROR_CODE,
    SHAKA_ERROR_SEVERITY,
} from './shaka-error-contract';
import type { ShakaErrorLike } from './shaka-module.types';

export function getShakaErrorEventDisposition(
    error: Partial<ShakaErrorLike> | null
): (typeof ShakaDisposition)[keyof typeof ShakaDisposition] | null {
    if (error?.severity === SHAKA_ERROR_SEVERITY.RECOVERABLE) {
        return ShakaDisposition.Recoverable;
    }
    if (error?.severity === SHAKA_ERROR_SEVERITY.CRITICAL) {
        return ShakaDisposition.Terminal;
    }
    return null;
}

export function isShakaLoadInterrupted(
    error: Partial<ShakaErrorLike> | null
): boolean {
    return (
        error?.severity === SHAKA_ERROR_SEVERITY.CRITICAL &&
        error.category === SHAKA_ERROR_CATEGORY.PLAYER &&
        error.code === SHAKA_ERROR_CODE.LOAD_INTERRUPTED
    );
}
