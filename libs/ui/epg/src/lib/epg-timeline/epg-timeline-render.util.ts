import { TIMELINE_MINUTE_MS, TimelineBlock } from './epg-timeline.utils';

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
            (block.when === 'past' || block.when === 'now') &&
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
        // Never fold the on-air programme into a "N short" group chip — that
        // drops its `when: 'now'` highlight and leaves the auto-focused viewport
        // centred on a chip with no visible "now" state. Keep it standalone.
        if (
            allowGroup &&
            block.durationMin < TIMELINE_SHORT_MAX_MIN &&
            block.when !== 'now'
        ) {
            run.push(block);
            continue;
        }
        flushRun();
        pushBlock(block);
    }
    flushRun();

    return items;
}
