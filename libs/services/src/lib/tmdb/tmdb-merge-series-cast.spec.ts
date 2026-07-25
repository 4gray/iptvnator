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

    it('does not shrink the list when the whole-run cast is short', () => {
        // The reservation is a floor for arrivals, not a ceiling: with four
        // regulars and five newcomers all nine fit under the cap
        const merged = mergeSerieInfoWithTmdb(info, {
            id: 76479,
            name: 'The Boys',
            aggregate_credits: {
                cast: Array.from({ length: 4 }, (_, i) => ({
                    id: 100 + i,
                    name: `Regular ${i}`,
                    order: i,
                })),
            },
            credits: {
                cast: Array.from({ length: 5 }, (_, i) => ({
                    id: 200 + i,
                    name: `Newcomer ${i}`,
                    order: i,
                })),
            },
        });

        expect(merged.tmdb_cast).toHaveLength(9);
        expect(merged.cast).toContain('Newcomer 4');
    });

    it('takes the role the actor played the most episodes of', () => {
        // A one-episode cameo sits in roles[] next to the lead part
        const merged = mergeSerieInfoWithTmdb(info, {
            id: 76479,
            name: 'The Boys',
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
        });

        expect(merged.tmdb_cast?.[0].character).toBe('Billy Butcher');
    });

    it('always fills the cap when there are enough people to fill it', () => {
        // The reservation decides WHO makes the cut, never how many: the
        // list is the display limit or everyone available, whichever is
        // smaller. The earlier defect broke exactly this.
        const cast = (n: number, offset: number, label: string) =>
            Array.from({ length: n }, (_, i) => ({
                id: offset + i,
                name: `${label} ${i}`,
                order: i,
            }));

        for (const [regulars, newcomers] of [
            [0, 4],
            [2, 1],
            [4, 5],
            [7, 5],
            [9, 4],
            [12, 2],
            [12, 0],
        ]) {
            const merged = mergeSerieInfoWithTmdb(info, {
                id: 76479,
                name: 'The Boys',
                aggregate_credits: { cast: cast(regulars, 100, 'Regular') },
                credits: { cast: cast(newcomers, 900, 'Newcomer') },
            });

            expect({
                regulars,
                newcomers,
                shown: merged.tmdb_cast?.length ?? 0,
            }).toEqual({
                regulars,
                newcomers,
                shown: Math.min(10, regulars + newcomers),
            });
        }
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
