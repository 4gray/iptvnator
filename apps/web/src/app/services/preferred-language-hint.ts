const SUPPORTED_LANGS = new Set([
    'ar',
    'ary',
    'by',
    'de',
    'el',
    'en',
    'es',
    'fr',
    'it',
    'ja',
    'ko',
    'nl',
    'pl',
    'pt',
    'ru',
    'tr',
    'zh',
    'zhtw',
]);

export const PREFERRED_LANGUAGE_STORAGE_KEY = 'iptvnator:preferred-language';

export function normalizePreferredLanguage(language: unknown): string | null {
    const normalized =
        typeof language === 'string' ? language.trim().toLowerCase() : '';

    return SUPPORTED_LANGS.has(normalized) ? normalized : null;
}

export function readPreferredLanguageHint(): string | null {
    try {
        return normalizePreferredLanguage(
            localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)
        );
    } catch {
        return null;
    }
}

export function writePreferredLanguageHint(language: unknown): void {
    const normalized = normalizePreferredLanguage(language);
    if (!normalized) {
        return;
    }

    try {
        localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, normalized);
    } catch {
        // Ignore quota / privacy mode errors.
    }
}
