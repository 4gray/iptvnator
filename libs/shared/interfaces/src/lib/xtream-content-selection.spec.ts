import {
    newlyEnabledXtreamTypes,
    normalizeXtreamContentTypes,
    XTREAM_CONTENT_TYPES,
} from './xtream-content-selection';

describe('Xtream content selection', () => {
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
