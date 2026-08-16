import {
    discoverFacetKey,
    hasDiscoverFacet,
    parseDiscoverParams,
} from './discover-params';

describe('parseDiscoverParams', () => {
    it('parses a full valid facet set', () => {
        const facets = parseDiscoverParams({
            type: 'tv',
            year: '1990',
            genre: '18',
            genreLabel: 'Drama',
            country: 'us',
            countryLabel: 'United States',
        });

        expect(facets).toEqual({
            type: 'tv',
            year: 1990,
            genreId: 18,
            genreLabel: 'Drama',
            countryCode: 'US',
            countryLabel: 'United States',
        });
    });

    it('defaults an unknown media type to movie', () => {
        expect(parseDiscoverParams({ type: 'series' }).type).toBe('movie');
        expect(parseDiscoverParams({}).type).toBe('movie');
        expect(parseDiscoverParams({ type: ['tv'] }).type).toBe('movie');
    });

    it('rejects malformed years', () => {
        expect(parseDiscoverParams({ year: '199' }).year).toBeNull();
        expect(parseDiscoverParams({ year: '19901' }).year).toBeNull();
        expect(parseDiscoverParams({ year: 'abcd' }).year).toBeNull();
        expect(parseDiscoverParams({ year: '1990' }).year).toBe(1990);
    });

    it('rejects a zero year a deep link could smuggle in', () => {
        // The chips refuse '0000'; the route must refuse it too, or the
        // request drops the filter and returns unfiltered popular titles
        expect(parseDiscoverParams({ year: '0000' }).year).toBeNull();
        expect(hasDiscoverFacet(parseDiscoverParams({ year: '0000' }))).toBe(
            false
        );
    });

    it('drops a genre label without a valid genre id', () => {
        const facets = parseDiscoverParams({
            genre: 'drama',
            genreLabel: 'Drama',
        });

        expect(facets.genreId).toBeNull();
        expect(facets.genreLabel).toBeNull();
    });

    it('rejects zero and negative genre ids', () => {
        expect(parseDiscoverParams({ genre: '0' }).genreId).toBeNull();
        expect(parseDiscoverParams({ genre: '-5' }).genreId).toBeNull();
    });

    it('normalizes country codes and drops orphaned labels', () => {
        expect(parseDiscoverParams({ country: 'de' }).countryCode).toBe('DE');
        expect(parseDiscoverParams({ country: 'USA' }).countryCode).toBeNull();

        const orphanLabel = parseDiscoverParams({
            countryLabel: 'United States',
        });
        expect(orphanLabel.countryCode).toBeNull();
        expect(orphanLabel.countryLabel).toBeNull();
    });
});

describe('hasDiscoverFacet', () => {
    it('is false for a bare type-only param set', () => {
        expect(hasDiscoverFacet(parseDiscoverParams({ type: 'movie' }))).toBe(
            false
        );
    });

    it('is true when any single facet is present', () => {
        expect(hasDiscoverFacet(parseDiscoverParams({ year: '1990' }))).toBe(
            true
        );
        expect(hasDiscoverFacet(parseDiscoverParams({ genre: '18' }))).toBe(
            true
        );
        expect(hasDiscoverFacet(parseDiscoverParams({ country: 'US' }))).toBe(
            true
        );
    });
});

describe('discoverFacetKey', () => {
    it('produces distinct keys for distinct facet sets', () => {
        const keys = new Set(
            [
                { type: 'movie', year: '1990' },
                { type: 'tv', year: '1990' },
                { type: 'movie', year: '1991' },
                { type: 'movie', genre: '18' },
                { type: 'movie', country: 'US' },
            ].map((params) => discoverFacetKey(parseDiscoverParams(params)))
        );

        expect(keys.size).toBe(5);
    });

    it('is stable for equivalent param objects', () => {
        expect(
            discoverFacetKey(
                parseDiscoverParams({ year: '1990', type: 'movie' })
            )
        ).toBe(discoverFacetKey(parseDiscoverParams({ year: '1990' })));
    });
});
