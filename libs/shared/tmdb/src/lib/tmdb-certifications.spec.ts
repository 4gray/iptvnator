import { extractTmdbCertifications } from './tmdb-certifications';
import { trimDetailsForCache } from './tmdb-cache-payload';
import { fillDetailsFromFallback } from './tmdb-language-fallback';
import type { TmdbMovieDetails, TmdbTvDetails } from './tmdb.types';

const movie: TmdbMovieDetails = {
    id: 1,
    release_dates: {
        results: [
            {
                iso_3166_1: 'DE',
                release_dates: [
                    { certification: '0', type: 3 },
                    { certification: '12', type: 4 },
                    { certification: '16', type: 4 },
                    { certification: '12', type: 4 },
                    { certification: '', type: 3 },
                ],
            },
            {
                iso_3166_1: 'US',
                release_dates: [{ certification: 'PG-13', type: 3 }],
            },
            {
                iso_3166_1: 'ZZ',
                release_dates: [{ certification: '18', type: 3 }],
            },
        ],
    },
};

it('extracts every movie country and release type, preserving zero and version differences', () => {
    expect(extractTmdbCertifications(movie, 'movie')).toEqual([
        { value: '0', countryCode: 'DE', source: 'tmdb', releaseType: 3 },
        { value: '12', countryCode: 'DE', source: 'tmdb', releaseType: 4 },
        { value: '16', countryCode: 'DE', source: 'tmdb', releaseType: 4 },
        { value: 'PG-13', countryCode: 'US', source: 'tmdb', releaseType: 3 },
    ]);
});

it('uses series-wide content ratings for TV, without inventing a release type', () => {
    const tv: TmdbTvDetails = {
        id: 1,
        content_ratings: {
            results: [
                { iso_3166_1: 'US', rating: 'TV-MA' },
                { iso_3166_1: 'DE', rating: '16' },
                { iso_3166_1: 'FR', rating: 'Unrated' },
            ],
        },
    };
    expect(extractTmdbCertifications(tv, 'tv')).toEqual([
        { value: 'TV-MA', countryCode: 'US', source: 'tmdb' },
        { value: '16', countryCode: 'DE', source: 'tmdb' },
    ]);
    expect(extractTmdbCertifications(movie, 'tv')).toEqual([]);
});

it('treats empty, missing and failed appended subresponses as no classification', () => {
    expect(extractTmdbCertifications({ id: 1 }, 'movie')).toEqual([]);
    expect(
        extractTmdbCertifications(
            { id: 1, release_dates: { results: [] } },
            'movie'
        )
    ).toEqual([]);
    expect(
        extractTmdbCertifications(
            { id: 1, content_ratings: { status_code: 34 } },
            'tv'
        )
    ).toEqual([]);
});

it('retains country data across cache trimming and original-language text fallback', () => {
    const primary = { ...movie, aggregate_credits: { cast: [] } };
    expect(
        extractTmdbCertifications(trimDetailsForCache(primary), 'movie')
    ).toEqual(extractTmdbCertifications(movie, 'movie'));
    const fallback = {
        id: 1,
        overview: 'French original plot',
        release_dates: { results: [] },
    };
    expect(
        extractTmdbCertifications(
            fillDetailsFromFallback(movie, fallback),
            'movie'
        )
    ).toEqual(extractTmdbCertifications(movie, 'movie'));
});
