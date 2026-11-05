import localePt from '@angular/common/locales/pt';
import localePtPt from '@angular/common/locales/pt-PT';
import { formatDate } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import {
    APP_DATE_LOCALE_LOADERS,
    AppDateLocaleService,
} from './app-date-locales';
import { PREFERRED_LANGUAGE_STORAGE_KEY } from './app-language-preference';

describe('Portuguese switches with delayed locale chunks', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.removeItem(PREFERRED_LANGUAGE_STORAGE_KEY);
    });

    it('keeps the latest choice when the first locale chunk finishes last', async () => {
        let finishPortugal!: (value: { default: typeof localePtPt }) => void;
        let finishBrazil!: (value: { default: typeof localePt }) => void;
        jest.spyOn(APP_DATE_LOCALE_LOADERS, 'pt-PT').mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishPortugal = resolve;
                })
        );
        jest.spyOn(APP_DATE_LOCALE_LOADERS, 'pt-BR').mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishBrazil = resolve;
                })
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
        finishBrazil({ default: localePt });
        await brazil;
        expect(translate.use).toHaveBeenCalledWith('pt-BR');
        expect(formatDate(new Date(2024, 0, 15), 'MMMM', 'pt-BR')).toBe(
            'janeiro'
        );
        finishPortugal({ default: localePtPt });
        await portugal;
        expect(translate.use).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe(
            'pt-BR'
        );
    });
});
