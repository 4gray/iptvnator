import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    buildGuideDayAxis,
    buildGuideRowBlocks,
    buildGuideTicks,
    EPG_GUIDE_ZOOM_DEFAULT,
    guideNowLeftPx,
    guideTrackWidthPx,
    guideXForMs,
} from './epg-guide-layout.util';

const HOUR = 3_600_000;

function program(startMs: number, stopMs: number, title = 'P'): EpgProgram {
    return {
        start: new Date(startMs).toISOString(),
        stop: new Date(stopMs).toISOString(),
        channel: 'ch',
        title,
        desc: null,
        category: null,
    };
}

describe('epg-guide-layout.util', () => {
    const axis = buildGuideDayAxis('2026-09-06');

    it('builds a local-midnight day axis of exactly 24 hours', () => {
        expect(axis.dayKey).toBe('2026-09-06');
        expect(axis.endMs - axis.startMs).toBe(24 * HOUR);
        expect(new Date(axis.startMs).getHours()).toBe(0);
    });

    it('places a tick every 30 minutes, hours emphasised', () => {
        const ticks = buildGuideTicks(axis, 240);
        expect(ticks).toHaveLength(48);
        expect(ticks[0]).toEqual({ ms: axis.startMs, leftPx: 0, kind: 'hour' });
        expect(ticks[1]).toEqual({
            ms: axis.startMs + HOUR / 2,
            leftPx: 120,
            kind: 'half',
        });
        expect(guideTrackWidthPx(axis, 240)).toBe(5760);
    });

    it('maps instants to x by the hour width and hides "now" outside the day', () => {
        expect(guideXForMs(axis, axis.startMs + 2 * HOUR, 240)).toBe(480);
        expect(guideNowLeftPx(axis, axis.startMs + HOUR, 240)).toBe(240);
        expect(guideNowLeftPx(axis, axis.startMs, 240)).toBe(0);
        expect(guideNowLeftPx(axis, axis.startMs - 1, 240)).toBeNull();
        expect(guideNowLeftPx(axis, axis.endMs, 240)).toBeNull();
    });

    // A DST transition day is 23 or 25 hours, so `endMs - startMs` is not a
    // fixed 24h — track width and tick count must scale with the axis span
    // rather than assuming a fixed day length. `TZ` cannot be pinned per test
    // in a running Node process, so these assert relative invariants that
    // hold in every timezone, and actually exercise the 23h/25h cases when
    // the test machine is in a European zone (2026-10-25 falls back,
    // 2026-03-29 springs forward).
    it('derives track width and tick count from the axis span, not a fixed 24h day', () => {
        for (const dayKey of ['2026-10-25', '2026-03-29']) {
            const dstAxis = buildGuideDayAxis(dayKey);
            const spanHours = (dstAxis.endMs - dstAxis.startMs) / HOUR;
            expect(guideTrackWidthPx(dstAxis, 240)).toBe(spanHours * 240);
            expect(buildGuideTicks(dstAxis, 240)).toHaveLength(spanHours * 2);
        }
    });

    it('lays out programmes overlapping the day, including boundary crossers, with tiers', () => {
        const nowMs = axis.startMs + 16 * HOUR + 4 * 60_000;
        const blocks = buildGuideRowBlocks(
            [
                program(axis.startMs - HOUR, axis.startMs + HOUR, 'Crosser'),
                program(
                    axis.startMs + 16 * HOUR,
                    axis.startMs + 16.75 * HOUR,
                    'Now'
                ),
                program(
                    axis.startMs + 17 * HOUR,
                    axis.startMs + 17 * HOUR + 5 * 60_000,
                    'Micro'
                ),
                program(axis.endMs + HOUR, axis.endMs + 2 * HOUR, 'Tomorrow'),
            ],
            {
                axis,
                hourWidthPx: EPG_GUIDE_ZOOM_DEFAULT,
                nowMs,
                offsetMinutes: 0,
            }
        );
        expect(blocks.map((block) => block.block.program.title)).toEqual([
            'Crosser',
            'Now',
            'Micro',
        ]);
        expect(blocks[0].leftPx).toBe(-240);
        expect(blocks[1].block.when).toBe('now');
        expect(blocks[1].nowFillPercent).toBeCloseTo((4 / 45) * 100, 3);
        // 5 min at 240px/h = 20px raw, below the guide's 30px "micro" cutoff
        // now that the guide floor (14px) no longer bumps it up to 40px.
        expect(blocks[2].tier).toBe('micro');
        expect(blocks[2].widthPx).toBe(17);
    });

    it('reports "narrow" just above the micro cutoff', () => {
        // 15 min at 240px/h = 60px raw, in the [30, 70) "narrow" band.
        const blocks = buildGuideRowBlocks(
            [program(axis.startMs, axis.startMs + 15 * 60_000, 'Narrow')],
            {
                axis,
                hourWidthPx: EPG_GUIDE_ZOOM_DEFAULT,
                nowMs: axis.startMs,
                offsetMinutes: 0,
            }
        );
        expect(blocks[0].tier).toBe('narrow');
        expect(blocks[0].widthPx).toBe(57);
    });

    it('excludes programmes touching the axis only at its boundaries', () => {
        const blocks = buildGuideRowBlocks(
            [
                program(axis.startMs - HOUR, axis.startMs, 'EndsAtStart'),
                program(axis.endMs, axis.endMs + HOUR, 'StartsAtEnd'),
            ],
            {
                axis,
                hourWidthPx: EPG_GUIDE_ZOOM_DEFAULT,
                nowMs: axis.startMs,
                offsetMinutes: 0,
            }
        );
        expect(blocks).toEqual([]);
    });

    it('returns an empty layout for no programmes', () => {
        expect(
            buildGuideRowBlocks([], {
                axis,
                hourWidthPx: EPG_GUIDE_ZOOM_DEFAULT,
                nowMs: axis.startMs,
                offsetMinutes: 0,
            })
        ).toEqual([]);
    });

    it('shifts programme times by the display offset before layout', () => {
        const blocks = buildGuideRowBlocks(
            [program(axis.startMs + 10 * HOUR, axis.startMs + 11 * HOUR)],
            { axis, hourWidthPx: 240, nowMs: axis.startMs, offsetMinutes: 60 }
        );
        expect(blocks[0].leftPx).toBe(11 * 240);
    });
});
