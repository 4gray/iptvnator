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
