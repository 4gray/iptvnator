import { EpgProgram } from '@iptvnator/shared/interfaces';
import { addDays, addMinutes, startOfDay } from 'date-fns';
import { parseEpgDateKey } from '../epg-date';
import { getProgramDateKey, getProgramTimeMs } from '../epg-program.utils';

export const TIMELINE_MINUTE_MS = 60_000;
/** Pixels per minute on the ribbon (matches the prototype's SCALE). */
export const TIMELINE_DEFAULT_SCALE = 1.75;
/** Hour grid spacing in minutes (a tick every two hours). */
export const TIMELINE_TICK_STEP_MIN = 120;

export type TimelineWhen = 'past' | 'now' | 'future';

export interface TimelineAxis {
    /** Local-midnight ms of the first day shown. */
    readonly startMs: number;
    /** Local-midnight ms just after the last day shown. */
    readonly endMs: number;
}

export interface TimelineBlock {
    readonly program: EpgProgram;
    readonly key: string;
    readonly startMs: number;
    readonly stopMs: number;
    readonly when: TimelineWhen;
    /** Offset in minutes from the axis start. */
    readonly offsetMin: number;
    /** Duration in minutes. */
    readonly durationMin: number;
}

export interface TimelineTick {
    readonly ms: number;
    readonly offsetMin: number;
}

export interface TimelineDayDivider extends TimelineTick {
    /** Local-midnight ms of the day this divider opens. */
    readonly dayMs: number;
}

function minutesBetween(fromMs: number, toMs: number): number {
    return (toMs - fromMs) / TIMELINE_MINUTE_MS;
}

/**
 * Compute the local-day bounded axis spanning every loaded programme, always
 * widened to include "now" so the playhead stays on the ribbon.
 */
export function buildTimelineAxis(
    programs: readonly EpgProgram[],
    nowMs: number
): TimelineAxis {
    let minMs = nowMs;
    let maxMs = nowMs;

    for (const program of programs) {
        const startMs = getProgramTimeMs(program.start, program.startTimestamp);
        const stopMs = getProgramTimeMs(program.stop, program.stopTimestamp);
        if (Number.isFinite(startMs)) {
            minMs = Math.min(minMs, startMs);
        }
        if (Number.isFinite(stopMs)) {
            maxMs = Math.max(maxMs, stopMs);
        }
    }

    const startMs = startOfDay(minMs).getTime();
    // End is the local midnight strictly after the last moment shown.
    const endMs = addDays(startOfDay(maxMs), 1).getTime();

    return { startMs, endMs };
}

export function classifyTimelineWhen(
    startMs: number,
    stopMs: number,
    nowMs: number
): TimelineWhen {
    if (stopMs <= nowMs) {
        return 'past';
    }
    if (startMs <= nowMs) {
        return 'now';
    }
    return 'future';
}

export function buildTimelineBlocks(
    programs: readonly EpgProgram[],
    axis: TimelineAxis,
    nowMs: number
): TimelineBlock[] {
    const blocks: TimelineBlock[] = [];

    programs.forEach((program, index) => {
        const startMs = getProgramTimeMs(program.start, program.startTimestamp);
        const stopMs = getProgramTimeMs(program.stop, program.stopTimestamp);
        if (
            !Number.isFinite(startMs) ||
            !Number.isFinite(stopMs) ||
            stopMs <= startMs
        ) {
            return;
        }

        blocks.push({
            program,
            key: `${startMs}-${stopMs}-${index}`,
            startMs,
            stopMs,
            when: classifyTimelineWhen(startMs, stopMs, nowMs),
            offsetMin: minutesBetween(axis.startMs, startMs),
            durationMin: minutesBetween(startMs, stopMs),
        });
    });

    return blocks.sort((left, right) => left.startMs - right.startMs);
}

/** Time ticks at `stepMin` spacing, excluding local midnights (those are dividers). */
export function buildTimelineTicks(
    axis: TimelineAxis,
    stepMin: number = TIMELINE_TICK_STEP_MIN
): TimelineTick[] {
    const ticks: TimelineTick[] = [];
    const step = stepMin > 0 ? stepMin : TIMELINE_TICK_STEP_MIN;
    let cursor = new Date(axis.startMs);

    while (cursor.getTime() < axis.endMs) {
        const dayStart = startOfDay(cursor);
        for (let minute = step; minute < 1440; minute += step) {
            const tickMs = addMinutes(dayStart, minute).getTime();
            if (tickMs >= axis.endMs) {
                break;
            }
            ticks.push({
                ms: tickMs,
                offsetMin: minutesBetween(axis.startMs, tickMs),
            });
        }
        cursor = addDays(dayStart, 1);
    }

    return ticks;
}

export function buildTimelineDayDividers(axis: TimelineAxis): TimelineDayDivider[] {
    const dividers: TimelineDayDivider[] = [];
    let cursor = startOfDay(axis.startMs);

    while (cursor.getTime() < axis.endMs) {
        const dayMs = cursor.getTime();
        dividers.push({
            ms: dayMs,
            dayMs,
            offsetMin: minutesBetween(axis.startMs, dayMs),
        });
        cursor = addDays(cursor, 1);
    }

    return dividers;
}

/** Local-day key (yyyy-MM-dd) for the day currently centred in the viewport. */
export function dayKeyAtOffset(
    axis: TimelineAxis,
    offsetMin: number
): string {
    const ms = axis.startMs + offsetMin * TIMELINE_MINUTE_MS;
    return getProgramDateKey(new Date(ms).toISOString());
}

/**
 * Whether any programme overlaps the given local day. Overlap-based (not just
 * start-date), so a programme that starts the previous evening and runs past
 * midnight — e.g. a 23:10–02:14 film airing now — still counts for *today*. A
 * start-date-only check would key it to yesterday and the ribbon would wrongly
 * fall back to the `empty-day` state even though something is on air (the
 * sidebar, which matches by "airing now", would still show it — that asymmetry
 * was the bug).
 */
export function hasProgramsForDateKey(
    programs: readonly EpgProgram[],
    dateKey: string
): boolean {
    const dayStart = parseEpgDateKey(dateKey);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = addDays(dayStart, 1).getTime(); // exclusive

    return programs.some((program) => {
        const startMs = getProgramTimeMs(program.start, program.startTimestamp);
        const stopMs = getProgramTimeMs(program.stop, program.stopTimestamp);
        if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) {
            return false;
        }
        return startMs < dayEndMs && stopMs > dayStartMs;
    });
}

/** Nearest date key (yyyy-MM-dd) that actually has programmes, or null. */
export function nearestDateKeyWithPrograms(
    programs: readonly EpgProgram[],
    referenceMs: number
): string | null {
    let bestKey: string | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const program of programs) {
        const startMs = getProgramTimeMs(program.start, program.startTimestamp);
        if (!Number.isFinite(startMs)) {
            continue;
        }
        const delta = Math.abs(startMs - referenceMs);
        if (delta < bestDelta) {
            bestDelta = delta;
            bestKey = getProgramDateKey(program.start, program.startTimestamp);
        }
    }

    return bestKey;
}

// Short-programme render strategy (tiers, grouping, zoom bounds) lives in a
// sibling module; re-exported here so existing imports keep working.
export * from './epg-timeline-render.util';
