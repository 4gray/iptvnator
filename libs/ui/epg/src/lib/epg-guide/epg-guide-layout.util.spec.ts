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
        expect(guideTrackWidthPx(240)).toBe(5760);
    });

    it('maps instants to x by the hour width and hides "now" outside the day', () => {
        expect(guideXForMs(axis, axis.startMs + 2 * HOUR, 240)).toBe(480);
        expect(guideNowLeftPx(axis, axis.startMs + HOUR, 240)).toBe(240);
        expect(guideNowLeftPx(axis, axis.startMs - 1, 240)).toBeNull();
        expect(guideNowLeftPx(axis, axis.endMs, 240)).toBeNull();
    });

    it('lays out programmes overlapping the day, including boundary crossers, with tiers', () => {
        const nowMs = axis.startMs + 16 * HOUR + 4 * 60_000;
        const blocks = buildGuideRowBlocks(
            [
                program(axis.startMs - HOUR, axis.startMs + HOUR, 'Crosser'),
                program(axis.startMs + 16 * HOUR, axis.startMs + 16.75 * HOUR, 'Now'),
                program(axis.startMs + 17 * HOUR, axis.startMs + 17 * HOUR + 5 * 60_000, 'Micro'),
                program(axis.endMs + HOUR, axis.endMs + 2 * HOUR, 'Tomorrow'),
            ],
            { axis, hourWidthPx: EPG_GUIDE_ZOOM_DEFAULT, nowMs, offsetMinutes: 0 }
        );
        expect(blocks.map((block) => block.block.program.title)).toEqual([
            'Crosser',
            'Now',
            'Micro',
        ]);
        expect(blocks[0].leftPx).toBe(-240);
        expect(blocks[1].block.when).toBe('now');
        expect(blocks[1].nowFillPercent).toBeCloseTo((4 / 45) * 100, 3);
        expect(blocks[2].tier).toBe('narrow');
    });

    it('shifts programme times by the display offset before layout', () => {
        const blocks = buildGuideRowBlocks(
            [program(axis.startMs + 10 * HOUR, axis.startMs + 11 * HOUR)],
            { axis, hourWidthPx: 240, nowMs: axis.startMs, offsetMinutes: 60 }
        );
        expect(blocks[0].leftPx).toBe(11 * 240);
    });
});
