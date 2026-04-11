import { formatWithIntl, normalizeDateLocale } from './date-format.util';

describe('date-format.util', () => {
    it('normalizes app locale aliases to Angular/Intl locale ids', () => {
        expect(normalizeDateLocale('ary')).toBe('ar-MA');
        expect(normalizeDateLocale('by')).toBe('be');
        expect(normalizeDateLocale('zhtw')).toBe('zh-Hant');
        expect(normalizeDateLocale('de')).toBe('de');
        expect(normalizeDateLocale()).toBe('en');
    });

    it('formats dates with cached Intl formatters', () => {
        expect(
            formatWithIntl('2026-04-05T12:30:00.000Z', {
                locale: 'de',
                timeZone: 'UTC',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            })
        ).toContain('12:30');
    });
});
