import { XtreamSerieInfo } from '@iptvnator/shared/interfaces';
import { mergeSerieInfoWithTmdb } from './tmdb-merge';
import { TmdbTvDetails } from './tmdb.types';

describe('series cast (aggregate + latest season)', () => {
    const info: XtreamSerieInfo = {
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
    };

    // TMDB documents /tv/{id} `credits` as the LATEST SEASON only, and
    // aggregate_credits as everything EXCEPT the newest season.
    const details: TmdbTvDetails = {
        id: 76479,
        name: 'The Boys',
        aggregate_credits: {
            cast: [
                {
                    id: 1,
                    name: 'Karl Urban',
                    order: 0,
                    profile_path: '/urban.jpg',
                    roles: [{ character: 'Billy Butcher' }],
                },
                {
                    id: 2,
                    name: 'Jack Quaid',
                    order: 1,
                    roles: [{ character: 'Hughie' }],
                },
            ],
        },
        credits: {
            cast: [
                // Still around in the newest season
                { id: 1, name: 'Karl Urban', order: 0, character: 'Butcher' },
                // Joined only in the newest season
                {
                    id: 3,
                    name: 'Newcomer Person',
                    order: 1,
                    character: 'Rookie',
                },
            ],
        },
    };

    it('keeps whole-run cast that the latest season dropped', () => {
        const merged = mergeSerieInfoWithTmdb(info, details);
        // Jack Quaid is absent from `credits` — the old code lost him
        expect(merged.cast).toContain('Jack Quaid');
    });

    it('adds newest-season arrivals after the show billing order', () => {
        const merged = mergeSerieInfoWithTmdb(info, details);
        expect(merged.cast).toBe('Karl Urban, Jack Quaid, Newcomer Person');
    });

    it('takes the character from the aggregate roles array', () => {
        const merged = mergeSerieInfoWithTmdb(info, details);
        expect(merged.tmdb_cast?.[0]).toEqual({
            name: 'Karl Urban',
            character: 'Billy Butcher',
            profileUrl: 'https://image.tmdb.org/t/p/w185/urban.jpg',
            tmdbPersonId: 1,
        });
    });

    it('does not duplicate people present in both payloads', () => {
        const merged = mergeSerieInfoWithTmdb(info, details);
        expect(
            merged.tmdb_cast?.filter((m) => m.name === 'Karl Urban')
        ).toHaveLength(1);
    });

    it('keeps newest-season arrivals when the aggregate already fills the cap', () => {
        // The case the union exists for: a long-running show whose
        // whole-run cast alone exceeds the display limit
        const bigAggregate = Array.from({ length: 12 }, (_, i) => ({
            id: 100 + i,
            name: `Regular ${i}`,
            order: i,
            roles: [{ character: `Role ${i}` }],
        }));
        const merged = mergeSerieInfoWithTmdb(info, {
            id: 76479,
            name: 'The Boys',
            aggregate_credits: { cast: bigAggregate },
            credits: {
                cast: [
                    { id: 900, name: 'Brand New Lead', order: 0 },
                    { id: 901, name: 'Brand New Sidekick', order: 1 },
                ],
            },
        });

        const names = merged.tmdb_cast?.map((member) => member.name) ?? [];
        expect(names).toHaveLength(10);
        expect(names).toContain('Brand New Lead');
        expect(names).toContain('Brand New Sidekick');
        // Top billing survives; the reservation eats into the tail only
        expect(names[0]).toBe('Regular 0');
    });

    it('gives every slot to the aggregate when nobody is new', () => {
        const bigAggregate = Array.from({ length: 12 }, (_, i) => ({
            id: 100 + i,
            name: `Regular ${i}`,
            order: i,
        }));
        const merged = mergeSerieInfoWithTmdb(info, {
            id: 76479,
            name: 'The Boys',
            aggregate_credits: { cast: bigAggregate },
            credits: { cast: [{ id: 100, name: 'Regular 0', order: 0 }] },
        });

        expect(merged.tmdb_cast).toHaveLength(10);
        expect(merged.tmdb_cast?.[9].name).toBe('Regular 9');
    });

    it('falls back to plain credits when no aggregate is present', () => {
        // Cache rows written before aggregate_credits was requested
        const merged = mergeSerieInfoWithTmdb(info, {
            id: 76479,
            name: 'The Boys',
            credits: {
                cast: [
                    { id: 3, name: 'Second Billed', order: 1 },
                    { id: 1, name: 'Top Billed', order: 0 },
                ],
            },
        });
        expect(merged.cast).toBe('Top Billed, Second Billed');
    });
});
