import { Language } from '@iptvnator/shared/interfaces';
import {
    getInitialLanguage,
    PREFERRED_LANGUAGE_STORAGE_KEY,
    rememberLanguage,
} from './app-language-preference';

describe('cold-start language preference', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.removeItem(PREFERRED_LANGUAGE_STORAGE_KEY);
    });

    it('normalizes the legacy Portuguese hint before loading a catalogue', () => {
        localStorage.setItem(PREFERRED_LANGUAGE_STORAGE_KEY, 'pt');
        expect(getInitialLanguage()).toBe(Language.PORTUGUESE_BRAZIL);
    });

    it('preserves Portugal on the next cold start', () => {
        rememberLanguage(Language.PORTUGUESE_PORTUGAL);
        expect(getInitialLanguage()).toBe(Language.PORTUGUESE_PORTUGAL);
    });

    it('defaults to English when there is no hint', () => {
        expect(getInitialLanguage()).toBe(Language.ENGLISH);
    });

    it('defaults to English when browser storage cannot be read', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('Storage disabled');
        });
        expect(getInitialLanguage()).toBe(Language.ENGLISH);
    });

    it('does not prevent a language switch when browser storage is full', () => {
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Quota exceeded');
        });
        expect(() =>
            rememberLanguage(Language.PORTUGUESE_BRAZIL)
        ).not.toThrow();
    });
});
