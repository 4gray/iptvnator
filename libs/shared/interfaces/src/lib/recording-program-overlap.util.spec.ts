import {
    filterRecordingProgramsOverlap,
    toRecordingProgramSnapshot,
} from './recording-program-overlap.util';

const program = (title: string, start: string, stop: string) => ({
    title,
    start,
    stop,
});

describe('filterRecordingProgramsOverlap', () => {
    const programs = [
        program('Late show', '2026-08-15T22:10:00Z', '2026-08-15T23:00:00Z'),
        program('News', '2026-08-15T21:00:00Z', '2026-08-15T21:45:00Z'),
        program('Weather', '2026-08-15T21:45:00Z', '2026-08-15T22:10:00Z'),
        program('Morning', '2026-08-15T08:00:00Z', '2026-08-15T09:00:00Z'),
    ];

    it('fails closed without a recording start', () => {
        expect(
            filterRecordingProgramsOverlap(
                programs,
                null,
                '2026-08-15T22:00:00Z'
            )
        ).toEqual([]);
    });

    it('fails closed on unparseable or inverted windows', () => {
        expect(
            filterRecordingProgramsOverlap(
                programs,
                'garbage',
                '2026-08-15T22:00:00Z'
            )
        ).toEqual([]);
        expect(
            filterRecordingProgramsOverlap(
                programs,
                '2026-08-15T22:00:00Z',
                '2026-08-15T21:00:00Z'
            )
        ).toEqual([]);
    });

    it('keeps every overlapping program sorted by start (boundary case)', () => {
        const result = filterRecordingProgramsOverlap(
            programs,
            '2026-08-15T21:30:00Z',
            '2026-08-15T21:58:00Z'
        );
        expect(result.map(({ title }) => title)).toEqual(['News', 'Weather']);
    });

    it('excludes programs that only touch the window edges', () => {
        // Weather starts exactly at window end; News stops exactly at start.
        const result = filterRecordingProgramsOverlap(
            programs,
            '2026-08-15T21:45:00Z',
            '2026-08-15T21:45:00Z'
        );
        expect(result).toEqual([]);
    });

    it('drops programs with unparseable times', () => {
        const result = filterRecordingProgramsOverlap(
            [program('Broken', 'nope', 'also nope'), programs[1]],
            '2026-08-15T21:10:00Z',
            '2026-08-15T21:20:00Z'
        );
        expect(result.map(({ title }) => title)).toEqual(['News']);
    });
});

describe('toRecordingProgramSnapshot', () => {
    it('prefers description over desc and trims it', () => {
        expect(
            toRecordingProgramSnapshot({
                title: 'News',
                description: '  Daily  ',
                desc: 'legacy',
                start: 'a',
                stop: 'b',
            })
        ).toEqual({ title: 'News', description: 'Daily', start: 'a', stop: 'b' });
    });

    it('falls back to the XMLTV desc field', () => {
        expect(
            toRecordingProgramSnapshot({
                title: 'News',
                desc: 'From XMLTV',
                start: 'a',
                stop: 'b',
            })
        ).toEqual({
            title: 'News',
            description: 'From XMLTV',
            start: 'a',
            stop: 'b',
        });
    });

    it('omits description entirely when both sources are empty', () => {
        expect(
            toRecordingProgramSnapshot({
                title: 'News',
                desc: null,
                start: 'a',
                stop: 'b',
            })
        ).toEqual({ title: 'News', start: 'a', stop: 'b' });
    });
});
