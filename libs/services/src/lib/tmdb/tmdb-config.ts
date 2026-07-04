import { Language } from '@iptvnator/shared/interfaces';

export const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
export const TMDB_POSTER_SIZE = 'w500';
export const TMDB_BACKDROP_SIZE = 'w1280';
export const TMDB_PROFILE_SIZE = 'w185';
export const TMDB_STILL_SIZE = 'w300';

/**
 * Embedded application API key used when the user has not configured their
 * own key in settings. Empty by design: distributed builds ship without a
 * key (each user brings their own — that matches TMDB's personal-use
 * terms). CI can optionally inject a key via the TMDB_API_KEY secret and
 * tools/tmdb/inject-tmdb-key.mjs. With no key available, enrichment stays
 * inactive even when enabled in settings.
 */
export const DEFAULT_TMDB_API_KEY = '';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long cached TMDB details payloads stay fresh */
export const TMDB_DETAILS_CACHE_TTL_MS = 30 * DAY_MS;
/** How long a resolved title→id match stays fresh */
export const TMDB_MATCH_CACHE_TTL_MS = 30 * DAY_MS;
/** Negative matches retry sooner — providers fix titles, TMDB adds entries */
export const TMDB_NEGATIVE_MATCH_CACHE_TTL_MS = 7 * DAY_MS;

/** App language → TMDB language-region code for localized metadata */
const TMDB_LANGUAGE_MAP: Record<Language, string> = {
    [Language.ARABIC]: 'ar-SA',
    [Language.MOROCCAN_ARABIC]: 'ar-MA',
    [Language.ENGLISH]: 'en-US',
    [Language.KOREAN]: 'ko-KR',
    [Language.RUSSIAN]: 'ru-RU',
    [Language.GERMAN]: 'de-DE',
    [Language.SPANISH]: 'es-ES',
    [Language.CHINESE]: 'zh-CN',
    [Language.TRADITIONAL_CHINESE]: 'zh-TW',
    [Language.FRENCH]: 'fr-FR',
    [Language.ITALIAN]: 'it-IT',
    [Language.TURKISH]: 'tr-TR',
    [Language.JAPANESE]: 'ja-JP',
    [Language.DUTCH]: 'nl-NL',
    [Language.BELARUSIAN]: 'be-BY',
    [Language.POLISH]: 'pl-PL',
    [Language.PORTUGUESE]: 'pt-PT',
    [Language.GREEK]: 'el-GR',
};

export function toTmdbLanguage(
    language: Language | string | null | undefined
): string {
    return (
        TMDB_LANGUAGE_MAP[language as Language] ??
        TMDB_LANGUAGE_MAP[Language.ENGLISH]
    );
}

const CYRILLIC_PATTERN = /[\u0400-\u04ff]/;
const CYRILLIC_TMDB_LANGUAGES = new Set(['ru-RU', 'be-BY']);

/**
 * Language to use for the /search request. TMDB matches translated titles
 * but returns `title` in the REQUEST language — so a Cyrillic query issued
 * with an `en-US` request comes back with an English title and fails the
 * exact-match confidence gate. Detect the query script and switch the
 * search language accordingly; details are still fetched in the app
 * language afterwards.
 */
export function tmdbSearchLanguageForTitle(
    title: string,
    appLanguage: Language | string | null | undefined
): string {
    const appTmdbLanguage = toTmdbLanguage(appLanguage);

    if (
        CYRILLIC_PATTERN.test(title) &&
        !CYRILLIC_TMDB_LANGUAGES.has(appTmdbLanguage)
    ) {
        return 'ru-RU';
    }

    return appTmdbLanguage;
}

export function tmdbPosterUrl(path: string | null | undefined): string | null {
    return path ? `${TMDB_IMAGE_BASE_URL}/${TMDB_POSTER_SIZE}${path}` : null;
}

export function tmdbBackdropUrl(
    path: string | null | undefined
): string | null {
    return path ? `${TMDB_IMAGE_BASE_URL}/${TMDB_BACKDROP_SIZE}${path}` : null;
}

export function tmdbProfileUrl(
    path: string | null | undefined
): string | null {
    return path ? `${TMDB_IMAGE_BASE_URL}/${TMDB_PROFILE_SIZE}${path}` : null;
}

export function tmdbStillUrl(path: string | null | undefined): string | null {
    return path ? `${TMDB_IMAGE_BASE_URL}/${TMDB_STILL_SIZE}${path}` : null;
}
