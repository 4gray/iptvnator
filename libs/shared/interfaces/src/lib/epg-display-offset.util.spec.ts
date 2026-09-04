import type { EpgItem } from './epg-item.interface';
import {
    EPG_OFFSET_MAX_MINUTES,
    EPG_OFFSET_MIN_MINUTES,
    epgDisplayTimeMs,
    epgOffsetMs,
    epgProviderClockMs,
    normalizeEpgOffsetMinutes,
    shortEpgWindowSize,
    windowEpgItemsAtProviderClock,
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

    describe('shortEpgWindowSize', () => {
        it('keeps the base window without an offset or with a positive one', () => {
            // The provider's past is unreachable through a short EPG, so a
            // positive offset cannot be served by a bigger window.
            expect(shortEpgWindowSize(0, 3)).toBe(3);
            expect(shortEpgWindowSize(120, 3)).toBe(3);
            expect(shortEpgWindowSize(0, 10)).toBe(10);
        });

        it('widens the window under a negative offset in 15-minute slots and caps it', () => {
            expect(shortEpgWindowSize(-30, 3)).toBe(5);
            expect(shortEpgWindowSize(-100, 3)).toBe(10);
            expect(shortEpgWindowSize(-60, 10)).toBe(14);
            expect(shortEpgWindowSize(-720, 3)).toBe(50);
        });
    });

    describe('windowEpgItemsAtProviderClock', () => {
        const nowSeconds = Math.floor(NOW / 1000);
        const item = (
            title: string,
            startOffsetMin: number,
            durationMin: number,
            withTimestamps = true
        ): EpgItem => {
            const start = nowSeconds + startOffsetMin * 60;
            const stop = start + durationMin * 60;
            return {
                id: title,
                epg_id: title,
                title,
                lang: 'en',
                description: '',
                channel_id: 'ch',
                start: new Date(start * 1000).toISOString(),
                end: new Date(stop * 1000).toISOString(),
                stop: new Date(stop * 1000).toISOString(),
                start_timestamp: withTimestamps ? String(start) : '',
                stop_timestamp: withTimestamps ? String(stop) : '',
            };
        };
        const guide = [
            item('Next', 15, 30),
            item('Provider now', -15, 30),
            item('Really on air', -75, 60),
            item('Long gone', -180, 60),
            item('Later', 45, 30),
        ];

        it('mirrors a short-EPG window at the provider clock', () => {
            // +60: the guide runs an hour ahead, so the window starts at the
            // programme the provider filed as finished 15 minutes ago.
            expect(
                windowEpgItemsAtProviderClock(guide, 60, 3, NOW).map(
                    (entry) => entry.title
                )
            ).toEqual(['Really on air', 'Provider now', 'Next']);
            // Without an offset it is the provider's own window.
            expect(
                windowEpgItemsAtProviderClock(guide, 0, 2, NOW).map(
                    (entry) => entry.title
                )
            ).toEqual(['Provider now', 'Next']);
        });

        it('falls back to the ISO fields when unix timestamps are absent', () => {
            const isoOnly = guide.map((entry) => ({
                ...entry,
                start_timestamp: '',
                stop_timestamp: '',
            }));
            expect(
                windowEpgItemsAtProviderClock(isoOnly, -30, 2, NOW).map(
                    (entry) => entry.title
                )
            ).toEqual(['Next', 'Later']);
        });
    });
});
