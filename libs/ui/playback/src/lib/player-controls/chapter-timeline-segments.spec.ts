import {
    buildChapterTimelineSegments,
    sameTimelineSegments,
} from './chapter-timeline-segments';

describe('buildChapterTimelineSegments', () => {
    it('runs each chapter to the next start and the last one to the end', () => {
        expect(
            buildChapterTimelineSegments(
                [
                    { startSeconds: 0, title: 'Intro' },
                    { startSeconds: 90.5, title: 'Episode' },
                    { startSeconds: 2640, title: 'Credits' },
                ],
                2700
            )
        ).toEqual([
            { startSeconds: 0, endSeconds: 90.5, title: 'Intro' },
            { startSeconds: 90.5, endSeconds: 2640, title: 'Episode' },
            { startSeconds: 2640, endSeconds: 2700, title: 'Credits' },
        ]);
    });

    it('orders chapters and drops repeated or out-of-range starts', () => {
        expect(
            buildChapterTimelineSegments(
                [
                    { startSeconds: 600, title: 'B' },
                    { startSeconds: 0, title: 'A' },
                    { startSeconds: 600, title: 'B again' },
                    { startSeconds: -1, title: 'Before' },
                    { startSeconds: 1200, title: 'At the end' },
                    { startSeconds: Number.NaN, title: 'Broken' },
                ],
                1200
            )
        ).toEqual([
            { startSeconds: 0, endSeconds: 600, title: 'A' },
            { startSeconds: 600, endSeconds: 1200, title: 'B' },
        ]);
    });

    it('keeps untitled and blank-titled chapters as untitled segments', () => {
        expect(
            buildChapterTimelineSegments(
                [
                    { startSeconds: 0 },
                    { startSeconds: 10, title: '   ' },
                    { startSeconds: 20, title: ' Outro ' },
                ],
                30
            )
        ).toEqual([
            { startSeconds: 0, endSeconds: 10, title: null },
            { startSeconds: 10, endSeconds: 20, title: null },
            { startSeconds: 20, endSeconds: 30, title: 'Outro' },
        ]);
    });

    it.each([
        ['no chapters', [], 100],
        ['null chapters', null, 100],
        ['an unknown duration', [{ startSeconds: 0 }], null],
        ['a zero duration', [{ startSeconds: 0 }], 0],
        ['an infinite duration', [{ startSeconds: 0 }], Infinity],
        ['only unusable chapters', [{ startSeconds: 500 }], 100],
    ])('returns null for %s', (_label, chapters, duration) => {
        expect(buildChapterTimelineSegments(chapters, duration)).toBeNull();
    });
});

describe('sameTimelineSegments', () => {
    const segments = [
        { startSeconds: 0, endSeconds: 10, title: 'A' },
        { startSeconds: 10, endSeconds: 20, title: null },
    ];

    it('compares by value', () => {
        expect(
            sameTimelineSegments(
                segments,
                segments.map((segment) => ({ ...segment }))
            )
        ).toBe(true);
        expect(sameTimelineSegments(null, null)).toBe(true);
        expect(sameTimelineSegments(segments, null)).toBe(false);
        expect(sameTimelineSegments(segments, segments.slice(0, 1))).toBe(
            false
        );
        expect(
            sameTimelineSegments(segments, [
                segments[0],
                { ...segments[1], title: 'B' },
            ])
        ).toBe(false);
    });
});
