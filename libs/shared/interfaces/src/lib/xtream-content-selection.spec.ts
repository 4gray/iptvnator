import {
    newlyEnabledXtreamTypes,
    getXtreamContentRoute,
    normalizeXtreamContentTypes,
    XTREAM_CONTENT_TYPES,
} from './xtream-content-selection';

describe('Xtream content selection', () => {
    it('uses the same Movies, Live TV, Series order as the sidebar', () => {
        expect(XTREAM_CONTENT_TYPES).toEqual(['movie', 'live', 'series']);
        expect(
            newlyEnabledXtreamTypes([], ['series', 'live', 'movie'])
        ).toEqual(['movie', 'live', 'series']);
    });
    it.each<{ types: unknown; route: string | null }>([
        { types: ['movie'], route: 'vod' },
        { types: ['live'], route: 'live' },
        { types: ['series'], route: 'series' },
        { types: ['series', 'movie'], route: 'vod' },
        { types: ['live', 'movie'], route: 'vod' },
        { types: ['series', 'live'], route: 'live' },
        { types: ['series', 'live', 'movie'], route: 'vod' },
        { types: [], route: null },
        { types: undefined, route: 'vod' },
    ])('opens the first selected section for $types', ({ types, route }) => {
        expect(getXtreamContentRoute(types)).toBe(route);
    });
    it.each([undefined, null, 'invalid'])(
        'defaults missing/invalid legacy values to all types: %p',
        (value) => {
            expect(normalizeXtreamContentTypes(value)).toEqual([
                ...XTREAM_CONTENT_TYPES,
            ]);
        }
    );
    it('preserves the explicit empty selection', () => {
        expect(normalizeXtreamContentTypes([])).toEqual([]);
    });
    it('deduplicates, validates and orders supported types', () => {
        expect(
            normalizeXtreamContentTypes(['series', 'movie', 'movie', 'sports'])
        ).toEqual(['movie', 'series']);
    });
    it('refreshes only newly enabled types', () => {
        expect(newlyEnabledXtreamTypes(['live'], ['live', 'movie'])).toEqual([
            'movie',
        ]);
        expect(newlyEnabledXtreamTypes(undefined, ['live'])).toEqual([]);
        expect(newlyEnabledXtreamTypes(['live'], [])).toEqual([]);
        expect(newlyEnabledXtreamTypes([], ['series'])).toEqual(['series']);
    });
});
