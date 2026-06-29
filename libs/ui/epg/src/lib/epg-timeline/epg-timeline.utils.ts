import { EpgProgram } from '@iptvnator/shared/interfaces';
import { addDays, addMinutes, startOfDay } from 'date-fns';
import { parseEpgDateKey } from '../epg-date';
import { getProgramDateKey, getProgramTimeMs } from '../epg-list/epg-list.utils';

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

// ───────────────────────── short-programme strategy ─────────────────────────
// A proportional ribbon makes a 5-minute programme a 2px sliver. The fixes:
//   A — a minimum block width so every programme stays clickable;
//   B — content tiers chosen by rendered width (wide → micro);
//   E — grouping runs of ≥4 consecutive short programmes when zoomed out.
// (C — the hover popover — and D — the zoom slider — live in the components.)

/** Smallest rendered block width; a sliver gets bumped up to this. */
export const TIMELINE_MIN_BLOCK_WIDTH_PX = 40;
/** Gap subtracted from each block so neighbours don't touch. */
export const TIMELINE_BLOCK_GAP_PX = 4;
/** Zoom (px/min) slider bounds. */
export const TIMELINE_ZOOM_MIN = 0.8;
export const TIMELINE_ZOOM_MAX = 6;
export const TIMELINE_ZOOM_STEP = 0.1;
/** Below this zoom, dense runs of short programmes collapse into a group chip. */
export const TIMELINE_GROUP_ZOOM_MAX = 1.3;
/** Zoom applied when a group chip is expanded. */
export const TIMELINE_GROUP_EXPAND_ZOOM = 3.4;
/** A programme is "short" below this duration (minutes). */
export const TIMELINE_SHORT_MAX_MIN = 10;
/** Minimum consecutive shorts before they group. */
export const TIMELINE_GROUP_MIN_RUN = 4;

export type TimelineTier = 'wide' | 'med' | 'narrow' | 'micro';

export interface TimelineRenderBlock {
    readonly kind: 'block';
    readonly key: string;
    readonly block: TimelineBlock;
    readonly leftPx: number;
    readonly widthPx: number;
    readonly tier: TimelineTier;
    /** Live progress 0–100 for the on-now block, else 0. */
    readonly nowFillPercent: number;
    /** Past programme playable from the catch-up archive. */
    readonly canCatchUp: boolean;
}

export interface TimelineRenderGroup {
    readonly kind: 'group';
    readonly key: string;
    readonly leftPx: number;
    readonly widthPx: number;
    readonly count: number;
    readonly startMs: number;
    readonly stopMs: number;
}

export type TimelineRenderItem = TimelineRenderBlock | TimelineRenderGroup;

export interface TimelineRenderOptions {
    readonly minWidthPx?: number;
    readonly gapPx?: number;
    readonly allowGroup?: boolean;
    readonly nowMs?: number;
    readonly archivePlaybackAvailable?: boolean;
    /** Earliest start playable from the archive; -Infinity = whole past. */
    readonly archiveWindowStartMs?: number;
}

/** Content tier for a block of the given rendered width. */
export function tierFor(widthPx: number): TimelineTier {
    if (widthPx >= 132) return 'wide';
    if (widthPx >= 70) return 'med';
    if (widthPx >= 30) return 'narrow';
    return 'micro';
}

/** Adaptive tick spacing (minutes) — denser as the user zooms in. */
export function timelineTickStepForScale(scale: number): number {
    if (scale < 2.2) return 120;
    if (scale < 3.5) return 60;
    if (scale < 5) return 30;
    return 15;
}

function nowFillFor(block: TimelineBlock, nowMs: number): number {
    if (block.when !== 'now') {
        return 0;
    }
    const total = block.stopMs - block.startMs;
    if (total <= 0) {
        return 0;
    }
    const pct = ((nowMs - block.startMs) / total) * 100;
    return Math.min(100, Math.max(0, pct));
}

function toRenderBlock(
    block: TimelineBlock,
    scale: number,
    minWidthPx: number,
    gapPx: number,
    nowMs: number,
    archivePlaybackAvailable: boolean,
    archiveWindowStartMs: number
): TimelineRenderBlock {
    const rawWidth = Math.max(minWidthPx, block.durationMin * scale);
    return {
        kind: 'block',
        key: block.key,
        block,
        leftPx: block.offsetMin * scale,
        widthPx: Math.max(minWidthPx - gapPx, rawWidth - gapPx),
        tier: tierFor(rawWidth),
        nowFillPercent: nowFillFor(block, nowMs),
        canCatchUp:
            archivePlaybackAvailable &&
            block.when === 'past' &&
            block.startMs >= archiveWindowStartMs,
    };
}

/**
 * Turn timeline blocks into positioned render items, applying the minimum-width
 * floor (A), per-width content tiers (B) and short-run grouping (E).
 */
export function buildTimelineRenderItems(
    blocks: readonly TimelineBlock[],
    scale: number,
    options: TimelineRenderOptions = {}
): TimelineRenderItem[] {
    const minWidthPx = options.minWidthPx ?? TIMELINE_MIN_BLOCK_WIDTH_PX;
    const gapPx = options.gapPx ?? TIMELINE_BLOCK_GAP_PX;
    const allowGroup = options.allowGroup ?? false;
    const nowMs = options.nowMs ?? Date.now();
    const archiveAvailable = options.archivePlaybackAvailable ?? false;
    const archiveWindowStartMs =
        options.archiveWindowStartMs ?? Number.NEGATIVE_INFINITY;

    const items: TimelineRenderItem[] = [];
    let run: TimelineBlock[] = [];

    const pushBlock = (block: TimelineBlock) =>
        items.push(
            toRenderBlock(
                block,
                scale,
                minWidthPx,
                gapPx,
                nowMs,
                archiveAvailable,
                archiveWindowStartMs
            )
        );

    const flushRun = () => {
        if (run.length >= TIMELINE_GROUP_MIN_RUN) {
            const first = run[0];
            const last = run[run.length - 1];
            const spanPx = ((last.stopMs - first.startMs) / TIMELINE_MINUTE_MS) * scale;
            items.push({
                kind: 'group',
                key: `group-${first.key}-${last.key}`,
                leftPx: first.offsetMin * scale,
                widthPx: Math.max(minWidthPx - gapPx, spanPx - gapPx),
                count: run.length,
                startMs: first.startMs,
                stopMs: last.stopMs,
            });
        } else {
            run.forEach(pushBlock);
        }
        run = [];
    };

    for (const block of blocks) {
        if (allowGroup && block.durationMin < TIMELINE_SHORT_MAX_MIN) {
            run.push(block);
            continue;
        }
        flushRun();
        pushBlock(block);
    }
    flushRun();

    return items;
}
