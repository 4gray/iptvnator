import { XtreamSerieInfo, XtreamVodInfo } from '@iptvnator/shared/interfaces';
import { mergeSerieInfoWithTmdb, mergeVodInfoWithTmdb } from './tmdb-merge';
import { TmdbMovieDetails, TmdbTvDetails } from './tmdb.types';

function providerVodInfo(overrides: Partial<XtreamVodInfo> = {}): XtreamVodInfo {
    return {
        kinopoisk_url: '',
        tmdb_id: '',
        name: 'The Matrix',
        o_name: 'The Matrix',
        cover_big: 'http://provider/poster-big.jpg',
        movie_image: 'http://provider/poster.jpg',
        releasedate: '1999-03-31',
        episode_run_time: 0,
        youtube_trailer: 'provider-trailer',
        director: 'Provider Director',
        actors: 'Provider Actor',
        cast: 'Provider Actor',
        description: 'Provider description',
        plot: 'Provider plot',
        age: '',
        mpaa_rating: 'R',
        rating_count_kinopoisk: 0,
        country: 'USA',
        genre: 'Action',
        backdrop_path: ['http://provider/backdrop.jpg'],
        duration_secs: 8160,
        duration: '02:16:00',
        video: [],
        audio: [],
        bitrate: 0,
        rating: 7,
        ...overrides,
    };
}

const tmdbMovie: TmdbMovieDetails = {
    id: 603,
    title: 'The Matrix',
    overview: 'TMDB overview',
    genres: [
        { id: 28, name: 'Action' },
        { id: 878, name: 'Science Fiction' },
    ],
    release_date: '1999-03-31',
    runtime: 136,
    vote_average: 8.22,
    vote_count: 26000,
    poster_path: '/matrix-poster.jpg',
    backdrop_path: '/matrix-backdrop.jpg',
    production_countries: [{ iso_3166_1: 'US', name: 'United States' }],
    credits: {
        cast: [
            {
                name: 'Keanu Reeves',
                order: 0,
                character: 'Neo',
                profile_path: '/keanu.jpg',
            },
            { name: 'Laurence Fishburne', order: 1, profile_path: null },
        ],
        crew: [
            {
                id: 9339,
                name: 'Lana Wachowski',
                job: 'Director',
                profile_path: '/lana.jpg',
            },
            { id: 9340, name: 'Lilly Wachowski', job: 'Director' },
            // Duplicate crew row TMDB sometimes returns — must be deduped
            { id: 9339, name: 'Lana Wachowski', job: 'Director' },
            { name: 'Someone Else', job: 'Producer' },
        ],
    },
    videos: {
        results: [
            { key: 'fan-clip', site: 'YouTube', type: 'Clip' },
            {
                key: 'official-trailer',
                site: 'YouTube',
                type: 'Trailer',
                official: true,
            },
            { key: 'vimeo-trailer', site: 'Vimeo', type: 'Trailer' },
        ],
    },
    recommendations: {
        results: [
            {
                id: 604,
                title: 'The Matrix Reloaded',
                release_date: '2003-05-15',
                poster_path: '/reloaded.jpg',
            },
            { id: 605, title: 'The Matrix Revolutions' },
        ],
    },
};

