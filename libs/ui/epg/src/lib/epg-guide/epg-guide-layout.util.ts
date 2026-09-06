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

export function buildGuideDayAxis(dayKey: string): EpgGuideDayAxis {
    const start = parseEpgDateKey(dayKey);
    return {
        dayKey,
        startMs: start.getTime(),
        endMs: addDays(start, 1).getTime(),
    };
}

export function guideTrackWidthPx(hourWidthPx: number): number {
    return hourWidthPx * 24;
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

export function buildGuideTicks(
    axis: TimelineAxis,
    hourWidthPx: number
): EpgGuideTick[] {
    const ticks: EpgGuideTick[] = [];
    const start = new Date(axis.startMs);
    for (let minute = 0; minute < 24 * 60; minute += 30) {
        const ms = addMinutes(start, minute).getTime();
        ticks.push({
            ms,
            leftPx: guideXForMs(axis, ms, hourWidthPx),
            kind: minute % 60 === 0 ? 'hour' : 'half',
        });
    }
    return ticks;
}

/**
 * Positioned blocks for one channel row, sharing the timeline's block maths
 * (`buildTimelineBlocks` → `buildTimelineRenderItems`) so both guides agree
 * on tiers, minimum widths and the on-now fill. Programmes are shifted into
 * display time by `offsetMinutes` and compared with the wall-clock `nowMs`
 * (the display form of the EPG offset contract). Short-run grouping is off:
 * a grid row has no room for group chips.
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
        allowGroup: false,
        nowMs,
        archivePlaybackAvailable: options.catchUpAvailable ?? false,
    });
    return items.filter(
        (item): item is TimelineRenderBlock => item.kind === 'block'
    );
}
