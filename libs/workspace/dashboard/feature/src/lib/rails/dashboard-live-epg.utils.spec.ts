import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    buildDashboardLiveEpgDetails,
    calcEpgProgress,
    formatEpgTimeRange,
} from './dashboard-live-epg.utils';

// Local-time wall clock so the formatted range is stable in every timezone
// the suite runs in.
const START = new Date(2026, 0, 15, 20, 0, 0, 0);
const STOP = new Date(2026, 0, 15, 21, 0, 0, 0);
const MIDPOINT_MS = START.getTime() + (STOP.getTime() - START.getTime()) / 2;

function program(overrides: Partial<EpgProgram> = {}): EpgProgram {
    return {
        start: START.toISOString(),
        stop: STOP.toISOString(),
        channel: 'channel-1',
        title: 'Evening News',
        desc: null,
        category: null,
        ...overrides,
    };
}

describe('dashboard-live-epg.utils', () => {
    describe('timestamps in unix seconds', () => {
        // `EpgProgram.startTimestamp`/`stopTimestamp` are unix SECONDS
        // everywhere else in the app; treating them as milliseconds put
        // every programme in January 1970 and broke the progress bar.
        it('scales startTimestamp/stopTimestamp to milliseconds', () => {
            const row = program({
                // Deliberately different ISO strings prove the cached
                // timestamps win over the strings when both are present.
                start: '2000-01-01T00:00:00.000Z',
                stop: '2000-01-01T01:00:00.000Z',
                startTimestamp: Math.floor(START.getTime() / 1000),
                stopTimestamp: Math.floor(STOP.getTime() / 1000),
            });

            expect(formatEpgTimeRange(row)).toBe('20:00 – 21:00');
            expect(calcEpgProgress(row, MIDPOINT_MS)).toBe(50);
            expect(buildDashboardLiveEpgDetails(row, MIDPOINT_MS)).toEqual({
                nowPlayingTitle: 'Evening News',
                nowPlayingTimeRange: '20:00 – 21:00',
                nowPlayingProgress: 50,
            });
        });

        it('falls back to the ISO strings for zero or non-finite timestamps', () => {
            const row = program({
                startTimestamp: 0,
                stopTimestamp: Number.NaN,
            });

            expect(formatEpgTimeRange(row)).toBe('20:00 – 21:00');
            expect(calcEpgProgress(row, MIDPOINT_MS)).toBe(50);
        });
    });

    describe('ISO fallback', () => {
        it('reads the ISO strings when no timestamps are present', () => {
            const row = program();

            expect(formatEpgTimeRange(row)).toBe('20:00 – 21:00');
            expect(calcEpgProgress(row, MIDPOINT_MS)).toBe(50);
        });

        it('clamps progress to the 0–100 range', () => {
            const row = program();

            expect(calcEpgProgress(row, START.getTime() - 60_000)).toBe(0);
            expect(calcEpgProgress(row, STOP.getTime() + 60_000)).toBe(100);
        });

        it('returns null when the range cannot be resolved', () => {
            const unparseable = program({ start: 'not-a-date' });
            const inverted = program({
                start: STOP.toISOString(),
                stop: START.toISOString(),
            });

            expect(formatEpgTimeRange(unparseable)).toBeNull();
            expect(calcEpgProgress(unparseable, MIDPOINT_MS)).toBeNull();
            expect(calcEpgProgress(inverted, MIDPOINT_MS)).toBeNull();
        });
    });

    describe('EPG display offset', () => {
        it('formats the range and progress in wall-clock terms by default', () => {
            expect(formatEpgTimeRange(program())).toBe('20:00 – 21:00');
            expect(
                buildDashboardLiveEpgDetails(program(), MIDPOINT_MS)
            ).toEqual({
                nowPlayingTitle: 'Evening News',
                nowPlayingTimeRange: '20:00 – 21:00',
                nowPlayingProgress: 50,
            });
        });

        it('shifts the label and measures progress in the provider clock with a display offset', () => {
            // Offset +60: the guide runs an hour ahead, so the 20:00 row
            // really airs 21:00–22:00 and at 20:30 has not started yet.
            expect(formatEpgTimeRange(program(), 60)).toBe('21:00 – 22:00');
            expect(
                buildDashboardLiveEpgDetails(program(), MIDPOINT_MS, 60)
            ).toEqual({
                nowPlayingTitle: 'Evening News',
                nowPlayingTimeRange: '21:00 – 22:00',
                nowPlayingProgress: 0,
            });
            // Offset -30: it really started at 19:30 and has finished.
            expect(
                buildDashboardLiveEpgDetails(program(), MIDPOINT_MS, -30)
                    ?.nowPlayingProgress
            ).toBe(100);
        });

        it('applies the offset to seconds-based timestamps as well', () => {
            const row = program({
                start: '2000-01-01T00:00:00.000Z',
                stop: '2000-01-01T01:00:00.000Z',
                startTimestamp: Math.floor(START.getTime() / 1000),
                stopTimestamp: Math.floor(STOP.getTime() / 1000),
            });

            expect(formatEpgTimeRange(row, 60)).toBe('21:00 – 22:00');
            expect(
                buildDashboardLiveEpgDetails(row, MIDPOINT_MS, 60)
                    ?.nowPlayingProgress
            ).toBe(0);
        });
    });

    describe('buildDashboardLiveEpgDetails', () => {
        it('returns null for a missing programme', () => {
            expect(buildDashboardLiveEpgDetails(null, MIDPOINT_MS)).toBeNull();
        });

        it('returns null when nothing is displayable', () => {
            const row = program({ title: '   ', start: '', stop: '' });

            expect(buildDashboardLiveEpgDetails(row, MIDPOINT_MS)).toBeNull();
        });
    });
});
