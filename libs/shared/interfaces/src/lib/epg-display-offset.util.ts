/**
 * Global EPG display-time correction (`Settings.epgOffsetMinutes`).
 *
 * Some XMLTV and portal feeds label programme times with the wrong timezone.
 * The offset corrects that on the DISPLAY side only: parsed XMLTV values,
 * SQLite rows, catch-up URLs and recording snapshots keep the provider's own
 * times, so changing the value never requires a guide refresh.
 *
 * The correction has exactly two equivalent forms, and every consumer must
 * apply ONE of them per comparison — never both, or the shift doubles:
 *
 * - **Display form** — `epgDisplayTimeMs(rawMs, offset)`: shift a
 *   programme's timestamp by `+offset`, then compare it with wall-clock now
 *   or format it for the user. Used where programmes are rendered (timeline
 *   geometry, list rows, clock labels).
 * - **Clock form** — `epgProviderClockMs(nowMs, offset)`: express wall-clock
 *   now in the provider's uncorrected clock (`now - offset`) and compare it
 *   with the raw programme times. Used where a "currently airing" decision is
 *   made over raw data that is handed on unchanged (the backend SQL lookup,
 *   store selectors, progress bars, recording windows).
 */

import type { EpgItem } from './epg-item.interface';

export const EPG_OFFSET_MIN_MINUTES = -720;
export const EPG_OFFSET_MAX_MINUTES = 720;

const MINUTE_MS = 60_000;

/**
 * Clamps a persisted or user-entered offset to whole minutes within the
 * supported range. Anything that is not a finite number (absent, `null`,
 * a blank string, a boolean) collapses to `0`.
 */
export function normalizeEpgOffsetMinutes(value: unknown): number {
    const offset =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : Number.NaN;
    if (!Number.isFinite(offset)) {
        return 0;
    }
    return Math.min(
        EPG_OFFSET_MAX_MINUTES,
        Math.max(EPG_OFFSET_MIN_MINUTES, Math.trunc(offset))
    );
}

/** The normalized offset in milliseconds. */
export function epgOffsetMs(offsetMinutes: number): number {
    return normalizeEpgOffsetMinutes(offsetMinutes) * MINUTE_MS;
}

/**
 * Display form: a raw provider timestamp shifted into the user's corrected
 * time. `NaN` passes through so callers keep their own validity checks.
 */
export function epgDisplayTimeMs(rawMs: number, offsetMinutes: number): number {
    return rawMs + epgOffsetMs(offsetMinutes);
}

/**
 * Clock form: a wall-clock instant expressed in the provider's uncorrected
 * clock, for comparing against raw programme times. Equivalent to shifting
 * every programme by `+offset` and comparing with `nowMs`.
 */
export function epgProviderClockMs(
    nowMs: number,
    offsetMinutes: number
): number {
    return nowMs - epgOffsetMs(offsetMinutes);
}

/** Assumed minimum programme length when widening a short-EPG window. */
export const SHORT_EPG_SLOT_MINUTES = 15;
/** Upper bound for a widened short-EPG window. */
export const SHORT_EPG_WINDOW_MAX = 50;

/**
 * Number of short-EPG entries to request so the window still reaches the
 * programme on air under a display offset. Portal short-EPG endpoints
 * (Xtream `get_short_epg`, Stalker `get_short_epg`) always start at the
 * provider's own "now": under a negative offset the programme actually on
 * air lies `|offset|` further ahead, so the window is widened assuming
 * programmes of at least `SHORT_EPG_SLOT_MINUTES`. A positive offset needs
 * the provider's past, which no window size can return — callers that have
 * a full guide cut it with `windowEpgItemsAtProviderClock` instead.
 */
export function shortEpgWindowSize(
    offsetMinutes: number,
    baseSize: number
): number {
    if (!(offsetMinutes < 0)) {
        return baseSize;
    }
    return Math.min(
        SHORT_EPG_WINDOW_MAX,
        baseSize + Math.ceil(-offsetMinutes / SHORT_EPG_SLOT_MINUTES)
    );
}

function epgItemSeconds(item: EpgItem, side: 'start' | 'stop'): number {
    const raw = Number(
        side === 'start' ? item.start_timestamp : item.stop_timestamp
    );
    if (Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    const parsed = Date.parse(
        (side === 'start' ? item.start : (item.stop ?? item.end)) ?? ''
    );
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN;
}

/**
 * Cuts the same window a short-EPG request would return — the first `limit`
 * programmes still airing or upcoming — out of a full guide, but at the
 * provider clock (`epgProviderClockMs`) rather than at the provider's own
 * "now". This is how preview surfaces stay correct under a display offset:
 * the full guide reaches into the provider's past, the short EPG does not.
 */
export function windowEpgItemsAtProviderClock(
    items: readonly EpgItem[],
    offsetMinutes: number,
    limit: number,
    nowMs = Date.now()
): EpgItem[] {
    const nowSeconds = Math.floor(
        epgProviderClockMs(nowMs, offsetMinutes) / 1000
    );
    return [...items]
        .sort(
            (left, right) =>
                epgItemSeconds(left, 'start') - epgItemSeconds(right, 'start')
        )
        .filter((item) => epgItemSeconds(item, 'stop') > nowSeconds)
        .slice(0, limit);
}
