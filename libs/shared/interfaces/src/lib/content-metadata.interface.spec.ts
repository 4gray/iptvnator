import { normalizeContentMetadataPatch } from './content-metadata.interface';

describe('normalizeContentMetadataPatch', () => {
    it('keeps every usable field, trimmed', () => {
        expect(
            normalizeContentMetadataPatch({
                backdropUrl: '  https://example.com/b.jpg  ',
                tmdbId: 603,
                releaseYear: 1999,
                originalTitle: '  The Matrix  ',
            })
        ).toEqual({
            backdropUrl: 'https://example.com/b.jpg',
            tmdbId: 603,
            releaseYear: 1999,
            originalTitle: 'The Matrix',
        });
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty patch', {}],
        ['only blank strings', { backdropUrl: '   ', originalTitle: '\t' }],
    ])('reports %s as nothing to write', (_label, patch) => {
        expect(normalizeContentMetadataPatch(patch)).toBeNull();
    });

    it.each([
        ['zero', 0],
        ['a negative id', -5],
        ['a fractional id', 1.5],
        ['a non-numeric id', 'abc'],
        ['null', null],
    ])('drops %s as a tmdb id', (_label, tmdbId) => {
        expect(
            normalizeContentMetadataPatch({
                tmdbId: tmdbId as number,
                backdropUrl: 'https://example.com/b.jpg',
            })
        ).toEqual({ backdropUrl: 'https://example.com/b.jpg' });
    });

    it('accepts a numeric string id, since providers stringify them', () => {
        expect(normalizeContentMetadataPatch({ tmdbId: '603' as never })).toEqual(
            { tmdbId: 603 }
        );
    });

    it.each([
        ['a year below the range', 1899],
        ['a year above the range', 2100],
        ['a bare season number', 2],
    ])('drops %s as a release year', (_label, releaseYear) => {
        expect(
            normalizeContentMetadataPatch({
                releaseYear,
                backdropUrl: 'https://example.com/b.jpg',
            })
        ).toEqual({ backdropUrl: 'https://example.com/b.jpg' });
    });

    it.each([1900, 1999, 2026, 2099])('keeps %s as a release year', (year) => {
        expect(normalizeContentMetadataPatch({ releaseYear: year })).toEqual({
            releaseYear: year,
        });
    });

    it('never emits keys for fields it dropped', () => {
        // Callers spread the result onto an activity item, so a present-but-
        // undefined key would overwrite a value another source supplied.
        const normalized = normalizeContentMetadataPatch({
            tmdbId: 0,
            releaseYear: 2015,
        });

        expect(Object.keys(normalized ?? {})).toEqual(['releaseYear']);
    });
});
