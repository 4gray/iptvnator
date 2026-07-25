import { trimDetailsForCache } from './tmdb-cache-payload';
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

    it('keeps the billing-order prefix of a long aggregate cast', () => {
        const details: TmdbTvDetails = {
            id: 76479,
            aggregate_credits: {
                // Reversed so a naive slice would keep the wrong people
                cast: Array.from({ length: 120 }, (_, i) => ({
                    id: i,
                    name: `Actor ${119 - i}`,
                    order: 119 - i,
                })),
            },
        };

        const trimmed = trimDetailsForCache(details) as TmdbTvDetails;
        const cast = trimmed.aggregate_credits?.cast ?? [];

        expect(cast).toHaveLength(40);
        expect(cast[0].name).toBe('Actor 0');
        expect(cast[39].name).toBe('Actor 39');
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
                cast: Array.from({ length: 60 }, (_, i) => ({
                    id: i,
                    name: `Actor ${i}`,
                    order: i,
                })),
            },
        };

        trimDetailsForCache(details);

        expect(details.aggregate_credits?.cast).toHaveLength(60);
    });
});
