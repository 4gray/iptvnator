import {
    buildDetailsLookupKey,
    buildSearchLookupKey,
    buildSearchTitleVariants,
    extractYear,
    normalizeTitle,
    parseProviderTmdbId,
    pickConfidentMatch,
} from './tmdb-matcher';
import { TmdbSearchResult } from './tmdb.types';

describe('normalizeTitle', () => {
    it('lowercases and strips punctuation', () => {
        expect(normalizeTitle('The Matrix: Reloaded!')).toBe(
            'the matrix reloaded'
        );
    });

    it('removes bracketed tags and quality markers', () => {
        expect(normalizeTitle('The Matrix (1999) [4K] MULTI')).toBe(
            'the matrix'
        );
    });

    it('removes leading language prefixes', () => {
        expect(normalizeTitle('EN - The Matrix')).toBe('the matrix');
        expect(normalizeTitle('DE| Der Untergang')).toBe('der untergang');
    });

    it('strips diacritics', () => {
        expect(normalizeTitle('Amélie')).toBe('amelie');
    });

    it('removes trailing release-year tags', () => {
        expect(normalizeTitle('The Matrix 1999')).toBe('the matrix');
    });

    it('keeps year-only titles intact', () => {
        expect(normalizeTitle('2012')).toBe('2012');
    });

    it('removes trailing season markers from series titles', () => {
        expect(normalizeTitle('The Boys s05')).toBe('the boys');
        expect(normalizeTitle('The Boys S01')).toBe('the boys');
        expect(normalizeTitle('Breaking Bad Season 2')).toBe('breaking bad');
        expect(normalizeTitle('Пацаны сезон 3')).toBe('пацаны');
        expect(normalizeTitle('Dark Staffel 2')).toBe('dark');
    });

    it('does not touch season-like tokens mid-title', () => {
        expect(normalizeTitle('Season of the Witch')).toBe(
            'season of the witch'
        );
    });

    it('returns empty string for nullish input', () => {
        expect(normalizeTitle(null)).toBe('');
        expect(normalizeTitle(undefined)).toBe('');
    });
});

describe('extractYear', () => {
    it('prefers the release date', () => {
        expect(extractYear('1999-03-31', 'Movie 2005')).toBe(1999);
    });

    it('falls back to a year tag in the title', () => {
        expect(extractYear(null, 'The Matrix (1999)')).toBe(1999);
        expect(extractYear('', 'The Matrix 2021 4K')).toBe(2021);
    });

    it('returns null when no year is present', () => {
        expect(extractYear(null, 'The Matrix')).toBeNull();
        expect(extractYear('invalid', null)).toBeNull();
    });
});

describe('lookup keys', () => {
    it('builds stable search and details keys', () => {
        expect(buildSearchLookupKey('the matrix', 1999)).toBe(
            'title:the matrix|year:1999'
        );
        expect(buildSearchLookupKey('the matrix', null)).toBe(
            'title:the matrix|year:'
        );
        expect(buildDetailsLookupKey(603)).toBe('id:603|v2');
    });
});

describe('buildSearchTitleVariants', () => {
    it('orders original title before display title', () => {
        expect(buildSearchTitleVariants('Пацаны', 'The Boys')).toEqual([
            'the boys',
            'пацаны',
        ]);
    });

    it('adds a language-prefix-stripped fallback variant', () => {
        expect(buildSearchTitleVariants('DE Batman', null)).toEqual([
            'de batman',
            'batman',
        ]);
        expect(
            buildSearchTitleVariants('English The Godfather', null)
        ).toEqual(['english the godfather', 'the godfather']);
    });

    it('keeps titles that merely look like prefixed ones as the primary variant', () => {
        // "It Follows" must be searched as-is first; the stripped variant
        // is only a fallback
        expect(buildSearchTitleVariants('It Follows', null)[0]).toBe(
            'it follows'
        );
    });

    it('deduplicates and drops empty values', () => {
        expect(buildSearchTitleVariants('The Boys', 'The Boys')).toEqual([
            'the boys',
        ]);
        expect(buildSearchTitleVariants('', null)).toEqual([]);
    });
});

