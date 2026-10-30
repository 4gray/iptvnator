import {
    normalizeXtreamVod,
    normalizeStalkerVod,
    type XtreamVodInfo,
    type XtreamSerieInfo,
    type StalkerVodInfo,
} from '@iptvnator/shared/interfaces';
import {
    mergeVodInfoWithTmdb,
    mergeSerieInfoWithTmdb,
    mergeStalkerInfoWithTmdb,
} from './tmdb-merge';
import type { TmdbMovieDetails, TmdbTvDetails } from './tmdb.types';

const vod: XtreamVodInfo = {
    kinopoisk_url: '',
    tmdb_id: '',
    name: 'Northstar Harbor',
    o_name: '',
    cover_big: '',
    movie_image: '',
    releasedate: '',
    episode_run_time: 0,
    youtube_trailer: '',
    director: '',
    actors: '',
    cast: '',
    description: '',
    plot: '',
    age: '12+',
    mpaa_rating: 'R',
    rating_count_kinopoisk: 0,
    country: '',
    genre: '',
    backdrop_path: [],
    duration_secs: 0,
    duration: '',
    video: [],
    audio: [],
    bitrate: 0,
    rating: 0,
};
const series: XtreamSerieInfo = {
    name: 'Northstar Harbor',
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
    category_id: '',
};
const stalker: StalkerVodInfo = {
    name: 'Northstar Harbor',
    movie_image: '',
    description: '',
    actors: '',
    director: '',
    releasedate: '',
    genre: '',
    rating_imdb: '',
    rating_kinopoisk: '',
};
const movie: TmdbMovieDetails = {
    id: 1,
    release_dates: {
        results: [
            {
                iso_3166_1: 'DE',
                release_dates: [{ certification: '12', type: 3 }],
            },
            {
                iso_3166_1: 'US',
                release_dates: [{ certification: 'PG-13', type: 4 }],
            },
        ],
    },
};
const tv: TmdbTvDetails = {
    id: 2,
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
};

it('carries all movie classifications without overwriting provider claims or mutating input', () => {
    const input = structuredClone(vod);
    const merged = mergeVodInfoWithTmdb(input, movie);
    expect(merged.tmdb_certifications).toHaveLength(2);
    expect(merged.mpaa_rating).toBe('R');
    expect(merged.age).toBe('12+');
    expect(input).toEqual(vod);
    expect(normalizeXtreamVod({ info: merged }).certifications).toEqual([
        { value: '12', countryCode: 'DE', source: 'tmdb', releaseType: 3 },
        { value: 'PG-13', countryCode: 'US', source: 'tmdb', releaseType: 4 },
        { value: 'R', countryCode: 'US', source: 'provider' },
        { value: '12+', source: 'provider' },
    ]);
});

it('uses show-wide classifications for series and both Stalker media types', () => {
    const expected = [{ value: 'TV-MA', countryCode: 'US', source: 'tmdb' }];
    expect(mergeSerieInfoWithTmdb(series, tv).tmdb_certifications).toEqual(
        expected
    );
    const merged = mergeStalkerInfoWithTmdb(stalker, tv, 'tv');
    expect(merged.tmdb_certifications).toEqual(expected);
    expect(
        normalizeStalkerVod({ id: '1', cmd: '', info: merged }).certifications
    ).toEqual(expected);
    expect(
        mergeStalkerInfoWithTmdb(stalker, movie, 'movie').tmdb_certifications
    ).toHaveLength(2);
});

it('clears obsolete TMDB classifications after a successful response with none', () => {
    const old = [{ value: '18', countryCode: 'DE', source: 'tmdb' as const }];
    expect(
        mergeVodInfoWithTmdb(
            { ...vod, tmdb_certifications: old },
            { id: 1, release_dates: { results: [] } }
        ).tmdb_certifications
    ).toEqual([]);
    expect(
        mergeSerieInfoWithTmdb(
            { ...series, tmdb_certifications: old },
            { id: 2, content_ratings: { results: [] } }
        ).tmdb_certifications
    ).toEqual([]);
    expect(
        mergeStalkerInfoWithTmdb(
            { ...stalker, tmdb_certifications: old },
            { id: 2, content_ratings: { results: [] } },
            'tv'
        ).tmdb_certifications
    ).toEqual([]);
});
