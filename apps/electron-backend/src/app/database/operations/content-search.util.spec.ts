import {
    buildCompoundFtsMatchQuery,
    buildCompoundLikePatterns,
    buildM3uPayloadCompoundPatterns,
    getCompoundResidualTokenGroups,
    getCompoundSearchWords,
    getSearchWordPlans,
    parseSearchChips,
    scoreGlobalSearchChips,
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

    describe('getSearchWordPlans', () => {
        it('keeps each word with its own token groups and compound flag', () => {
            expect(getSearchWordPlans('A&E HD')).toEqual([
                { compound: 'A&E', tokenGroups: [['a'], ['e']] },
                { compound: null, tokenGroups: [['hd']] },
            ]);
        });

        it('skips punctuation-only words', () => {
            expect(getSearchWordPlans('Tom & Jerry')).toEqual([
                { compound: null, tokenGroups: [['tom']] },
                { compound: null, tokenGroups: [['jerry']] },
            ]);
        });
    });

    describe('getCompoundResidualTokenGroups', () => {
        it('returns the token groups of the non-compound words only', () => {
            expect(getCompoundResidualTokenGroups('A&E HD')).toEqual([['hd']]);
            expect(getCompoundResidualTokenGroups('A&E')).toEqual([]);
            expect(getCompoundResidualTokenGroups('History')).toEqual([
                ['history'],
            ]);
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

    describe('parseSearchChips', () => {
        it('splits committed chips on newlines and trims blanks', () => {
            expect(parseSearchChips('fr bein\n1968')).toEqual([
                'fr bein',
                '1968',
            ]);
            expect(parseSearchChips('  fr  \n\n 1968 \n')).toEqual([
                'fr',
                '1968',
            ]);
        });

        it('treats a plain query as a single chip', () => {
            expect(parseSearchChips('France 1968')).toEqual(['France 1968']);
        });
    });

    describe('scoreGlobalSearchChips', () => {
        it('collapses a single chip to the plain text score', () => {
            const chip = 'France 1968';
            expect(scoreGlobalSearchChips('France 1968', [chip])).toBe(
                scoreSearchTextMatch('France 1968', chip)
            );
        });

        it('requires every word of a chip (joined, not segmented)', () => {
            // "France 2000" is missing the "1968" word of the single chip.
            expect(
                scoreGlobalSearchChips('France 2000', ['France 1968'])
            ).toBeNull();
        });

        it('matches any chip and ranks more matched chips first', () => {
            const chips = ['fr', 'bein', '1968'];
            const three = scoreGlobalSearchChips('FR beIN 1968', chips);
            const two = scoreGlobalSearchChips('FR beIN HD', chips);
            const one = scoreGlobalSearchChips('FR Movies', chips);
            expect(three).not.toBeNull();
            expect(two).not.toBeNull();
            expect(one).not.toBeNull();
            expect(three as number).toBeLessThan(two as number);
            expect(two as number).toBeLessThan(one as number);
        });

        it('returns null when no chip matches', () => {
            expect(
                scoreGlobalSearchChips('Spain 2020', ['fr', 'bein', '1968'])
            ).toBeNull();
        });

        it('counts a chip as matched when it hits any of several fields', () => {
            // "France" is in field 0, "1968" in field 2 -> both chips matched.
            const both = scoreGlobalSearchChips(
                ['France TV', '', '1968 Movies'],
                ['France', '1968']
            );
            // Only "France" is present -> a one-chip (missing 1) match.
            const one = scoreGlobalSearchChips(
                ['France TV', '', 'Drama'],
                ['France', '1968']
            );

            expect(both).not.toBeNull();
            expect(one).not.toBeNull();
            expect(both as number).toBeLessThan(1000);
            expect(one as number).toBeGreaterThanOrEqual(1000);
            expect(both as number).toBeLessThan(one as number);
        });
    });
});
