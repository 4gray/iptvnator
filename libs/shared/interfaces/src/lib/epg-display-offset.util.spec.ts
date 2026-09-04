import {
    EPG_OFFSET_MAX_MINUTES,
    EPG_OFFSET_MIN_MINUTES,
    epgDisplayTimeMs,
    epgOffsetMs,
    epgProviderClockMs,
    normalizeEpgOffsetMinutes,
} from './epg-display-offset.util';

const NOW = Date.parse('2026-06-28T12:00:00.000Z');
const HOUR_MS = 60 * 60_000;

describe('epg-display-offset.util', () => {
    describe('normalizeEpgOffsetMinutes', () => {
        it('keeps whole minutes inside the supported range', () => {
            expect(normalizeEpgOffsetMinutes(0)).toBe(0);
            expect(normalizeEpgOffsetMinutes(-60)).toBe(-60);
            expect(normalizeEpgOffsetMinutes(EPG_OFFSET_MAX_MINUTES)).toBe(720);
            expect(normalizeEpgOffsetMinutes(EPG_OFFSET_MIN_MINUTES)).toBe(
                -720
            );
        });

        it('clamps out-of-range values and truncates fractions', () => {
            expect(normalizeEpgOffsetMinutes(1000)).toBe(720);
            expect(normalizeEpgOffsetMinutes(-1000)).toBe(-720);
            expect(normalizeEpgOffsetMinutes(15.9)).toBe(15);
            expect(normalizeEpgOffsetMinutes(-15.9)).toBe(-15);
        });

        it('accepts numeric strings from persisted or form values', () => {
            expect(normalizeEpgOffsetMinutes('90')).toBe(90);
            expect(normalizeEpgOffsetMinutes(' -30 ')).toBe(-30);
        });

        it('collapses anything that is not a finite number to zero', () => {
            expect(normalizeEpgOffsetMinutes(undefined)).toBe(0);
            expect(normalizeEpgOffsetMinutes(null)).toBe(0);
            expect(normalizeEpgOffsetMinutes('')).toBe(0);
            expect(normalizeEpgOffsetMinutes('abc')).toBe(0);
            expect(normalizeEpgOffsetMinutes(Number.NaN)).toBe(0);
            expect(normalizeEpgOffsetMinutes(Number.POSITIVE_INFINITY)).toBe(0);
            expect(normalizeEpgOffsetMinutes(true)).toBe(0);
            expect(normalizeEpgOffsetMinutes({})).toBe(0);
        });
    });

    it('converts the normalized offset to milliseconds', () => {
        expect(epgOffsetMs(60)).toBe(HOUR_MS);
        expect(epgOffsetMs(5000)).toBe(720 * 60_000);
        expect(epgOffsetMs(Number.NaN)).toBe(0);
    });

    it('shifts a raw timestamp into display time and now into the provider clock symmetrically', () => {
        const rawStart = NOW - HOUR_MS;
        // Display form: the programme moves by +offset ...
        expect(epgDisplayTimeMs(rawStart, 60)).toBe(NOW);
        // ... clock form: "now" moves by -offset. Both comparisons agree.
        expect(epgProviderClockMs(NOW, 60)).toBe(rawStart);
        expect(epgDisplayTimeMs(rawStart, 60) <= NOW).toBe(
            rawStart <= epgProviderClockMs(NOW, 60)
        );
    });

    it('lets NaN pass through so callers keep their own validity checks', () => {
        expect(epgDisplayTimeMs(Number.NaN, 60)).toBeNaN();
        expect(epgProviderClockMs(Number.NaN, 60)).toBeNaN();
    });
});
