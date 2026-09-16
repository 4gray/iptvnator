import {
    categorySearchPredicate,
    categorySearchTerms,
    normalizeCategorySearch,
    serializeCategorySearch,
} from './category-search';

describe('category search', () => {
    const names = [
        'FR Sports HD',
        'CA Sports 4K',
        'Québec cinéma',
        'Sports FR Classics',
        'Canada français',
        'Français Canada',
    ];
    const search = (
        query: string,
        excluded = '',
        mode: 'any' | 'all' = 'all'
    ) => {
        const matches = categorySearchPredicate(query, excluded, mode);
        return names.filter((name) => matches(normalizeCategorySearch(name)));
    };

    it('matches every keyword by default and can match any keyword explicitly', () => {
        expect(search('sports 4k')).toEqual(['CA Sports 4K']);
        expect(search('FR CA', '', 'any')).toHaveLength(5);
        expect(search('FR Sports')).toEqual([
            'FR Sports HD',
            'Sports FR Classics',
        ]);
    });
    it('excludes in both modes, including exclusion-only searches', () => {
        expect(search('sports', '4k')).toEqual([
            'FR Sports HD',
            'Sports FR Classics',
        ]);
        expect(search('sports FR', 'HD', 'all')).toEqual([
            'Sports FR Classics',
        ]);
        expect(search('', 'sports')).toEqual(
            names.slice(2).filter((name) => !name.startsWith('Sports'))
        );
        expect(search('sports -4k')).toEqual([
            'FR Sports HD',
            'Sports FR Classics',
        ]);
        expect(search('sports -"FR Classics"')).toEqual([
            'FR Sports HD',
            'CA Sports 4K',
        ]);
        expect(search('sports - 4k')).toEqual([
            'FR Sports HD',
            'Sports FR Classics',
        ]);
        expect(search('sports', '-4k')).toEqual([
            'FR Sports HD',
            'Sports FR Classics',
        ]);
        expect(search('sports', '-"FR Classics"')).toEqual([
            'FR Sports HD',
            'CA Sports 4K',
        ]);
    });
    it('folds accents and case while preserving substring matching', () => {
        expect(search('QUEBEC cine', '', 'all')).toEqual(['Québec cinéma']);
    });
    it('supports phrases, unfinished quotes, commas and duplicate terms', () => {
        expect(search('"Canada français"')).toEqual(['Canada français']);
        expect(search('"Canada français')).toEqual(['Canada français']);
        expect(
            categorySearchTerms(' FR,fr  Québec quebec "Canada français" ')
        ).toEqual(['FR', 'Québec', 'Canada français']);
        expect(
            categorySearchTerms(
                serializeCategorySearch(['Canada français', 'FR'])
            )
        ).toEqual(['Canada français', 'FR']);
    });
    it('preserves spaces inside quoted phrases', () => {
        const matches = categorySearchPredicate('"ilor "', '', 'all');
        const unfinishedMatches = categorySearchPredicate('" ilor', '', 'all');

        expect(matches('the tailor (2023)')).toBe(true);
        expect(matches('sailor-moon')).toBe(false);
        expect(unfinishedMatches('show ilor test')).toBe(true);
        expect(unfinishedMatches('ilor (2007)')).toBe(false);
        expect(categorySearchTerms('"ilor "')).toEqual(['ilor ']);
    });
    it('handles empty, whitespace and unmatched queries', () => {
        expect(search('  , "" ')).toEqual(names);
        expect(search('unfindable')).toEqual([]);
        expect(search('sports', 'sports')).toEqual([]);
    });
    it('filters a large catalog without changing order or input', () => {
        const catalog = Array.from(
            { length: 20000 },
            (_, id) => `Québec sports ${id}`
        );
        const matches = categorySearchPredicate(
            'quebec sports',
            '19999',
            'all'
        );
        const result = catalog.filter((name) =>
            matches(normalizeCategorySearch(name))
        );
        expect(result).toHaveLength(19999);
        expect(result[0]).toBe(catalog[0]);
        expect(catalog).toHaveLength(20000);
    });
});
