import { Language, normalizeAppLanguage } from './language.enum';

describe('normalizeAppLanguage', () => {
    it.each([
        ['pt', Language.PORTUGUESE_BRAZIL],
        [' PT_br ', Language.PORTUGUESE_BRAZIL],
        ['pt-PT', Language.PORTUGUESE_PORTUGAL],
        ['pt_pt', Language.PORTUGUESE_PORTUGAL],
        ['de', Language.GERMAN],
        ['unsupported', Language.ENGLISH],
        [undefined, Language.ENGLISH],
    ])('normalizes saved language %p', (input, expected) => {
        expect(normalizeAppLanguage(input)).toBe(expected);
        expect(normalizeAppLanguage(expected)).toBe(expected);
    });
});
