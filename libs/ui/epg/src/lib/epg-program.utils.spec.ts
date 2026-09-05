import {
    areProgramsSame,
    deduplicateProgramsByTimeSlot,
    getProgramDateKey,
    getProgramTimeMs,
} from './epg-program.utils';

const PROGRAM = {
    start: '2026-06-28T23:30:00.000Z',
    stop: '2026-06-29T00:30:00.000Z',
    channel: 'channel',
    title: 'Program',
    desc: null,
    category: null,
};

describe('epg-program.utils', () => {
    it('preserves raw time with the default offset', () => {
        expect(getProgramTimeMs(PROGRAM.start)).toBe(Date.parse(PROGRAM.start));
    });

    it('shifts ISO and numeric timestamps in display time', () => {
        expect(getProgramTimeMs(PROGRAM.start, null, 60)).toBe(
            Date.parse(PROGRAM.start) + 60 * 60_000
        );
        expect(getProgramTimeMs(PROGRAM.start, 1_000, -30)).toBe(
            1_000_000 - 30 * 60_000
        );
    });

    it('shifts date keys across midnight', () => {
        expect(getProgramDateKey(PROGRAM.start, null, 60)).toBe('2026-06-29');
    });

    it('uses shifted times consistently for equality and deduplication', () => {
        const equivalent = {
            ...PROGRAM,
            start: '2026-06-29T00:30:00.000Z',
            stop: '2026-06-29T01:30:00.000Z',
        };
        expect(areProgramsSame(PROGRAM, equivalent, 60)).toBe(false);
        expect(
            deduplicateProgramsByTimeSlot([PROGRAM, PROGRAM], 60)
        ).toHaveLength(1);
    });
});
