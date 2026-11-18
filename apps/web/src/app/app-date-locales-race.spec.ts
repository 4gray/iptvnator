import { APP_DATE_LOCALE_LOADERS } from './app-date-locale-data';
import localePt from '@angular/common/locales/pt';
import localePtPt from '@angular/common/locales/pt-PT';
import { formatDate } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { AppDateLocaleService } from './app-date-locales';
import { PREFERRED_LANGUAGE_STORAGE_KEY } from './app-language-preference';

describe('Portuguese switches with delayed locale chunks', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.removeItem(PREFERRED_LANGUAGE_STORAGE_KEY);
    });

    it('keeps the latest choice when the first locale chunk finishes last', async () => {
        let resolvePortugal!: (locale: { default: typeof localePtPt }) => void;
        const portugalLocale = new Promise<{ default: typeof localePtPt }>(
            (resolve) => {
                resolvePortugal = resolve;
            }
        );
        let resolveBrazil!: (locale: { default: typeof localePt }) => void;
        const brazilLocale = new Promise<{ default: typeof localePt }>(
            (resolve) => {
                resolveBrazil = resolve;
            }
        );
        jest.spyOn(APP_DATE_LOCALE_LOADERS, 'pt-PT').mockReturnValue(
            portugalLocale
        );
        jest.spyOn(APP_DATE_LOCALE_LOADERS, 'pt-BR').mockReturnValue(
            brazilLocale
        );
        const translate = { use: jest.fn() };
        TestBed.configureTestingModule({
            providers: [{ provide: TranslateService, useValue: translate }],
        });
        const service = TestBed.inject(AppDateLocaleService);
        const portugal = service.use('pt-PT');
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            'pt-PT'
        );
        expect(translate.use).not.toHaveBeenCalled();
        const brazil = service.use('pt');
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            'pt-BR'
        );
        resolveBrazil({ default: localePt });
        await brazil;
        expect(translate.use).toHaveBeenCalledWith('pt-BR');
        expect(formatDate(new Date(2024, 0, 15), 'MMMM', 'pt-BR')).toBe(
            'janeiro'
        );
        resolvePortugal({ default: localePtPt });
        await portugal;
        expect(translate.use).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            'pt-BR'
        );
    });
});