describe('mergeVodInfoWithTmdb', () => {
    it('prefers TMDB editorial fields when present', () => {
        const merged = mergeVodInfoWithTmdb(providerVodInfo(), tmdbMovie);

        expect(merged.plot).toBe('TMDB overview');
        expect(merged.description).toBe('TMDB overview');
        expect(merged.cast).toBe('Keanu Reeves, Laurence Fishburne');
        expect(merged.actors).toBe('Keanu Reeves, Laurence Fishburne');
        expect(merged.director).toBe(
            'Lana Wachowski, Lilly Wachowski, Lana Wachowski'
        );
        expect(merged.tmdb_directors).toEqual([
            {
                name: 'Lana Wachowski',
                profileUrl: 'https://image.tmdb.org/t/p/w185/lana.jpg',
                tmdbPersonId: 9339,
            },
            {
                name: 'Lilly Wachowski',
                profileUrl: null,
                tmdbPersonId: 9340,
            },
        ]);
        expect(merged.genre).toBe('Action, Science Fiction');
        expect(merged.rating).toBe(8.2);
        expect(merged.tmdb_id).toBe(603);
        expect(merged.movie_image).toBe(
            'https://image.tmdb.org/t/p/w500/matrix-poster.jpg'
        );
        expect(merged.backdrop_path[0]).toBe(
            'https://image.tmdb.org/t/p/w1280/matrix-backdrop.jpg'
        );
        expect(merged.backdrop_path).toContain('http://provider/backdrop.jpg');
        expect(merged.tmdb_cast).toEqual([
            {
                name: 'Keanu Reeves',
                character: 'Neo',
                profileUrl: 'https://image.tmdb.org/t/p/w185/keanu.jpg',
            },
            { name: 'Laurence Fishburne', profileUrl: null },
        ]);
    });

    it('prefers the official YouTube trailer', () => {
        const merged = mergeVodInfoWithTmdb(providerVodInfo(), tmdbMovie);
        expect(merged.youtube_trailer).toBe('official-trailer');
    });

    it('keeps the provider trailer when TMDB has no usable video', () => {
        const merged = mergeVodInfoWithTmdb(providerVodInfo(), {
            ...tmdbMovie,
            videos: { results: [{ key: 'x', site: 'Vimeo', type: 'Trailer' }] },
        });
        expect(merged.youtube_trailer).toBe('provider-trailer');
    });

    it('attaches recommendations with year and poster', () => {
        const merged = mergeVodInfoWithTmdb(providerVodInfo(), tmdbMovie);
        expect(merged.tmdb_recommendations).toEqual([
            {
                tmdbId: 604,
                title: 'The Matrix Reloaded',
                year: 2003,
                posterUrl: 'https://image.tmdb.org/t/p/w500/reloaded.jpg',
            },
            {
                tmdbId: 605,
                title: 'The Matrix Revolutions',
                year: null,
                posterUrl: null,
            },
        ]);
    });

    it('keeps provider values when TMDB fields are missing', () => {
        const sparse: TmdbMovieDetails = { id: 603 };
        const info = providerVodInfo();
        const merged = mergeVodInfoWithTmdb(info, sparse);

        expect(merged.plot).toBe('Provider plot');
        expect(merged.cast).toBe('Provider Actor');
        expect(merged.director).toBe('Provider Director');
        expect(merged.genre).toBe('Action');
        expect(merged.rating).toBe(7);
        expect(merged.movie_image).toBe('http://provider/poster.jpg');
        expect(merged.tmdb_cast).toBeUndefined();
        expect(merged.backdrop_path).toEqual([
            'http://provider/backdrop.jpg',
        ]);
    });

    it('ignores TMDB rating without votes', () => {
        const unrated: TmdbMovieDetails = {
            id: 603,
            vote_average: 5,
            vote_count: 0,
        };
        const merged = mergeVodInfoWithTmdb(providerVodInfo(), unrated);
        expect(merged.rating).toBe(7);
    });

    it('fills the displayed rating_imdb field only when the provider left it empty', () => {
        const withoutImdb = mergeVodInfoWithTmdb(
            providerVodInfo({ rating_imdb: '' }),
            tmdbMovie
        );
        expect(withoutImdb.rating_imdb).toBe('8.2');

        const withImdb = mergeVodInfoWithTmdb(
            providerVodInfo({ rating_imdb: '7.9' }),
            tmdbMovie
        );
        expect(withImdb.rating_imdb).toBe('7.9');
    });

    it('fills missing provider release date and country', () => {
        const info = providerVodInfo({ releasedate: '', country: '' });
        const merged = mergeVodInfoWithTmdb(info, tmdbMovie);
        expect(merged.releasedate).toBe('1999-03-31');
        expect(merged.country).toBe('United States');
    });

    it('does not mutate the provider object', () => {
        const info = providerVodInfo();
        const snapshot = JSON.parse(JSON.stringify(info));
        mergeVodInfoWithTmdb(info, tmdbMovie);
        expect(info).toEqual(snapshot);
    });
});

describe('mergeSerieInfoWithTmdb', () => {
    const providerSerieInfo: XtreamSerieInfo = {
        name: 'Dark',
        cover: 'http://provider/cover.jpg',
        plot: 'Provider plot',
        cast: 'Provider Cast',
        director: '',
        genre: 'Drama',
        releaseDate: '',
        last_modified: '',
        rating: '7',
        rating_5based: 3.5,
        backdrop_path: ['http://provider/backdrop.jpg'],
        youtube_trailer: '',
        episode_run_time: '60',
        category_id: '1',
    };

    const tmdbTv: TmdbTvDetails = {
        id: 70523,
        name: 'Dark',
        overview: 'TMDB tv overview',
        genres: [{ id: 9648, name: 'Mystery' }],
        first_air_date: '2017-12-01',
        vote_average: 8.4,
        vote_count: 3200,
        poster_path: '/dark-poster.jpg',
        backdrop_path: '/dark-backdrop.jpg',
        created_by: [
            { id: 91, name: 'Baran bo Odar', profile_path: '/odar.jpg' },
            { name: 'Jantje Friese' },
        ],
        credits: {
            cast: [{ name: 'Louis Hofmann', order: 0 }],
        },
    };

    it('prefers TMDB fields and fills gaps', () => {
        const merged = mergeSerieInfoWithTmdb(providerSerieInfo, tmdbTv);

        expect(merged.plot).toBe('TMDB tv overview');
        expect(merged.cast).toBe('Louis Hofmann');
        expect(merged.director).toBe('Baran bo Odar, Jantje Friese');
        expect(merged.tmdb_directors).toEqual([
            {
                name: 'Baran bo Odar',
                profileUrl: 'https://image.tmdb.org/t/p/w185/odar.jpg',
                tmdbPersonId: 91,
            },
            { name: 'Jantje Friese', profileUrl: null },
        ]);
        expect(merged.genre).toBe('Mystery');
        expect(merged.rating).toBe('8.4');
        expect(merged.rating_5based).toBe(4.2);
        expect(merged.releaseDate).toBe('2017-12-01');
        expect(merged.cover).toBe(
            'https://image.tmdb.org/t/p/w500/dark-poster.jpg'
        );
        expect(merged.backdrop_path[0]).toBe(
            'https://image.tmdb.org/t/p/w1280/dark-backdrop.jpg'
        );
    });

    it('keeps provider values for missing TMDB fields', () => {
        const merged = mergeSerieInfoWithTmdb(providerSerieInfo, {
            id: 70523,
        });

        expect(merged.plot).toBe('Provider plot');
        expect(merged.cast).toBe('Provider Cast');
        expect(merged.genre).toBe('Drama');
        expect(merged.rating).toBe('7');
        expect(merged.rating_5based).toBe(3.5);
        expect(merged.cover).toBe('http://provider/cover.jpg');
    });
});

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
                { id: 3, name: 'Newcomer Person', order: 1, character: 'Rookie' },
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
