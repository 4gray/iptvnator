import {
    findTimelineSegment,
    normalizeTimelineSegments,
    segmentFillPercent,
} from './controls-timeline-segments';

describe('normalizeTimelineSegments', () => {
    it('renders one untitled segment without input or duration', () => {
        expect(normalizeTimelineSegments(null, 600)).toEqual([
            { startSeconds: 0, endSeconds: 600, title: null, share: 1 },
        ]);
        expect(normalizeTimelineSegments([], 600)).toHaveLength(1);
        expect(
            normalizeTimelineSegments(
                [{ startSeconds: 0, endSeconds: 10, title: 'Intro' }],
                0
            )
        ).toEqual([{ startSeconds: 0, endSeconds: 0, title: null, share: 1 }]);
        expect(
            normalizeTimelineSegments([], Number.POSITIVE_INFINITY)
        ).toHaveLength(1);
    });

    it('sorts, fills the gaps and shares the duration', () => {
        const segments = normalizeTimelineSegments(
            [
                { startSeconds: 300, endSeconds: 450, title: 'Chapter 2' },
                { startSeconds: 60, endSeconds: 300, title: 'Chapter 1' },
            ],
            600
        );

        expect(segments).toEqual([
            { startSeconds: 0, endSeconds: 60, title: null, share: 0.1 },
            {
                startSeconds: 60,
                endSeconds: 300,
                title: 'Chapter 1',
                share: 0.4,
            },
            {
                startSeconds: 300,
                endSeconds: 450,
                title: 'Chapter 2',
                share: 0.25,
            },
            { startSeconds: 450, endSeconds: 600, title: null, share: 0.25 },
        ]);
        expect(
            segments.reduce((total, segment) => total + segment.share, 0)
        ).toBeCloseTo(1);
    });

    it('clamps to the duration, cuts overlaps and drops empty segments', () => {
        const segments = normalizeTimelineSegments(
            [
                { startSeconds: -20, endSeconds: 100, title: ' A ' },
                { startSeconds: 50, endSeconds: 200, title: 'B' },
                { startSeconds: 200, endSeconds: 200, title: 'empty' },
                { startSeconds: 400, endSeconds: 300, title: 'reversed' },
                { startSeconds: 150, endSeconds: 180, title: 'swallowed' },
                { startSeconds: 500, endSeconds: 900, title: '' },
            ],
            600
        );

        expect(
            segments.map((s) => [s.startSeconds, s.endSeconds, s.title])
        ).toEqual([
            [0, 100, 'A'],
            [100, 200, 'B'],
            [200, 500, null],
            [500, 600, null],
        ]);
    });
});

describe('segmentFillPercent', () => {
    const segment = { startSeconds: 100, endSeconds: 300 };

    it('measures the played share of a segment and clamps outside it', () => {
        expect(segmentFillPercent(segment, 50)).toBe(0);
        expect(segmentFillPercent(segment, 150)).toBe(25);
        expect(segmentFillPercent(segment, 300)).toBe(100);
        expect(segmentFillPercent(segment, 999)).toBe(100);
    });

    it('is empty for degenerate segments and positions', () => {
        expect(segmentFillPercent({ startSeconds: 5, endSeconds: 5 }, 5)).toBe(
            0
        );
        expect(segmentFillPercent(segment, Number.NaN)).toBe(0);
    });
});

describe('findTimelineSegment', () => {
    const segments = normalizeTimelineSegments(
        [
            { startSeconds: 0, endSeconds: 100, title: 'First' },
            { startSeconds: 100, endSeconds: 200, title: 'Second' },
        ],
        200
    );

    it('returns the segment containing the time, the last one at the end', () => {
        expect(findTimelineSegment(segments, 0)?.title).toBe('First');
        expect(findTimelineSegment(segments, 99.9)?.title).toBe('First');
        expect(findTimelineSegment(segments, 100)?.title).toBe('Second');
        expect(findTimelineSegment(segments, 200)?.title).toBe('Second');
    });

    it('returns null for nothing to match', () => {
        expect(findTimelineSegment([], 10)).toBeNull();
        expect(findTimelineSegment(segments, Number.NaN)).toBeNull();
        expect(findTimelineSegment(segments, -1)).toBeNull();
    });
});
