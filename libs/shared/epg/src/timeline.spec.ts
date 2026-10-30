import {
    buildGuideTicks,
    clipGuideSpan,
    guideNowLeftPx,
    guideTrackWidthPx,
    guideXForMs,
} from './index';

describe('shared EPG epoch geometry', () => {
    const hour = 3_600_000;
    const axis = {
        startMs: 1_700_000_000_000,
        endMs: 1_700_000_000_000 + 3 * hour,
    };

    it('projects original timestamps without clamping boundary-crossing programmes', () => {
        expect(guideTrackWidthPx(axis, 240)).toBe(720);
        expect(guideXForMs(axis, axis.startMs - hour / 2, 240)).toBe(-120);
        expect(guideXForMs(axis, axis.endMs, 240)).toBe(720);
        expect(guideNowLeftPx(axis, axis.startMs, 240)).toBe(0);
        expect(guideNowLeftPx(axis, axis.endMs - hour, 240)).toBe(480);
        expect(guideNowLeftPx(axis, axis.endMs, 240)).toBeNull();
        expect(guideNowLeftPx(axis, axis.startMs - 1, 240)).toBeNull();
    });

    it('clips overlapping programmes and rejects empty, reversed and invalid spans', () => {
        expect(
            clipGuideSpan(axis, axis.startMs - hour, axis.startMs + hour)
        ).toEqual({ startMs: axis.startMs, endMs: axis.startMs + hour });
        expect(clipGuideSpan(axis, axis.startMs, axis.endMs + hour)).toEqual(
            axis
        );
        expect(
            clipGuideSpan(axis, axis.startMs - hour, axis.startMs)
        ).toBeNull();
        expect(clipGuideSpan(axis, axis.endMs, axis.endMs + hour)).toBeNull();
        expect(clipGuideSpan(axis, axis.endMs, axis.startMs)).toBeNull();
        expect(clipGuideSpan(axis, NaN, axis.endMs)).toBeNull();
        expect(
            clipGuideSpan({ startMs: Infinity, endMs: Infinity }, 1, 2)
        ).toBeNull();
    });

    it('uses actual epoch duration for normal, spring-forward and fallback days', () => {
        for (const hours of [23, 24, 25]) {
            const day = {
                startMs: axis.startMs,
                endMs: axis.startMs + hours * hour,
            };
            const ticks = buildGuideTicks(day, 240);
            expect(ticks).toHaveLength(hours * 2);
            expect(guideTrackWidthPx(day, 240)).toBe(hours * 240);
            ticks.forEach((tick, index) => {
                expect(tick.ms).toBe(day.startMs + (index * hour) / 2);
                expect(tick.leftPx).toBe(index * 120);
                expect(tick.ms).toBeLessThan(day.endMs);
            });
        }
    });

    it('retains distinct instants when local fallback clock labels repeat', () => {
        const startMs = Date.parse('2026-10-25T02:00:00+02:00');
        const secondHour = Date.parse('2026-10-25T02:00:00+01:00');
        const ticks = buildGuideTicks(
            { startMs, endMs: secondHour + hour },
            240
        );
        expect(ticks.map((tick) => tick.ms)).toContain(secondHour);
        expect(ticks.map((tick) => tick.leftPx)).toEqual([0, 120, 240, 360]);
        expect(new Set(ticks.map((tick) => tick.ms)).size).toBe(4);
    });

    it('does not generate ticks for empty or invalid axes', () => {
        expect(buildGuideTicks({ startMs: 2, endMs: 1 }, 240)).toEqual([]);
        expect(buildGuideTicks({ startMs: NaN, endMs: 1 }, 240)).toEqual([]);
        expect(buildGuideTicks({ startMs: 1, endMs: Infinity }, 240)).toEqual(
            []
        );
        expect(buildGuideTicks({ startMs: 1e100, endMs: 2e100 }, 240)).toEqual(
            []
        );
    });
});
