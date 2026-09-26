import { formatDate } from '@angular/common';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { Language } from '@iptvnator/shared/interfaces';
import {
    APP_DATE_LOCALE_LOADERS,
    AppDateLocaleService,
    registerAppDateLocale,
} from './app-date-locales';

const sampleDate = new Date(2024, 0, 15, 13, 5);

describe('registerAppDateLocale', () => {
    it('resolves for English without loading anything', async () => {
        const loader = jest.fn(() => import('@angular/common/locales/de'));

        await registerAppDateLocale('en', { en: loader });
        await registerAppDateLocale('', { en: loader });
        await registerAppDateLocale(undefined, { en: loader });

        expect(loader).not.toHaveBeenCalled();
    });

    it('loads the locale once and shares the in-flight import', async () => {
        const loader = jest.fn(() => import('@angular/common/locales/fr'));

        await Promise.all([
            registerAppDateLocale('fr', { fr: loader }),
            registerAppDateLocale('fr', { fr: loader }),
        ]);
        await registerAppDateLocale('fr', { fr: loader });

        expect(loader).toHaveBeenCalledTimes(1);
        expect(formatDate(sampleDate, 'MMMM', 'fr')).toBe('janvier');
    });

    it('maps app language aliases to Angular locale ids before loading', async () => {
        const loader = jest.fn(() => import('@angular/common/locales/be'));

        await registerAppDateLocale('by', { be: loader });

        expect(loader).toHaveBeenCalledTimes(1);
        expect(formatDate(sampleDate, 'MMMM', 'be')).toBe('студзеня');
    });

    it('resolves on a failed import and retries on the next call', async () => {
        const failing = jest.fn(() => Promise.reject(new Error('offline')));
        const working = jest.fn(() => import('@angular/common/locales/pl'));

        await expect(
            registerAppDateLocale('pl', { pl: failing })
        ).resolves.toBeUndefined();
        expect(() => formatDate(sampleDate, 'MMMM', 'pl')).toThrow();

        await registerAppDateLocale('pl', { pl: working });

        expect(working).toHaveBeenCalledTimes(1);
        expect(formatDate(sampleDate, 'MMMM', 'pl')).toBe('stycznia');
    });

    it('resolves for a language without bundled data instead of rejecting', async () => {
        await expect(registerAppDateLocale('xx', {})).resolves.toBeUndefined();
    });

    it('bundles a loader for every supported language except English', () => {
        const expectedLocales = Object.values(Language)
            .filter((language) => language !== Language.ENGLISH)
            .map((language) => normalizeDateLocale(language))
            .sort();

        expect(Object.keys(APP_DATE_LOCALE_LOADERS).sort()).toEqual(
            expectedLocales
        );
    });

    it('registers working data for every supported language', async () => {
        for (const language of Object.values(Language)) {
            await registerAppDateLocale(language);
            const locale = normalizeDateLocale(language);
            expect(formatDate(sampleDate, 'MMMM', locale)).not.toBe('');
        }
        expect(formatDate(sampleDate, 'MMMM', 'ar-MA')).toBe('يناير');
        expect(formatDate(sampleDate, 'MMMM', 'zh-Hant')).toBe('1月');
    });
});

describe('AppDateLocaleService', () => {
    it('delegates to registerAppDateLocale', async () => {
        await expect(
            new AppDateLocaleService().register(Language.GERMAN)
        ).resolves.toBeUndefined();
        expect(formatDate(sampleDate, 'MMMM', 'de')).toBe('Januar');
    });
});
