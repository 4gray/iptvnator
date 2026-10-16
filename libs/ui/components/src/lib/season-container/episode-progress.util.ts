import { parseDurationSeconds } from '@iptvnator/portal/shared/util';

/** Pure helpers for episode duration parsing. */

export function parseDuration(duration: string | number | undefined): number {
    return parseDurationSeconds(duration);
}

/** The episode runtime: the provider's `duration_secs` first, then its formatted `duration`. */
export function episodeRuntimeSeconds(
    info: { duration_secs?: number; duration?: string } | null | undefined
): number {
    const seconds = Number(info?.duration_secs);
    return Number.isFinite(seconds) && seconds > 0
        ? Math.floor(seconds)
        : parseDuration(info?.duration);
}
