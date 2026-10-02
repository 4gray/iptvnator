import { shortCountryList, shortCountryName } from './country-short-name';

describe('shortCountryName', () => {
    it('shortens by ISO code first', () => {
        expect(shortCountryName('United States of America', 'US')).toBe('USA');
        expect(shortCountryName('United Kingdom', 'gb')).toBe('UK');
    });

    it('shortens known full names without a code', () => {
        expect(shortCountryName('United States')).toBe('USA');
        expect(shortCountryName('Russian Federation')).toBe('Russia');
        expect(shortCountryName('Korea, Republic of')).toBe('South Korea');
    });

    it('keeps unknown names and falls back to the code', () => {
        expect(shortCountryName('Fictionland')).toBe('Fictionland');
        expect(shortCountryName('', 'xx')).toBe('XX');
    });

    it('splits provider lists', () => {
        expect(shortCountryList('United States, Canada / France')).toEqual([
            'USA',
            'Canada',
            'France',
        ]);
        expect(shortCountryList(undefined)).toEqual([]);
    });
});
