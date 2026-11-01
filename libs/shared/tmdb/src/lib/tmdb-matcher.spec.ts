import {
    buildBadProviderIdLookupKey,
    buildDetailsLookupKey,
    buildSearchLookupKey,
    detailsMatchProviderTitle,
    buildSearchTitleVariants,
    extractYear,
    normalizeTitle,
    parseProviderTmdbId,
    pickConfidentMatch,
} from './tmdb-matcher';
import { TmdbSearchResult } from './tmdb.types';

describe('normalizeTitle', () => {
    it('lowercases and strips punctuation', () => {
        expect(normalizeTitle('Synthetic Movie Alpha: Reloaded!')).toBe(
            'synthetic movie alpha reloaded'
        );
    });

    it('removes bracketed tags and quality markers', () => {
        expect(normalizeTitle('Synthetic Movie Alpha (1999) [4K] MULTI')).toBe(
            'synthetic movie alpha'
        );
    });

    it('removes leading language prefixes', () => {
        expect(normalizeTitle('EN - Synthetic Movie Alpha')).toBe(
            'synthetic movie alpha'
        );
        expect(normalizeTitle('DE| Der Untergang')).toBe('der untergang');
    });

    it('strips diacritics', () => {
        expect(normalizeTitle('Amélie')).toBe('amelie');
    });

    it('removes trailing release-year tags', () => {
        expect(normalizeTitle('Synthetic Movie Alpha 1999')).toBe(
            'synthetic movie alpha'
        );
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
        expect(extractYear(null, 'Synthetic Movie Alpha (1999)')).toBe(1999);
        expect(extractYear('', 'Synthetic Movie Alpha 2021 4K')).toBe(2021);
    });

    it('returns null when no year is present', () => {
        expect(extractYear(null, 'Synthetic Movie Alpha')).toBeNull();
        expect(extractYear('invalid', null)).toBeNull();
    });
});

describe('lookup keys', () => {
    it('builds stable search and details keys', () => {
        expect(buildSearchLookupKey('Synthetic Movie Alpha', 1999)).toBe(
            'title:synthetic movie alpha|year:1999|v5'
        );
        expect(buildSearchLookupKey('Synthetic Movie Alpha', null)).toBe(
            'title:synthetic movie alpha|year:|v5'
        );
    });

    it('keys search rows by the wire spelling, not the folded key', () => {
        // "Леика" and "Лейка" fold to one comparison key but are different
        // searches with different answers; a verdict cached for one must
        // never be read back for the other.
        expect(buildSearchLookupKey('Лейка', 2026)).toBe(
            'title:лейка|year:2026|v5'
        );
        expect(buildSearchLookupKey('Леика', 2026)).not.toBe(
            buildSearchLookupKey('Лейка', 2026)
        );
        expect(buildSearchLookupKey('THE BOYS', 2019)).toBe(
            buildSearchLookupKey('The Boys', 2019)
        );
        expect(buildDetailsLookupKey(900001)).toBe('id:900001|v2');
    });
});

describe('buildSearchTitleVariants', () => {
    it('orders original title before display title', () => {
        expect(buildSearchTitleVariants('Пацаны', 'The Boys')).toEqual([
            { query: 'The Boys', normalized: 'the boys' },
            { query: 'Пацаны', normalized: 'пацаны' },
        ]);
    });

    it('adds a language-prefix-stripped fallback variant', () => {
        expect(buildSearchTitleVariants('DE Batman', null)).toEqual([
            { query: 'DE Batman', normalized: 'de batman' },
            { query: 'Batman', normalized: 'batman' },
        ]);
        expect(buildSearchTitleVariants('English The Godfather', null)).toEqual(
            [
                {
                    query: 'English The Godfather',
                    normalized: 'english the godfather',
                },
                { query: 'The Godfather', normalized: 'the godfather' },
            ]
        );
    });

    it('keeps titles that merely look like prefixed ones as the primary variant', () => {
        // "It Follows" must be searched as-is first; the stripped variant
        // is only a fallback
        expect(buildSearchTitleVariants('It Follows', null)[0]).toEqual({
            query: 'It Follows',
            normalized: 'it follows',
        });
    });

    it('sends the provider spelling to the search but compares on the folded key', () => {
        // The folded key rewrites "й" as "и"; TMDB finds nothing for it.
        expect(buildSearchTitleVariants('Лейка (10 серий)', null)).toEqual([
            { query: 'Лейка', normalized: 'леика' },
        ]);
        // Arabic hamza forms fold into a space inside the word
        expect(buildSearchTitleVariants('إيمان', null)).toEqual([
            { query: 'إيمان', normalized: 'ا يمان' },
        ]);
    });

    it('deduplicates by the wire spelling and drops empty values', () => {
        expect(buildSearchTitleVariants('The Boys', 'The Boys')).toEqual([
            { query: 'The Boys', normalized: 'the boys' },
        ]);
        // Case alone is not a different search
        expect(buildSearchTitleVariants('the boys', 'The Boys')).toEqual([
            { query: 'The Boys', normalized: 'the boys' },
        ]);
        expect(buildSearchTitleVariants('', null)).toEqual([]);
    });

    it('keeps spellings that fold to one key but differ on the wire', () => {
        // A misspelled original title must not swallow the display title.
        // Take a pair where only the display spelling is the one TMDB
        // indexes: only the second variant can find it.
        expect(buildSearchTitleVariants('Лейка', 'Леика')).toEqual([
            { query: 'Леика', normalized: 'леика' },
            { query: 'Лейка', normalized: 'леика' },
        ]);
        expect(buildSearchTitleVariants('Amelie', 'Amélie')).toEqual([
            { query: 'Amélie', normalized: 'amelie' },
            { query: 'Amelie', normalized: 'amelie' },
        ]);
    });
});

