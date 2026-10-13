import { formatDate } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { Language } from '@iptvnator/shared/interfaces';
import { PREFERRED_LANGUAGE_STORAGE_KEY } from './app-language-preference';
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

    it('falls back to English formatting on a failed import and retries on the next call', async () => {
        const failing = jest.fn(() => Promise.reject(new Error('offline')));
        const working = jest.fn(() => import('@angular/common/locales/pl'));

        await expect(
            registerAppDateLocale('pl', { pl: failing })
        ).resolves.toBeUndefined();
        expect(formatDate(sampleDate, 'MMMM', 'pl')).toBe('January');

        await registerAppDateLocale('pl', { pl: working });

        expect(working).toHaveBeenCalledTimes(1);
        expect(formatDate(sampleDate, 'MMMM', 'pl')).toBe('stycznia');
    });

    it('resolves for a language without bundled data instead of rejecting', async () => {
        await expect(registerAppDateLocale('xx', {})).resolves.toBeUndefined();
    });

    it('uses distinct Portuguese regional date formats and maps legacy pt to Brazil', async () => {
        await registerAppDateLocale('pt-PT');
        await registerAppDateLocale('pt-BR');
        await registerAppDateLocale('pt');
        expect(formatDate(sampleDate, 'short', 'pt-PT')).toBe(
            '15/01/24, 13:05'
        );
        expect(formatDate(sampleDate, 'short', 'pt-BR')).toBe(
            '15/01/2024 13:05'
        );
        expect(normalizeDateLocale('pt')).toBe('pt-BR');
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
    let translate: { use: jest.Mock };
    let service: AppDateLocaleService;

    afterEach(() => localStorage.removeItem(PREFERRED_LANGUAGE_STORAGE_KEY));

    beforeEach(() => {
        translate = { use: jest.fn() };
        TestBed.configureTestingModule({
            providers: [{ provide: TranslateService, useValue: translate }],
        });
        service = TestBed.inject(AppDateLocaleService);
    });

    it('delegates register to registerAppDateLocale', async () => {
        await expect(
            service.register(Language.GERMAN)
        ).resolves.toBeUndefined();
        expect(formatDate(sampleDate, 'MMMM', 'de')).toBe('Januar');
    });

    it('registers the locale data before switching the language', async () => {
        await service.use(Language.HUNGARIAN);

        expect(translate.use).toHaveBeenCalledWith(Language.HUNGARIAN);
        expect(formatDate(sampleDate, 'MMMM', 'hu')).toBe('január');
    });

    it('updates the normalized cold-start hint synchronously before switching the UI', async () => {
        const portugal = service.use('pt_PT');
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            'pt-PT'
        );
        expect(translate.use).not.toHaveBeenCalled();
        await portugal;

        const brazil = service.use('pt');
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            'pt-BR'
        );
        await brazil;
        expect(translate.use).toHaveBeenLastCalledWith('pt-BR');
    });

    it('applies only the language requested last when switches overlap', async () => {
        const first = service.use(Language.ITALIAN);
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            Language.ITALIAN
        );
        const last = service.use(Language.TURKISH);
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            Language.TURKISH
        );
        await Promise.all([first, last]);

        expect(translate.use).toHaveBeenCalledTimes(1);
        expect(translate.use).toHaveBeenCalledWith(Language.TURKISH);
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            Language.TURKISH
        );
    });
});
