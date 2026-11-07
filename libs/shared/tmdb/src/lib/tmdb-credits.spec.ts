import {
    enrichedCast,
    pickAggregateRole,
    topCast,
    unifiedTvCast,
} from './tmdb-credits';
import { trimDetailsForCache } from './tmdb-cache-payload';
import type { TmdbTvDetails } from './tmdb.types';

describe('TMDB credits', () => {
    it('renders the same selected role from fresh and trimmed cache payloads', () => {
        const roles = [
            { character: 'Visitor', episode_count: 1 },
            { character: 'Guide', episode_count: 8 },
            { character: '', episode_count: 20 },
        ];
        const details: TmdbTvDetails = {
            id: 101,
            name: 'Example Series',
            aggregate_credits: {
                cast: [{ id: 11, name: 'Example Performer', roles }],
            },
        };
        const original = structuredClone(details);

        const cached = trimDetailsForCache(details) as TmdbTvDetails;
        const cast = unifiedTvCast(details);

        expect(pickAggregateRole({ roles })).toBe(roles[1]);
        expect(cast).toEqual([
            expect.objectContaining({ id: 11, character: 'Guide' }),
        ]);
        expect(unifiedTvCast(cached)).toEqual(cast);
        expect(enrichedCast(cast)).toEqual([
            expect.objectContaining({
                name: 'Example Performer',
                character: 'Guide',
                tmdbPersonId: 11,
            }),
        ]);
        expect(details).toEqual(original);
    });

    it('preserves billing order for legacy payloads without aggregate credits', () => {
        const later = { id: 11, name: 'Example Performer A', order: 2 };
        const first = { id: 12, name: 'Example Performer B', order: 1 };
        const details: TmdbTvDetails = {
            id: 101,
            credits: { cast: [later, first] },
        };

        expect(unifiedTvCast(details)).toEqual([first, later]);
        expect(topCast(details.credits)).toEqual([first, later]);
        expect(details.credits?.cast).toEqual([later, first]);
    });

    it('keeps top-billed new arrivals visible when the aggregate cast fills the display limit', () => {
        const aggregate = Array.from({ length: 10 }, (_, index) => ({
            id: index + 1,
            name: `Example Regular ${index}`,
            order: index,
            roles: [{ character: 'Guide', episode_count: 8 }],
        }));
        const arrivals = Array.from({ length: 4 }, (_, index) => ({
            id: index + 11,
            name: `Example Arrival ${index}`,
            order: index,
        }));
        const details: TmdbTvDetails = {
            id: 101,
            aggregate_credits: { cast: aggregate },
            credits: { cast: [aggregate[0], ...[...arrivals].reverse()] },
        };

        expect(unifiedTvCast(details).map(({ id }) => id)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 11, 12, 13,
        ]);
        expect(details.credits?.cast?.map(({ id }) => id)).toEqual([
            1, 14, 13, 12, 11,
        ]);
    });
});
