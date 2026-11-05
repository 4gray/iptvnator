import { Language, normalizeAppLanguage } from '@iptvnator/shared/interfaces';

export const PREFERRED_LANGUAGE_STORAGE_KEY = 'iptvnator:preferred-language';

/** Read the saved hint before IndexedDB settings are available. */
export function getInitialLanguage(): Language {
    try {
        return normalizeAppLanguage(
            localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)
        );
    } catch {
        return Language.ENGLISH;
    }
}

/** Mirror saved UI choices for the next cold start, including legacy aliases. */
export function rememberLanguage(language: Language): void {
    try {
        localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, language);
    } catch {
        // Quota and privacy modes must not prevent a language switch.
    }
}
