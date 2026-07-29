import { normalizeXtreamPendingRestoreState } from './xtream-restore-state.util';

describe('normalizeXtreamPendingRestoreState', () => {
    // No `sourcePins`: absent has to stay absent, or an older archive would
    // read as "there are no pins" and restore would clear the user's.
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

    describe('source pins', () => {
        it('leaves the field absent when the input has none', () => {
            expect(
                normalizeXtreamPendingRestoreState({ favorites: [] })
            ).not.toHaveProperty('sourcePins');
        });

        it('keeps a present-but-empty collection, which is an answer', () => {
            expect(
                normalizeXtreamPendingRestoreState({ sourcePins: [] })
            ).toHaveProperty('sourcePins', []);
        });

        it('keeps usable pins and drops the rest', () => {
            const state = normalizeXtreamPendingRestoreState({
                sourcePins: [
                    { matchKey: 'tmdb:603', contentId: 501 },
                    // Nothing addressable: writing either would occupy the
                    // unique key of a film it does not describe.
                    { matchKey: '', contentId: 7 },
                    { matchKey: 'title:dune:1984' },
                    { contentId: 9 },
                    'not an object',
                ],
            });

            expect(state.sourcePins).toEqual([
                { matchKey: 'tmdb:603', contentId: 501 },
            ]);
        });

        it('keeps a string updatedAt and drops anything else', () => {
            const state = normalizeXtreamPendingRestoreState({
                sourcePins: [
                    {
                        matchKey: 'tmdb:603',
                        contentId: 501,
                        updatedAt: '2026-07-06T09:00:00.000Z',
                    },
                    { matchKey: 'tmdb:604', contentId: 502, updatedAt: 17 },
                ],
            });

            expect(state.sourcePins).toEqual([
                {
                    matchKey: 'tmdb:603',
                    contentId: 501,
                    updatedAt: '2026-07-06T09:00:00.000Z',
                },
                { matchKey: 'tmdb:604', contentId: 502 },
            ]);
        });
    });

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
