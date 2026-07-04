import { Language } from '@iptvnator/shared/interfaces';
import { tmdbSearchLanguageForTitle, toTmdbLanguage } from './tmdb-config';

describe('toTmdbLanguage', () => {
    it('maps app languages to TMDB codes', () => {
        expect(toTmdbLanguage(Language.GERMAN)).toBe('de-DE');
        expect(toTmdbLanguage(Language.RUSSIAN)).toBe('ru-RU');
    });

    it('falls back to en-US for unknown values', () => {
        expect(toTmdbLanguage(undefined)).toBe('en-US');
        expect(toTmdbLanguage('xx')).toBe('en-US');
    });
});

describe('tmdbSearchLanguageForTitle', () => {
    it('uses the app language for Latin titles', () => {
        expect(tmdbSearchLanguageForTitle('The Matrix', Language.GERMAN)).toBe(
            'de-DE'
        );
    });

    it('switches to ru-RU for Cyrillic titles when the app language is not Cyrillic-based', () => {
        expect(
            tmdbSearchLanguageForTitle('Ирония судьбы', Language.ENGLISH)
        ).toBe('ru-RU');
        expect(
            tmdbSearchLanguageForTitle('Ирония судьбы', Language.GERMAN)
        ).toBe('ru-RU');
    });

    it('keeps Cyrillic-based app languages for Cyrillic titles', () => {
        expect(
            tmdbSearchLanguageForTitle('Ирония судьбы', Language.RUSSIAN)
        ).toBe('ru-RU');
        expect(
            tmdbSearchLanguageForTitle('Ірония лёсу', Language.BELARUSIAN)
        ).toBe('be-BY');
    });
});
