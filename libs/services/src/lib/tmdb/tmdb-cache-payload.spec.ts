import { mergeSerieInfoWithTmdb } from './tmdb-merge';
import { trimDetailsForCache } from './tmdb-cache-payload';
import { XtreamSerieInfo } from '@iptvnator/shared/interfaces';
import { TmdbMovieDetails, TmdbTvDetails } from './tmdb.types';

describe('trimDetailsForCache', () => {
    it('passes a movie payload through untouched', () => {
        const movie: TmdbMovieDetails = {
            id: 603,
            title: 'The Matrix',
            credits: { cast: [{ name: 'Keanu Reeves' }] },
        };

        expect(trimDetailsForCache(movie)).toBe(movie);
    });

    it('keeps every aggregate cast member', () => {
        const details: TmdbTvDetails = {
            id: 76479,
            aggregate_credits: {
                cast: Array.from({ length: 120 }, (_, i) => ({
                    id: i,
                    name: `Actor ${i}`,
                    order: i,
                })),
            },
        };

        const trimmed = trimDetailsForCache(details) as TmdbTvDetails;

        // The tail is what tells a returning actor from a new arrival
        expect(trimmed.aggregate_credits?.cast).toHaveLength(120);
    });

    it('reduces roles to the character with the most episodes', () => {
        const details: TmdbTvDetails = {
            id: 76479,
            aggregate_credits: {
                cast: [
                    {
                        id: 1,
                        name: 'Karl Urban',
                        order: 0,
                        roles: [
                            { character: 'Cameo Guy', episode_count: 1 },
                            { character: 'Billy Butcher', episode_count: 32 },
                        ],
                    },
                ],
            },
        };

        const trimmed = trimDetailsForCache(details) as TmdbTvDetails;

        expect(trimmed.aggregate_credits?.cast?.[0].roles).toEqual([
            { character: 'Billy Butcher', episode_count: 32 },
        ]);
    });

    it('keeps the named role even when a blank one has more episodes', () => {
        // TMDB uses unnamed roles for uncredited appearances; the merge
        // skips them, so the trim must not cache one in their place
        const details: TmdbTvDetails = {
            id: 76479,
            aggregate_credits: {
                cast: [
                    {
                        id: 1,
                        name: 'Karl Urban',
                        order: 0,
                        roles: [
                            { character: '', episode_count: 40 },
                            { character: 'Billy Butcher', episode_count: 32 },
                        ],
                    },
                ],
            },
        };

        const trimmed = trimDetailsForCache(details) as TmdbTvDetails;

        expect(trimmed.aggregate_credits?.cast?.[0].roles).toEqual([
            { character: 'Billy Butcher', episode_count: 32 },
        ]);
    });

    it('drops the aggregate crew nothing reads', () => {
        const details = {
            id: 76479,
            aggregate_credits: {
                cast: [{ id: 1, name: 'Karl Urban', order: 0 }],
                crew: Array.from({ length: 500 }, (_, i) => ({
                    id: i,
                    name: `Crew ${i}`,
                })),
            },
        } as TmdbTvDetails;

        const trimmed = trimDetailsForCache(details) as TmdbTvDetails & {
            aggregate_credits?: { crew?: unknown[] };
        };

        expect(trimmed.aggregate_credits?.crew).toBeUndefined();
        expect(trimmed.aggregate_credits?.cast).toHaveLength(1);
    });

    it('does not mutate the payload the caller still uses', () => {
        const details: TmdbTvDetails = {
            id: 76479,
            aggregate_credits: {
                cast: [
                    {
                        id: 1,
                        name: 'Karl Urban',
                        roles: [
                            { character: 'A', episode_count: 1 },
                            { character: 'B', episode_count: 2 },
                        ],
                    },
                ],
            },
        };

        trimDetailsForCache(details);

        expect(details.aggregate_credits?.cast?.[0].roles).toHaveLength(2);
    });

    it('merges a trimmed payload to the same cast as the full one', () => {
        // The property that matters: the first render (network payload) and
        // every later one (cached payload) must show the same people
        const info = {
            name: 'The Boys',
            cover: '',
            plot: '',
            cast: '',
            director: '',
            genre: '',
            releaseDate: '',
            last_modified: '',
            rating: '',
            rating_5based: 0,
            backdrop_path: [],
            youtube_trailer: '',
            episode_run_time: '',
            category_id: '1',
        } as XtreamSerieInfo;
        const details: TmdbTvDetails = {
            id: 76479,
            aggregate_credits: {
                cast: Array.from({ length: 60 }, (_, i) => ({
                    id: i,
                    name: `Regular ${i}`,
                    order: i,
                    roles: [{ character: `Role ${i}`, episode_count: 10 }],
                })),
            },
            credits: {
                // A long-serving actor billed 50th who is still in the
                // newest season — dropping the aggregate tail would have
                // promoted them into a reserved arrival slot
                cast: [{ id: 50, name: 'Regular 50', order: 0 }],
            },
        };

        const fromFull = mergeSerieInfoWithTmdb(info, details);
        const fromCache = mergeSerieInfoWithTmdb(
            info,
            trimDetailsForCache(details) as TmdbTvDetails
        );

        expect(fromCache.cast).toBe(fromFull.cast);
        expect(fromCache.cast).not.toContain('Regular 50');
    });
});
