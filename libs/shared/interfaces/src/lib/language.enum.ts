/**
 * Enum with all languages that are available in the application
 */
export enum Language {
    ARABIC = 'ar',
    MOROCCAN_ARABIC = 'ary',
    ENGLISH = 'en',
    KOREAN = 'ko',
    RUSSIAN = 'ru',
    GERMAN = 'de',
    SPANISH = 'es',
    CHINESE = 'zh',
    TRADITIONAL_CHINESE = 'zhtw',
    FRENCH = 'fr',
    ITALIAN = 'it',
    TURKISH = 'tr',
    JAPANESE = 'ja',
    DUTCH = 'nl',
    BELARUSIAN = 'by',
    POLISH = 'pl',
    PORTUGUESE_PORTUGAL = 'pt-PT',
    PORTUGUESE_BRAZIL = 'pt-BR',
    GREEK = 'el',
    HUNGARIAN = 'hu',
    UKRAINIAN = 'uk',
}

const SUPPORTED_LANGUAGES = new Set<string>(Object.values(Language));

/** Canonicalize saved language codes; legacy Portuguese was Brazilian. */
export function normalizeAppLanguage(value: unknown): Language {
    const code =
        typeof value === 'string'
            ? value.trim().replace(/_/g, '-').toLowerCase()
            : '';
    if (code === 'pt' || code === 'pt-br') {
        return Language.PORTUGUESE_BRAZIL;
    }
    if (code === 'pt-pt') {
        return Language.PORTUGUESE_PORTUGAL;
    }
    return SUPPORTED_LANGUAGES.has(code)
        ? (code as Language)
        : Language.ENGLISH;
}
