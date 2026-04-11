import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeArMa from '@angular/common/locales/ar-MA';
import localeBe from '@angular/common/locales/be';
import localeDe from '@angular/common/locales/de';
import localeEl from '@angular/common/locales/el';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import localeIt from '@angular/common/locales/it';
import localeJa from '@angular/common/locales/ja';
import localeKo from '@angular/common/locales/ko';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localePt from '@angular/common/locales/pt';
import localeRu from '@angular/common/locales/ru';
import localeTr from '@angular/common/locales/tr';
import localeZh from '@angular/common/locales/zh';
import localeZhHant from '@angular/common/locales/zh-Hant';

let localesRegistered = false;

export function registerAppDateLocales(): void {
    if (localesRegistered) {
        return;
    }

    registerLocaleData(localeAr, 'ar');
    registerLocaleData(localeArMa, 'ar-MA');
    registerLocaleData(localeBe, 'be');
    registerLocaleData(localeDe, 'de');
    registerLocaleData(localeEl, 'el');
    registerLocaleData(localeEs, 'es');
    registerLocaleData(localeFr, 'fr');
    registerLocaleData(localeIt, 'it');
    registerLocaleData(localeJa, 'ja');
    registerLocaleData(localeKo, 'ko');
    registerLocaleData(localeNl, 'nl');
    registerLocaleData(localePl, 'pl');
    registerLocaleData(localePt, 'pt');
    registerLocaleData(localeRu, 'ru');
    registerLocaleData(localeTr, 'tr');
    registerLocaleData(localeZh, 'zh');
    registerLocaleData(localeZhHant, 'zh-Hant');

    localesRegistered = true;
}
