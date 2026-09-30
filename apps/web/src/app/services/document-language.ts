import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

/** UI language codes that are not valid BCP 47 tags. */
const DOCUMENT_LANGUAGE_OVERRIDES: Readonly<Record<string, string>> = {
    by: 'be',
    zhtw: 'zh-TW',
};

/**
 * Maps an app language code to the value for `<html lang>`. The browser uses
 * it for font fallback (Han variants), hyphenation and locale-aware
 * `text-transform` (Turkish dotted İ, Greek accents in uppercase labels).
 */
export function toDocumentLanguage(appLanguage?: string | null): string {
    const code = appLanguage?.trim();
    if (!code) {
        return 'en';
    }
    return DOCUMENT_LANGUAGE_OVERRIDES[code] ?? code;
}

/**
 * Keeps `<html lang>` in step with the active UI language, whichever code path
 * switches it (startup, settings). Must run in an injection context.
 */
export function syncDocumentLanguage(): void {
    const document = inject(DOCUMENT);
    const translate = inject(TranslateService);
    const apply = (language?: string | null): void => {
        document.documentElement.lang = toDocumentLanguage(language);
    };

    apply(translate.currentLang || translate.getDefaultLang());
    translate.onLangChange
        .pipe(takeUntilDestroyed(inject(DestroyRef)))
        .subscribe(({ lang }) => apply(lang));
}
