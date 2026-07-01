/**
 * Collapsed-summary payload (the current / archive programme shown when the
 * panel is collapsed). View-agnostic so a future list view can reuse the same
 * summary shape and progress maths.
 */
export interface EpgTimelineSummary {
    readonly title?: string | null;
    readonly start?: string | number | Date | null;
    readonly stop?: string | number | Date | null;
    readonly progress?: number | null;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

function toTimeMs(
    value: string | number | Date | null | undefined
): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed =
        value instanceof Date
            ? value.getTime()
            : typeof value === 'number'
              ? value
              : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Whether the summary has a non-blank title. */
export function summaryHasTitle(
    summary: EpgTimelineSummary | null | undefined
): boolean {
    const title = summary?.title;
    return typeof title === 'string' && title.trim().length > 0;
}

/** Whether the summary carries a start or stop time. */
export function summaryHasTimeRange(
    summary: EpgTimelineSummary | null | undefined
): boolean {
    return !!summary?.start || !!summary?.stop;
}

/** Progress 0–100 for the summary at `nowMs`, or null when it can't be computed. */
export function summaryProgress(
    summary: EpgTimelineSummary | null | undefined,
    nowMs: number
): number | null {
    if (!summary) {
        return null;
    }
    const explicit = Number(summary.progress);
    if (Number.isFinite(explicit)) {
        return clampPercent(explicit);
    }
    const startMs = toTimeMs(summary.start);
    const stopMs = toTimeMs(summary.stop);
    if (startMs === null || stopMs === null || stopMs <= startMs) {
        return null;
    }
    return clampPercent(((nowMs - startMs) / (stopMs - startMs)) * 100);
}

/** Whole minutes left until the summary's stop, or null. */
export function summaryMinutesLeft(
    summary: EpgTimelineSummary | null | undefined,
    nowMs: number
): number | null {
    const stopMs = toTimeMs(summary?.stop);
    if (stopMs === null) {
        return null;
    }
    return Math.max(0, Math.round((stopMs - nowMs) / 60_000));
}

/** HH:MM clock label for a timestamp. */
export function formatClockTime(ms: number): string {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
