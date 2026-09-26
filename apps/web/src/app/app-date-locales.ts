import { registerLocaleData } from '@angular/common';
import { Injectable } from '@angular/core';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { createDevLogger } from '@iptvnator/shared/interfaces';

type LocaleDataModule = { default: unknown };
export type AppDateLocaleLoader = () => Promise<LocaleDataModule>;

const debug = createDevLogger('AppDateLocales');

/**
 * Angular ships only English locale data; every other UI language needs its
 * data registered before `DatePipe` can format with it. Each entry is a
 * separate lazy chunk, keyed by the Angular locale id that
 * `normalizeDateLocale()` produces for an app language (`by` -> `be`,
 * `ary` -> `ar-MA`, `zhtw` -> `zh-Hant`). Importing all of them eagerly put
 * the data for 18 languages into the initial bundle of every user.
 */
export const APP_DATE_LOCALE_LOADERS: Readonly<
    Record<string, AppDateLocaleLoader>
> = {
    ar: () => import('@angular/common/locales/ar'),
    'ar-MA': () => import('@angular/common/locales/ar-MA'),
    be: () => import('@angular/common/locales/be'),
    de: () => import('@angular/common/locales/de'),
    el: () => import('@angular/common/locales/el'),
    es: () => import('@angular/common/locales/es'),
    fr: () => import('@angular/common/locales/fr'),
    hu: () => import('@angular/common/locales/hu'),
    it: () => import('@angular/common/locales/it'),
    ja: () => import('@angular/common/locales/ja'),
    ko: () => import('@angular/common/locales/ko'),
    nl: () => import('@angular/common/locales/nl'),
    pl: () => import('@angular/common/locales/pl'),
    pt: () => import('@angular/common/locales/pt'),
    ru: () => import('@angular/common/locales/ru'),
    tr: () => import('@angular/common/locales/tr'),
    zh: () => import('@angular/common/locales/zh'),
    'zh-Hant': () => import('@angular/common/locales/zh-Hant'),
};

const registeredLocales = new Set<string>(['en']);
const pendingLocales = new Map<string, Promise<void>>();

/**
 * Registers the Angular locale data for an app language, loading it on first
 * use. Resolves once `DatePipe` can format with that locale, so call it before
 * `TranslateService.use()`: the language switch re-renders every date with the
 * new locale, and a locale whose data has not arrived throws. English resolves
 * immediately, as does a locale that is already registered or in flight.
 *
 * A failed load resolves rather than rejects so the language switch still
 * happens; the next call for that locale retries the import.
 */
export function registerAppDateLocale(
    language: string | null | undefined,
    loaders: Readonly<
        Record<string, AppDateLocaleLoader>
    > = APP_DATE_LOCALE_LOADERS
): Promise<void> {
    const locale = normalizeDateLocale(language);
    if (registeredLocales.has(locale)) {
        return Promise.resolve();
    }
    const inFlight = pendingLocales.get(locale);
    if (inFlight) {
        return inFlight;
    }
    const loader = loaders[locale];
    if (!loader) {
        debug('No bundled Angular locale data for', locale);
        return Promise.resolve();
    }

    const load = loader()
        .then((module) => {
            registerLocaleData(module.default, locale);
            registeredLocales.add(locale);
        })
        .catch((error: unknown) => {
            debug('Loading Angular locale data failed', locale, error);
        })
        .finally(() => {
            pendingLocales.delete(locale);
        });
    pendingLocales.set(locale, load);
    return load;
}

/** Injectable wrapper so components can gate a language switch on the data. */
@Injectable({ providedIn: 'root' })
export class AppDateLocaleService {
    register(language: string | null | undefined): Promise<void> {
        return registerAppDateLocale(language);
    }
}
