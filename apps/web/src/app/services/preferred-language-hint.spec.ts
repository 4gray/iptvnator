import {
    normalizePreferredLanguage,
    PREFERRED_LANGUAGE_STORAGE_KEY,
    readPreferredLanguageHint,
    writePreferredLanguageHint,
} from './preferred-language-hint';

describe('preferred language startup hint', () => {
    afterEach(() => {
        localStorage.removeItem(PREFERRED_LANGUAGE_STORAGE_KEY);
        jest.restoreAllMocks();
    });

    it('normalizes supported languages defensively', () => {
        expect(normalizePreferredLanguage(' EN ')).toBe('en');
        expect(normalizePreferredLanguage('it')).toBe('it');
        expect(normalizePreferredLanguage('unsupported')).toBeNull();
    });

    it('persists and reads the cold-start language hint', () => {
        writePreferredLanguageHint('EN');

        expect(localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY)).toBe('en');
        expect(readPreferredLanguageHint()).toBe('en');
    });

    it('ignores unsupported language hints', () => {
        localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, 'xx');

        expect(readPreferredLanguageHint()).toBeNull();
    });
});
