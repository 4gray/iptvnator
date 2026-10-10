import { Language } from '@iptvnator/shared/interfaces';

const TRANSLATED_LANGUAGES: ReadonlySet<string> = new Set(
    Object.values(Language)
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
    return { translation: Language.ENGLISH, documentLanguage: 'en' };
}

function toTranslationCode(tag: string): string | null {
    const [language, ...subtags] = tag.trim().toLowerCase().split(/[-_]/);
    if (language === 'zh') {
        return subtags.some((subtag) => TRADITIONAL_CHINESE_SUBTAGS.has(subtag))
            ? Language.TRADITIONAL_CHINESE
            : Language.CHINESE;
    }
    if (language === 'ar' && subtags.includes('ma')) {
        return Language.MOROCCAN_ARABIC;
    }
    if (language === 'be') {
        return Language.BELARUSIAN;
    }
    return TRANSLATED_LANGUAGES.has(language) ? language : null;
}
