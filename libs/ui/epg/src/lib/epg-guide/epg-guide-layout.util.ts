import { EpgProgram } from '@iptvnator/shared/interfaces';
import { addDays, addMinutes } from 'date-fns';
import { parseEpgDateKey } from '../epg-date';
import {
    buildTimelineBlocks,
    TimelineAxis,
} from '../epg-timeline/epg-timeline.utils';
import {
    buildTimelineRenderItems,
    TimelineRenderBlock,
} from '../epg-timeline/epg-timeline-render.util';

const HOUR_MS = 3_600_000;

/** Pixels per hour. */
export const EPG_GUIDE_ZOOM_MIN = 120;
export const EPG_GUIDE_ZOOM_MAX = 480;
export const EPG_GUIDE_ZOOM_STEP = 20;
export const EPG_GUIDE_ZOOM_DEFAULT = 240;

export type EpgGuideDensity = 'comfortable' | 'compact';
export const EPG_GUIDE_ROW_HEIGHT_PX: Record<EpgGuideDensity, number> = {
    comfortable: 60,
    compact: 44,
};
export const EPG_GUIDE_CHANNEL_COLUMN_PX = 232;
/** Rows loaded ahead of the rendered range, in each direction. */
export const EPG_GUIDE_ROW_BUFFER = 10;

/**
 * Guide rows are shorter (44–60px) than the timeline ribbon, so the shared
 * `TIMELINE_MIN_BLOCK_WIDTH_PX`/`TIMELINE_BLOCK_GAP_PX` floor (40px/4px) is
 * too generous here — it would make `tierFor`'s micro branch unreachable at
 * common zoom levels. The guide uses its own, tighter floor and gap.
 */
export const EPG_GUIDE_MIN_BLOCK_WIDTH_PX = 14;
export const EPG_GUIDE_BLOCK_GAP_PX = 3;

/** One selected day in DISPLAY time (local midnight to local midnight). */
export interface EpgGuideDayAxis extends TimelineAxis {
    readonly dayKey: string;
}

export interface EpgGuideTick {
    readonly ms: number;
    readonly leftPx: number;
    readonly kind: 'hour' | 'half';
}

export interface EpgGuideRowLayoutOptions {
    readonly axis: EpgGuideDayAxis;
    readonly hourWidthPx: number;
    readonly nowMs: number;
    readonly offsetMinutes: number;
    readonly catchUpAvailable?: boolean;
}

/**
 * A DST transition day is 23 or 25 hours, not 24 — `addDays` walks the
 * calendar (local midnight to local midnight), so `endMs - startMs` is not a
 * fixed constant. `guideTrackWidthPx` and `buildGuideTicks` below derive their
 * geometry from that span instead of assuming a 24-hour day.
 */
export function buildGuideDayAxis(dayKey: string): EpgGuideDayAxis {
    const start = parseEpgDateKey(dayKey);
    return {
        dayKey,
        startMs: start.getTime(),
        endMs: addDays(start, 1).getTime(),
    };
}

export function guideTrackWidthPx(
    axis: TimelineAxis,
    hourWidthPx: number
): number {
    return ((axis.endMs - axis.startMs) / HOUR_MS) * hourWidthPx;
}

export function guideXForMs(
    axis: TimelineAxis,
    ms: number,
    hourWidthPx: number
): number {
    return ((ms - axis.startMs) / HOUR_MS) * hourWidthPx;
}

/** x of the now-line, or null when "now" is not on the selected day. */
export function guideNowLeftPx(
    axis: TimelineAxis,
    nowMs: number,
    hourWidthPx: number
): number | null {
    if (nowMs < axis.startMs || nowMs >= axis.endMs) {
        return null;
    }
    return guideXForMs(axis, nowMs, hourWidthPx);
}

/**
 * Ticks every 30 minutes from the axis start until the axis end, which — on a
 * DST transition day — is not a multiple of 1440 minutes of wall-clock time.
 * Iterating by adding 30-minute steps to the start `Date` (rather than
 * looping a fixed minute count) keeps every tick's local time correct across
 * the transition.
 */
export function buildGuideTicks(
    axis: TimelineAxis,
    hourWidthPx: number
): EpgGuideTick[] {
    const ticks: EpgGuideTick[] = [];
    const start = new Date(axis.startMs);
    for (let index = 0; ; index += 1) {
        const ms = addMinutes(start, index * 30).getTime();
        if (ms >= axis.endMs) {
            break;
        }
        ticks.push({
            ms,
            leftPx: guideXForMs(axis, ms, hourWidthPx),
            kind: new Date(ms).getMinutes() === 0 ? 'hour' : 'half',
        });
    }
    return ticks;
}

/**
 * Positioned blocks for one channel row, sharing the timeline's block maths
 * (`buildTimelineBlocks` → `buildTimelineRenderItems`) so both guides agree
 * on tiers and the on-now fill, though the guide applies its own tighter
 * minimum width and gap (`EPG_GUIDE_MIN_BLOCK_WIDTH_PX`/
 * `EPG_GUIDE_BLOCK_GAP_PX`) sized for its shorter rows. Programmes are shifted
 * into display time by `offsetMinutes` and compared with the wall-clock
 * `nowMs` (the display form of the EPG offset contract). Short-run grouping
 * is off: a grid row has no room for group chips.
 *
 * A programme that started the previous day and is still airing keeps a
 * negative `leftPx` (it is not re-clamped to the axis start) — the caller's
 * lane must clip with `overflow: hidden` rather than relying on layout to
 * hide the offscreen portion.
 */
export function buildGuideRowBlocks(
    programs: readonly EpgProgram[],
    options: EpgGuideRowLayoutOptions
): TimelineRenderBlock[] {
    const { axis, hourWidthPx, nowMs, offsetMinutes } = options;
    const blocks = buildTimelineBlocks(
        programs,
        axis,
        nowMs,
        offsetMinutes
    ).filter(
        (block) => block.stopMs > axis.startMs && block.startMs < axis.endMs
    );
    const items = buildTimelineRenderItems(blocks, hourWidthPx / 60, {
        minWidthPx: EPG_GUIDE_MIN_BLOCK_WIDTH_PX,
        gapPx: EPG_GUIDE_BLOCK_GAP_PX,
        allowGroup: false,
        nowMs,
        archivePlaybackAvailable: options.catchUpAvailable ?? false,
    });
    return items.filter(
        (item): item is TimelineRenderBlock => item.kind === 'block'
    );
}
