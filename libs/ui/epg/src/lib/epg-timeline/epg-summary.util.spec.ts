import {
    EpgTimelineSummary,
    formatClockTime,
    summaryHasTimeRange,
    summaryHasTitle,
    summaryMinutesLeft,
    summaryProgress,
} from './epg-summary.util';

const HOUR_MS = 60 * 60_000;
const NOW = new Date(2026, 5, 28, 12, 0, 0, 0).getTime(); // 28 Jun 2026, 12:00 local
const START = NOW - HOUR_MS; // 11:00
const STOP = NOW + HOUR_MS; // 13:00

function summary(overrides: EpgTimelineSummary = {}): EpgTimelineSummary {
    return { title: 'Show', start: START, stop: STOP, ...overrides };
}

describe('epg-summary.util', () => {
    describe('summaryProgress', () => {
        it('returns null for a missing summary', () => {
            expect(summaryProgress(null, NOW)).toBeNull();
            expect(summaryProgress(undefined, NOW)).toBeNull();
        });

        it('computes elapsed percentage between start and stop', () => {
            // 11:00 → 13:00, now 12:00 → halfway
            expect(summaryProgress(summary(), NOW)).toBe(50);
            expect(summaryProgress(summary(), START + HOUR_MS / 2)).toBe(25);
        });

        it('returns 0 at the exact start and 100 at the exact stop', () => {
            expect(summaryProgress(summary(), START)).toBe(0);
            expect(summaryProgress(summary(), STOP)).toBe(100);
        });

        it('clamps to 0 before the start and 100 after the stop', () => {
            expect(summaryProgress(summary(), START - HOUR_MS)).toBe(0);
            expect(summaryProgress(summary(), STOP + HOUR_MS)).toBe(100);
        });

        it('returns null when start or stop is missing', () => {
            expect(summaryProgress(summary({ start: null }), NOW)).toBeNull();
            expect(
                summaryProgress(summary({ stop: undefined }), NOW)
            ).toBeNull();
            expect(summaryProgress(summary({ start: '' }), NOW)).toBeNull();
        });

        it('returns null for unparsable dates', () => {
            expect(
                summaryProgress(summary({ start: 'not-a-date' }), NOW)
            ).toBeNull();
            expect(
                summaryProgress(summary({ stop: new Date(NaN) }), NOW)
            ).toBeNull();
        });

        it('returns null for zero or negative duration', () => {
            expect(
                summaryProgress(summary({ start: NOW, stop: NOW }), NOW)
            ).toBeNull();
            expect(
                summaryProgress(summary({ start: STOP, stop: START }), NOW)
            ).toBeNull();
        });

        it('accepts ISO strings and Date objects as time inputs', () => {
            const iso = summary({
                start: new Date(START).toISOString(),
                stop: new Date(STOP),
            });
            expect(summaryProgress(iso, NOW)).toBe(50);
        });

        it('prefers an explicit progress value over the time range', () => {
            expect(summaryProgress(summary({ progress: 42 }), NOW)).toBe(42);
        });

        it('clamps an explicit progress value into 0–100', () => {
            expect(summaryProgress(summary({ progress: 150 }), NOW)).toBe(100);
            expect(summaryProgress(summary({ progress: -5 }), NOW)).toBe(0);
        });

        it('coerces an explicit null progress to 0 (Number(null) is finite)', () => {
            expect(summaryProgress(summary({ progress: null }), NOW)).toBe(0);
        });

        it('falls back to the time range when progress is undefined', () => {
            expect(summaryProgress(summary({ progress: undefined }), NOW)).toBe(
                50
            );
        });
    });

    describe('summaryMinutesLeft', () => {
        it('returns null without a summary or stop time', () => {
            expect(summaryMinutesLeft(null, NOW)).toBeNull();
            expect(summaryMinutesLeft(undefined, NOW)).toBeNull();
            expect(
                summaryMinutesLeft(summary({ stop: null }), NOW)
            ).toBeNull();
            expect(
                summaryMinutesLeft(summary({ stop: 'garbage' }), NOW)
            ).toBeNull();
        });

        it('returns whole minutes until the stop', () => {
            expect(summaryMinutesLeft(summary(), NOW)).toBe(60);
        });

        it('rounds to the nearest minute', () => {
            expect(
                summaryMinutesLeft(summary({ stop: NOW + 90_000 }), NOW)
            ).toBe(2); // 1.5 min rounds up
            expect(
                summaryMinutesLeft(summary({ stop: NOW + 89_000 }), NOW)
            ).toBe(1); // ~1.48 min rounds down
        });

        it('never goes below zero once the programme ended', () => {
            expect(
                summaryMinutesLeft(summary({ stop: NOW - HOUR_MS }), NOW)
            ).toBe(0);
        });

        it('returns 0 exactly at the stop', () => {
            expect(summaryMinutesLeft(summary({ stop: NOW }), NOW)).toBe(0);
        });
    });

    describe('summaryHasTitle', () => {
        it('is false for missing summaries and titles', () => {
            expect(summaryHasTitle(null)).toBe(false);
            expect(summaryHasTitle(undefined)).toBe(false);
            expect(summaryHasTitle(summary({ title: null }))).toBe(false);
            expect(summaryHasTitle(summary({ title: undefined }))).toBe(false);
        });

        it('is false for blank titles', () => {
            expect(summaryHasTitle(summary({ title: '' }))).toBe(false);
            expect(summaryHasTitle(summary({ title: '   ' }))).toBe(false);
        });

        it('is true for a non-blank title', () => {
            expect(summaryHasTitle(summary({ title: 'News' }))).toBe(true);
        });
    });

    describe('summaryHasTimeRange', () => {
        it('is false without a summary or any time', () => {
            expect(summaryHasTimeRange(null)).toBe(false);
            expect(summaryHasTimeRange(undefined)).toBe(false);
            expect(
                summaryHasTimeRange({ title: 'x', start: null, stop: null })
            ).toBe(false);
        });

        it('is true when either start or stop is set', () => {
            expect(
                summaryHasTimeRange({ start: START, stop: null })
            ).toBe(true);
            expect(summaryHasTimeRange({ start: null, stop: STOP })).toBe(
                true
            );
        });

        it('treats a numeric 0 timestamp as absent (truthiness check)', () => {
            expect(summaryHasTimeRange({ start: 0, stop: null })).toBe(false);
        });
    });

    describe('formatClockTime', () => {
        it('formats a local HH:MM label', () => {
            expect(
                formatClockTime(new Date(2026, 5, 28, 12, 34).getTime())
            ).toBe('12:34');
        });

        it('zero-pads single-digit hours and minutes', () => {
            expect(
                formatClockTime(new Date(2026, 5, 28, 9, 5).getTime())
            ).toBe('09:05');
        });

        it('renders midnight as 00:00', () => {
            expect(
                formatClockTime(new Date(2026, 5, 28, 0, 0).getTime())
            ).toBe('00:00');
        });
    });
});
