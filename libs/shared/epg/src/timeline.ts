/** Provider-neutral geometry: timestamps are epoch milliseconds, never wall-clock strings. */
export interface TimelineAxis {
    readonly startMs: number;
    /** Exclusive end; a local day can contain 23, 24 or 25 hours. */
    readonly endMs: number;
}

export interface EpgGuideTick {
    readonly ms: number;
    readonly leftPx: number;
    readonly kind: 'hour' | 'half';
}

const HOUR_MS = 3_600_000;

export function guideTrackWidthPx(
    axis: TimelineAxis,
    hourWidthPx: number
): number {
    return ((axis.endMs - axis.startMs) / HOUR_MS) * hourWidthPx;
}

/** Projection intentionally retains negative positions for programmes crossing the axis. */
export function guideXForMs(
    axis: TimelineAxis,
    ms: number,
    hourWidthPx: number
): number {
    return ((ms - axis.startMs) / HOUR_MS) * hourWidthPx;
}

export function guideNowLeftPx(
    axis: TimelineAxis,
    nowMs: number,
    hourWidthPx: number
): number | null {
    if (nowMs < axis.startMs || nowMs >= axis.endMs) return null;
    return guideXForMs(axis, nowMs, hourWidthPx);
}

/** Elapsed half-hour ticks preserve both occurrences of the clock hour on DST fallback. */
export function buildGuideTicks(
    axis: TimelineAxis,
    hourWidthPx: number
): EpgGuideTick[] {
    const ticks: EpgGuideTick[] = [];
    if (
        !Number.isFinite(new Date(axis.startMs).getTime()) ||
        !Number.isFinite(new Date(axis.endMs).getTime())
    )
        return ticks;
    for (let ms = axis.startMs; ms < axis.endMs; ms += HOUR_MS / 2) {
        ticks.push({
            ms,
            leftPx: guideXForMs(axis, ms, hourWidthPx),
            kind: new Date(ms).getMinutes() === 0 ? 'hour' : 'half',
        });
    }
    return ticks;
}

/** Clip only at rendering boundaries; retain the original programme times for details. */
export function clipGuideSpan(
    axis: TimelineAxis,
    startMs: number,
    endMs: number
): TimelineAxis | null {
    if (![axis.startMs, axis.endMs, startMs, endMs].every(Number.isFinite))
        return null;
    const start = Math.max(axis.startMs, startMs);
    const end = Math.min(axis.endMs, endMs);
    return end > start ? { startMs: start, endMs: end } : null;
}
