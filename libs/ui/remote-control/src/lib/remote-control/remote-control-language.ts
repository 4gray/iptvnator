/**
 * Translation files the page loads from `apps/web/src/assets/i18n` (copied
 * by the build). Kept here instead of importing the app's `Language` enum:
 * a dependency on shared-interfaces pulls its build cycle into this app's
 * build. The spec checks the list against the files.
 */
export const REMOTE_CONTROL_TRANSLATIONS: readonly string[] = [
    'ar',
    'ary',
    'by',
    'de',
    'el',
    'en',
    'es',
    'fr',
    'hu',
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
];

const TRANSLATED_LANGUAGES: ReadonlySet<string> = new Set(
    REMOTE_CONTROL_TRANSLATIONS
);
const TRADITIONAL_CHINESE_SUBTAGS = new Set(['hant', 'tw', 'hk', 'mo']);

export interface RemoteControlLanguage {
    /** Translation file to load, an app language code such as `zhtw`. */
    translation: string;
    /** BCP 47 tag for `<html lang>`. */
    documentLanguage: string;
}

/**
 * The remote page opens in the phone's browser, which never sees the desktop
 * app's language setting. It follows the browser's preferred languages
 * instead: the first one with a translation wins, otherwise English.
 */
export function resolveRemoteControlLanguage(
    browserLanguages: readonly string[]
): RemoteControlLanguage {
    for (const tag of browserLanguages) {
        const translation = toTranslationCode(tag);
        if (translation) {
            return { translation, documentLanguage: tag };
        }
    }
    return { translation: 'en', documentLanguage: 'en' };
}

function toTranslationCode(tag: string): string | null {
    const [language, ...subtags] = tag.trim().toLowerCase().split(/[-_]/);
    if (language === 'zh') {
        return subtags.some((subtag) => TRADITIONAL_CHINESE_SUBTAGS.has(subtag))
            ? 'zhtw'
            : 'zh';
    }
    if (language === 'ar' && subtags.includes('ma')) {
        return 'ary';
    }
    if (language === 'be') {
        return 'by';
    }
    return TRANSLATED_LANGUAGES.has(language) ? language : null;
}
