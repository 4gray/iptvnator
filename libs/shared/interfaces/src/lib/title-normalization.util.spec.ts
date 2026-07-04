import {
    normalizeTitle,
    normalizeTitleKeys,
    titleYearsCompatible,
} from './title-normalization.util';

describe('normalizeTitleKeys', () => {
    it('keeps a trailing year in the exact form and strips it in base', () => {
        expect(normalizeTitleKeys('Blade Runner 2049')).toEqual({
            exact: 'blade runner 2049',
            base: 'blade runner',
            trailingYear: 2049,
        });
    });

    it('returns identical tiers when there is no trailing year', () => {
        expect(normalizeTitleKeys('Blade Runner')).toEqual({
            exact: 'blade runner',
            base: 'blade runner',
            trailingYear: null,
        });
    });

    it('strips quality tags and bracket groups on both tiers', () => {
        expect(normalizeTitleKeys('The Matrix 1999 [4K] (Remastered)')).toEqual(
            {
                exact: 'the matrix 1999',
                base: 'the matrix',
                trailingYear: 1999,
            }
        );
    });

    it('never strips a year that IS the whole title', () => {
        expect(normalizeTitleKeys('2012')).toEqual({
            exact: '2012',
            base: '2012',
            trailingYear: null,
        });
    });

    it('keeps leading/mid-title years (only trailing years are tags)', () => {
        expect(normalizeTitle('2001: A Space Odyssey')).toBe(
            '2001 a space odyssey'
        );
    });

    it('only strips UPPERCASE language prefixes', () => {
        expect(normalizeTitle('EN - The Boys s05')).toBe('the boys');
        expect(normalizeTitle('It: Chapter Two')).toBe('it chapter two');
    });

    it('strips season suffixes on both tiers', () => {
        expect(normalizeTitleKeys('The Boys s05').exact).toBe('the boys');
        expect(normalizeTitleKeys('Пацаны сезон 2').base).toBe('пацаны');
    });
});

describe('titleYearsCompatible', () => {
    it('accepts unknown years and ±1 tolerance', () => {
        expect(titleYearsCompatible(null, 2049)).toBe(true);
        expect(titleYearsCompatible(1999, undefined)).toBe(true);
        expect(titleYearsCompatible(1999, 2000)).toBe(true);
    });

    it('rejects contradicting years', () => {
        expect(titleYearsCompatible(1982, 2049)).toBe(false);
    });
});
