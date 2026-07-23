import { normalizeXtreamPendingRestoreState } from './xtream-restore-state.util';

describe('normalizeXtreamPendingRestoreState', () => {
    const emptyState = {
        hiddenCategories: [],
        favorites: [],
        recentlyViewed: [],
        playbackPositions: [],
    };

    it.each([null, undefined, 'text', 42, []])(
        'returns an empty state for non-object input %p',
        (value) => {
            expect(normalizeXtreamPendingRestoreState(value)).toEqual(
                emptyState
            );
        }
    );

    it('falls back to empty arrays for missing or non-array fields', () => {
        expect(
            normalizeXtreamPendingRestoreState({
                hiddenCategories: 'broken',
                favorites: null,
            })
        ).toEqual(emptyState);
    });

    it('keeps hidden categories with a numeric xtream ID and drops the rest', () => {
        const state = normalizeXtreamPendingRestoreState({
            hiddenCategories: [
                { categoryType: 'live', xtreamId: 101 },
                // Entries exported by builds affected by issue #1017 carry
                // no ID at all and must not survive normalization.
                { categoryType: 'live' },
                { categoryType: 'movies', xtreamId: 'not-a-number' },
                { categoryType: 'unknown', xtreamId: 5 },
                { categoryType: 'series', xtreamId: '301' },
                null,
            ],
        });

        expect(state.hiddenCategories).toEqual([
            { categoryType: 'live', xtreamId: 101 },
            { categoryType: 'series', xtreamId: 301 },
        ]);
    });

    it('drops favorites and recently viewed entries without a numeric xtream ID', () => {
        const state = normalizeXtreamPendingRestoreState({
            favorites: [
                {
                    contentType: 'movie',
                    xtreamId: 7,
                    addedAt: '2026-07-01T00:00:00.000Z',
                },
                { contentType: 'movie' },
            ],
            recentlyViewed: [
                {
                    contentType: 'live',
                    xtreamId: '9',
                    viewedAt: '2026-07-01T00:00:00.000Z',
                },
                { contentType: 'live', xtreamId: Number.NaN },
            ],
        });

        expect(state.favorites).toEqual([
            {
                contentType: 'movie',
                xtreamId: 7,
                addedAt: '2026-07-01T00:00:00.000Z',
            },
        ]);
        expect(state.recentlyViewed).toEqual([
            {
                contentType: 'live',
                xtreamId: 9,
                viewedAt: '2026-07-01T00:00:00.000Z',
            },
        ]);
    });

    it('keeps playback position objects and drops primitives', () => {
        const position = {
            contentXtreamId: 12,
            contentType: 'vod',
            positionSeconds: 30,
        };

        const state = normalizeXtreamPendingRestoreState({
            playbackPositions: [position, 'broken', null],
        });

        expect(state.playbackPositions).toEqual([position]);
    });
});