describe('parseProviderTmdbId', () => {
    it('accepts positive numbers and numeric strings', () => {
        expect(parseProviderTmdbId(900001)).toBe(900001);
        expect(parseProviderTmdbId('900001')).toBe(900001);
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
        id: 900001,
        title: 'Synthetic Movie Alpha',
        release_date: '1999-03-31',
        vote_count: 20000,
    };
    const matrix2021: TmdbSearchResult = {
        id: 624860,
        title: 'Synthetic Movie Alpha Resurrections',
        release_date: '2021-12-16',
        vote_count: 5000,
    };

    it('matches exact normalized title with matching year', () => {
        expect(
            pickConfidentMatch(
                [matrix2021, matrix1999],
                { title: 'Synthetic Movie Alpha (1999)', year: 1999 },
                'movie'
            )
        ).toBe(matrix1999);
    });

    it('tolerates a year off by one', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'Synthetic Movie Alpha', year: 2000 },
                'movie'
            )
        ).toBe(matrix1999);
    });

    it('rejects when the year differs by more than one', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'Synthetic Movie Alpha', year: 2005 },
                'movie'
            )
        ).toBeNull();
    });

    it('rejects fuzzy/partial title matches', () => {
        expect(
            pickConfidentMatch(
                [matrix2021],
                { title: 'Synthetic Movie Alpha', year: 2021 },
                'movie'
            )
        ).toBeNull();
    });

    it('without a year, requires the exact title to be unambiguous', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'Synthetic Movie Alpha', year: null },
                'movie'
            )
        ).toBe(matrix1999);

        const remake: TmdbSearchResult = {
            id: 999,
            title: 'Synthetic Movie Alpha',
            release_date: '2030-01-01',
        };
        expect(
            pickConfidentMatch(
                [matrix1999, remake],
                { title: 'Synthetic Movie Alpha', year: null },
                'movie'
            )
        ).toBeNull();
    });

    it('disambiguates same-title results by year evidence', () => {
        const obscure: TmdbSearchResult = {
            id: 111,
            title: 'Synthetic Movie Alpha',
            release_date: '1998-05-01',
            vote_count: 3,
        };
        expect(
            pickConfidentMatch(
                [obscure, matrix1999],
                { title: 'Synthetic Movie Alpha', year: 1999 },
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

    it('prefers an exact-year series over an older, more popular namesake', () => {
        // Regression: TMDB returns titles in the REQUEST language, so an
        // unrelated older foreign series (2018, 26 votes) came back under the
        // same localized name as the catalog's own 2026 series (4 votes). The
        // older row is admitted only by the running-season tolerance and used
        // to win the popularity tiebreak. Titles here are stand-ins.
        const translatedNamesake: TmdbSearchResult = {
            id: 1,
            name: 'Nightfall',
            original_name: 'Yoru no Tobari',
            first_air_date: '2018-12-14',
            vote_count: 26,
            popularity: 3.4,
        };
        const localSeries: TmdbSearchResult = {
            id: 2,
            name: 'Nightfall',
            original_name: 'Nightfall',
            first_air_date: '2026-07-24',
            vote_count: 4,
            popularity: 2.4,
        };

        expect(
            pickConfidentMatch(
                [localSeries, translatedNamesake],
                { title: 'Nightfall (12 episodes)', year: 2026 },
                'tv'
            )
        ).toBe(localSeries);
    });

    it('rejects several older namesakes when nothing matches the year', () => {
        const theBoys: TmdbSearchResult = {
            id: 76479,
            name: 'The Boys',
            first_air_date: '2019-07-26',
            vote_count: 12000,
        };
        const unrelatedOlder: TmdbSearchResult = {
            id: 999,
            name: 'The Boys',
            first_air_date: '2010-01-01',
            vote_count: 5,
        };

        expect(
            pickConfidentMatch(
                [unrelatedOlder, theBoys],
                { title: 'The Boys s05', year: 2026 },
                'tv'
            )
        ).toBeNull();
    });

    it.each(['movie', 'tv'] as const)(
        'rejects same-title, same-year %s namesakes regardless of popularity or result order',
        (mediaType) => {
            const russian: TmdbSearchResult = {
                id: 900101,
                title: 'Синтетический сериал Альфа',
                name: 'Синтетический сериал Альфа',
                original_title: 'Синтетический сериал Альфа',
                original_name: 'Синтетический сериал Альфа',
                release_date: '2026-10-30',
                first_air_date: '2026-10-30',
                vote_count: 0,
                popularity: 1,
            };
            const american: TmdbSearchResult = {
                ...russian,
                id: 900102,
                original_title: 'Synthetic Series Beta',
                original_name: 'Synthetic Series Beta',
                release_date: '2026-01-21',
                first_air_date: '2026-01-21',
                vote_count: 1000,
                popularity: 100,
            };
            for (const results of [
                [russian, american],
                [american, russian],
            ]) {
                expect(
                    pickConfidentMatch(
                        results,
                        {
                            title: 'Синтетический сериал Альфа (8 серий)',
                            year: 2026,
                        },
                        mediaType
                    )
                ).toBeNull();
            }
        }
    );

    it('rejects multiple candidates in the adjacent-year tier', () => {
        expect(
            pickConfidentMatch(
                [
                    { id: 1, title: 'Namesake', release_date: '2025-01-01' },
                    { id: 2, title: 'Namesake', release_date: '2027-01-01' },
                ],
                { title: 'Namesake', year: 2026 },
                'movie'
            )
        ).toBeNull();
    });

    it('prefers the exact release year over one off by one', () => {
        const exact: TmdbSearchResult = {
            id: 1,
            title: 'Synthetic Movie Alpha',
            release_date: '1999-03-31',
            vote_count: 10,
        };
        const adjacent: TmdbSearchResult = {
            id: 2,
            title: 'Synthetic Movie Alpha',
            release_date: '1998-03-31',
            vote_count: 9000,
        };

        expect(
            pickConfidentMatch(
                [adjacent, exact],
                { title: 'Synthetic Movie Alpha', year: 1999 },
                'movie'
            )
        ).toBe(exact);
    });

    it('still rejects movies with a year that differs by more than one', () => {
        expect(
            pickConfidentMatch(
                [matrix1999],
                { title: 'Synthetic Movie Alpha', year: 2026 },
                'movie'
            )
        ).toBeNull();
    });

    it('returns null for empty inputs', () => {
        expect(
            pickConfidentMatch(
                [],
                { title: 'Synthetic Movie Alpha', year: 1999 },
                'movie'
            )
        ).toBeNull();
        expect(
            pickConfidentMatch([matrix1999], { title: '', year: null }, 'movie')
        ).toBeNull();
    });
});

describe('buildBadProviderIdLookupKey', () => {
    it('namespaces the id so it cannot collide with a details row', () => {
        expect(buildBadProviderIdLookupKey(900001)).toBe(
            'badProviderId:900001'
        );
        expect(buildBadProviderIdLookupKey(900001)).not.toBe(
            buildDetailsLookupKey(900001)
        );
    });
});

describe('detailsMatchProviderTitle', () => {
    const details = {
        title: 'Synthetic Movie Alpha',
        original_title: 'Synthetic Movie Alpha',
    };

    it('accepts a match on a noisy provider title', () => {
        expect(
            detailsMatchProviderTitle(details, {
                title: 'EN - Synthetic Movie Alpha (1999) 1080p',
            })
        ).toBe(true);
    });

    it('accepts a match against the original title only', () => {
        expect(
            detailsMatchProviderTitle(
                { title: 'Die Hard', original_title: 'Stirb langsam' },
                { title: 'Stirb langsam' }
            )
        ).toBe(true);
    });

    it('matches series payloads through name/original_name', () => {
        expect(
            detailsMatchProviderTitle(
                { name: 'The Boys', original_name: 'The Boys' },
                { title: 'The Boys s05' }
            )
        ).toBe(true);
    });

    it('reports a mismatch for an unrelated title', () => {
        expect(
            detailsMatchProviderTitle(details, { title: 'Blade Runner' })
        ).toBe(false);
    });

    it('never reports a mismatch when there is nothing to compare', () => {
        expect(detailsMatchProviderTitle(details, { title: '' })).toBe(true);
        expect(
            detailsMatchProviderTitle({}, { title: 'Synthetic Movie Alpha' })
        ).toBe(false);
    });
});
