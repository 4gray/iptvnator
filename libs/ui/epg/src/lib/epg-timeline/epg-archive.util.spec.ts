import {
    canCatchUpProgramme,
    epgDialogActionFor,
    isWithinArchiveWindow,
} from './epg-archive.util';

const DAY_MS = 24 * 60 * 60_000;
const NOW = new Date(2026, 5, 28, 12, 0, 0, 0).getTime(); // 28 Jun 2026, 12:00 local

describe('epg-archive.util', () => {
    describe('isWithinArchiveWindow', () => {
        it('treats archiveDays = 0 as an unlimited window', () => {
            // capability flagged but no explicit window → everything is in range
            expect(isWithinArchiveWindow(NOW - 365 * DAY_MS, 0, NOW)).toBe(
                true
            );
            expect(isWithinArchiveWindow(0, 0, NOW)).toBe(true);
        });

        it('treats negative archiveDays as unlimited too', () => {
            expect(isWithinArchiveWindow(NOW - 365 * DAY_MS, -1, NOW)).toBe(
                true
            );
        });

        it('rejects everything when archiveDays is undefined (NaN window)', () => {
            // undefined is not <= 0, and NaN comparisons are always false
            const archiveDays = undefined as unknown as number;
            expect(isWithinArchiveWindow(NOW, archiveDays, NOW)).toBe(false);
        });

        it('accepts a start exactly on the window edge (inclusive)', () => {
            const edge = NOW - 7 * DAY_MS;
            expect(isWithinArchiveWindow(edge, 7, NOW)).toBe(true);
        });

        it('accepts starts inside the window', () => {
            expect(isWithinArchiveWindow(NOW - 3 * DAY_MS, 7, NOW)).toBe(true);
            expect(isWithinArchiveWindow(NOW - 1, 7, NOW)).toBe(true);
        });

        it('rejects starts just outside the window (expired)', () => {
            expect(isWithinArchiveWindow(NOW - 7 * DAY_MS - 1, 7, NOW)).toBe(
                false
            );
            expect(isWithinArchiveWindow(NOW - 30 * DAY_MS, 7, NOW)).toBe(
                false
            );
        });
    });

    describe('canCatchUpProgramme', () => {
        const inWindowStart = NOW - 2 * 60 * 60_000; // 2h ago, well inside 7 days

        it('allows catch-up when every gate passes', () => {
            expect(
                canCatchUpProgramme('past', inWindowStart, true, 7, NOW)
            ).toBe(true);
        });

        it('denies when archive playback is unavailable', () => {
            expect(
                canCatchUpProgramme('past', inWindowStart, false, 7, NOW)
            ).toBe(false);
        });

        it('denies when the programme is not in the past', () => {
            expect(
                canCatchUpProgramme('now', inWindowStart, true, 7, NOW)
            ).toBe(false);
            expect(
                canCatchUpProgramme('future', NOW + 60_000, true, 7, NOW)
            ).toBe(false);
        });

        it('denies when the start is outside the archive window', () => {
            expect(
                canCatchUpProgramme('past', NOW - 8 * DAY_MS, true, 7, NOW)
            ).toBe(false);
        });

        it('allows arbitrarily old past programmes with an unlimited window', () => {
            expect(
                canCatchUpProgramme('past', NOW - 100 * DAY_MS, true, 0, NOW)
            ).toBe(true);
        });
    });

    describe('epgDialogActionFor', () => {
        it('maps an on-air programme to the live action', () => {
            expect(epgDialogActionFor('now', false)).toBe('live');
        });

        it('prefers live over timeshift for an on-air programme', () => {
            expect(epgDialogActionFor('now', true)).toBe('live');
        });

        it('maps a catch-up-able past programme to timeshift', () => {
            expect(epgDialogActionFor('past', true)).toBe('timeshift');
        });

        it('offers no action for a past programme without catch-up', () => {
            expect(epgDialogActionFor('past', false)).toBeNull();
        });

        it('offers no action for a future programme', () => {
            expect(epgDialogActionFor('future', false)).toBeNull();
        });
    });
});