describe('parseProviderTmdbId', () => {
    it('accepts positive numbers and numeric strings', () => {
        expect(parseProviderTmdbId(603)).toBe(603);
        expect(parseProviderTmdbId('603')).toBe(603);
    });

    it('rejects zero, negatives, garbage and nullish values', () => {
        expect(parseProviderTmdbId(0)).toBeNull();
        expect(parseProviderTmdbId(-5)).toBeNull();
        expect(parseProviderTmdbId('abc')).toBeNull();
        expect(parseProviderTmdbId('')).toBeNull();
        expect(parseProviderTmdbId(null)).toBeNull();
        expect(parseProviderTmdbId(undefined)).toBeNull();
    });
});

describe('pickConfidentMatch', () => {
    const matrix1999: TmdbSearchResult = {
        id: 603,
        title: 'The Matrix',
        release_date: '1999-03-31',
        vote_count: 20000,
    };
    const matrix2021: TmdbSearchResult = {
        id: 624860,
        title: 'The Matrix Resurrections',
        release_date: '2021-12-16',
        vote_count: 5000,
    };

    it('matches exact normalized title with matching year', () => {
        expect(
            pickConfidentMatch(
                [matrix2021, matrix1999],
                { title: 'The Matrix (1999)', year: 1999 },
                'movie'
            )
        ).toBe(matrix1999);
    });

    it('tolerates a year off by one', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'The Matrix', year: 2000 },
                'movie'
            )
        ).toBe(matrix1999);
    });

    it('rejects when the year differs by more than one', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'The Matrix', year: 2005 },
                'movie'
            )
        ).toBeNull();
    });

    it('rejects fuzzy/partial title matches', () => {
        expect(
            pickConfidentMatch(
                [matrix2021],
                { title: 'The Matrix', year: 2021 },
                'movie'
            )
        ).toBeNull();
    });

    it('without a year, requires the exact title to be unambiguous', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'The Matrix', year: null },
                'movie'
            )
        ).toBe(matrix1999);

        const remake: TmdbSearchResult = {
            id: 999,
            title: 'The Matrix',
            release_date: '2030-01-01',
        };
        expect(
            pickConfidentMatch(
                [matrix1999, remake],
                { title: 'The Matrix', year: null },
                'movie'
            )
        ).toBeNull();
    });

    it('disambiguates same-title results by vote count', () => {
        const obscure: TmdbSearchResult = {
            id: 111,
            title: 'The Matrix',
            release_date: '1998-05-01',
            vote_count: 3,
        };
        expect(
            pickConfidentMatch(
                [obscure, matrix1999],
                { title: 'The Matrix', year: 1999 },
                'movie'
            )
        ).toBe(matrix1999);
    });

    it('matches original_title too', () => {
        const amelie: TmdbSearchResult = {
            id: 194,
            title: 'Amélie',
            original_title: 'Le Fabuleux Destin d’Amélie Poulain',
            release_date: '2001-04-25',
            vote_count: 11000,
        };
        expect(
            pickConfidentMatch(
                [amelie],
                { title: 'Le fabuleux destin d’Amelie Poulain', year: 2001 },
                'movie'
            )
        ).toBe(amelie);
    });

    it('uses name fields for tv results', () => {
        const dark: TmdbSearchResult = {
            id: 70523,
            name: 'Dark',
            first_air_date: '2017-12-01',
            vote_count: 3000,
        };
        expect(
            pickConfidentMatch([dark], { title: 'Dark', year: 2017 }, 'tv')
        ).toBe(dark);
    });

    it('accepts tv shows that premiered before the provider year (season year)', () => {
        const theBoys: TmdbSearchResult = {
            id: 76479,
            name: 'The Boys',
            first_air_date: '2019-07-26',
            vote_count: 12000,
        };
        // Provider sends the running season's year ("The Boys s05" → 2026)
        expect(
            pickConfidentMatch(
                [theBoys],
                { title: 'The Boys s05', year: 2026 },
                'tv'
            )
        ).toBe(theBoys);
    });

    it('still rejects movies with a year that differs by more than one', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'The Matrix', year: 2026 },
                'movie'
            )
        ).toBeNull();
    });

    it('returns null for empty inputs', () => {
        expect(
            pickConfidentMatch([], { title: 'The Matrix', year: 1999 }, 'movie')
        ).toBeNull();
        expect(
            pickConfidentMatch([matrix1999], { title: '', year: null }, 'movie')
        ).toBeNull();
    });
});
