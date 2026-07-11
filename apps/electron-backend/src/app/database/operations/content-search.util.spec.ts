import {
    buildCompoundFtsMatchQuery,
    buildCompoundLikePatterns,
    buildM3uPayloadCompoundPatterns,
    getCompoundSearchWords,
    scoreSearchTextMatch,
    shouldUseContentTitlePrefixIndex,
} from './content-search.util';

describe('content-search.util', () => {
    describe('getCompoundSearchWords', () => {
        it('extracts punctuation-joined words from the raw search term', () => {
            expect(getCompoundSearchWords('A&E')).toEqual(['A&E']);
            expect(getCompoundSearchWords('US A&E HD')).toEqual(['A&E']);
            expect(getCompoundSearchWords('Spider-Man')).toEqual([
                'Spider-Man',
            ]);
            expect(getCompoundSearchWords("L'Équipe")).toEqual(["L'Équipe"]);
        });

        it('trims edge punctuation before deciding whether a word is compound', () => {
            expect(getCompoundSearchWords('(A&E)')).toEqual(['A&E']);
            expect(getCompoundSearchWords('"A&E:"')).toEqual(['A&E']);
        });

        it('ignores plain words, standalone punctuation and too-short fragments', () => {
            expect(getCompoundSearchWords('History')).toEqual([]);
            expect(getCompoundSearchWords('Tom & Jerry')).toEqual([]);
            expect(getCompoundSearchWords('a&')).toEqual([]);
            expect(getCompoundSearchWords('')).toEqual([]);
            expect(getCompoundSearchWords(undefined)).toEqual([]);
        });

    });

    describe('buildCompoundFtsMatchQuery', () => {
        it('quotes each compound word as a trigram substring phrase', () => {
            expect(buildCompoundFtsMatchQuery('A&E')).toBe('"a&e"');
            expect(buildCompoundFtsMatchQuery('X-Men')).toBe('"x-men"');
        });

        it('keeps accented and diacritic-stripped variants', () => {
            expect(buildCompoundFtsMatchQuery("L'Équipe")).toBe(
                '("l\'équipe" OR "l\'equipe")'
            );
        });

        it('joins multiple compound words with AND', () => {
            expect(buildCompoundFtsMatchQuery('A&E X-Men')).toBe(
                '"a&e" AND "x-men"'
            );
        });

        it('returns an empty query for terms without compound words', () => {
            expect(buildCompoundFtsMatchQuery('History Channel')).toBe('');
            expect(buildCompoundFtsMatchQuery('tv')).toBe('');
        });
    });

    describe('buildCompoundLikePatterns', () => {
        it('builds case-variant contains patterns around the intact word', () => {
            const patterns = buildCompoundLikePatterns('A&E');

            expect(patterns).toContain('%a&e%');
            expect(patterns).toContain('%A&E%');
            expect(
                patterns.every(
                    (pattern) =>
                        pattern.startsWith('%') && pattern.endsWith('%')
                )
            ).toBe(true);
        });

        it('escapes LIKE wildcards inside the compound word', () => {
            expect(buildCompoundLikePatterns('a_b')).toContain('%a\\_b%');
        });
    });

    describe('buildM3uPayloadCompoundPatterns', () => {
        it('scopes compound contains patterns to payload name/title fields', () => {
            const patterns = buildM3uPayloadCompoundPatterns('A&E');

            expect(patterns).toContain('%"name":"%a&e%"%');
            expect(patterns).toContain('%"title":"%a&e%"%');
        });
    });

    describe('shouldUseContentTitlePrefixIndex', () => {
        it('still routes compound short-token terms through the prefix index', () => {
            // The compound FTS lookup supplements the prefix arm instead of
            // replacing it, so titles starting with "A & E" keep matching.
            expect(shouldUseContentTitlePrefixIndex('A&E')).toBe(true);
            expect(shouldUseContentTitlePrefixIndex('Spider-Man')).toBe(false);
        });
    });

    describe('scoreSearchTextMatch', () => {
        it('matches compound words anywhere in the title (issue #1161)', () => {
            expect(scoreSearchTextMatch('US: A&E', 'A&E')).toBe(40);
            expect(scoreSearchTextMatch('US | A&E HD', 'A&E HD')).toBe(40);
            expect(scoreSearchTextMatch('(US) A&E', 'A&E')).toBe(40);
        });

        it('keeps exact and prefix compound matches ranked above mid-title ones', () => {
            expect(scoreSearchTextMatch('A&E', 'A&E')).toBe(0);
            expect(scoreSearchTextMatch('A&E HD', 'A&E')).toBe(10);
        });

        it('does not match the phrase across word boundaries', () => {
            expect(scoreSearchTextMatch('Casa e Villa', 'A&E')).toBeNull();
            expect(scoreSearchTextMatch('Bravo Espana', 'A&E')).toBeNull();
        });

        it('requires every extra token, not just the compound word', () => {
            expect(scoreSearchTextMatch('US: A&E', 'A&E HD')).toBeNull();
        });

        it('keeps single short tokens anchored to the title start', () => {
            expect(scoreSearchTextMatch('TV Sport News', 'tv')).toBe(10);
            expect(scoreSearchTextMatch('Test TV', 'tv')).toBeNull();
        });
    });
});
