import { registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes/date-format';
import { createDevLogger, normalizeAppLanguage } from '@iptvnator/shared/interfaces';
import type { AppDateLocaleLoader } from './app-date-locale-data';
import { rememberLanguage } from './app-language-preference';

const debug = createDevLogger('AppDateLocales');

/** English data already ships with Angular. Load other date locale data on demand. */
export function registerAppDateLocale(
    language: string | null | undefined,
    loaders?: Readonly<Record<string, AppDateLocaleLoader>>
): Promise<void> {
    const locale = normalizeDateLocale(language);
    if (locale === 'en') return Promise.resolve();
    return import('./app-date-locale-data')
        .then(({ registerDateLocaleData }) =>
            registerDateLocaleData(locale, loaders)
        )
        .catch((error: unknown) => {
            debug('Loading Angular locale data failed for', locale, error);
            registerLocaleData(localeEn, locale);
        });
}

/** Gates UI language switches on the locale data they render with. */
@Injectable({ providedIn: 'root' })
export class AppDateLocaleService {
    private readonly translate = inject(TranslateService);
    private latestRequest = 0;

    register(language: string | null | undefined): Promise<void> {
        return registerAppDateLocale(language);
    }

    /**
     * Persists the startup hint synchronously, registers the locale data,
     * then switches the UI language. Switches are
     * ordered by request, not by completion: a switch whose data arrives
     * after a newer request was made is dropped, so the language chosen last
     * is the one that ends up active.
     */
    async use(language: string): Promise<void> {
        const request = ++this.latestRequest;
        const normalizedLanguage = normalizeAppLanguage(language);
        rememberLanguage(normalizedLanguage);
        await registerAppDateLocale(normalizedLanguage);
        if (request === this.latestRequest) {
            this.translate.use(normalizedLanguage);
        }
    }
}
