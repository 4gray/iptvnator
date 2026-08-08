import { sanitizeProviderOverview } from './provider-overview.util';

describe('sanitizeProviderOverview', () => {
    it('keeps real description text', () => {
        expect(sanitizeProviderOverview('A tense hijack drama.')).toBe(
            'A tense hijack drama.'
        );
    });

    it('trims surrounding whitespace', () => {
        expect(sanitizeProviderOverview('  Season text  ')).toBe('Season text');
    });

    it('returns null for empty and missing values', () => {
        expect(sanitizeProviderOverview('')).toBeNull();
        expect(sanitizeProviderOverview('   ')).toBeNull();
        expect(sanitizeProviderOverview(null)).toBeNull();
        expect(sanitizeProviderOverview(undefined)).toBeNull();
    });

    it('drops a bare http image URL', () => {
        expect(
            sanitizeProviderOverview(
                'http://line.example.net:80/images/series/cover_small.jpg'
            )
        ).toBeNull();
    });

    it('drops a bare https URL with a query string', () => {
        expect(
            sanitizeProviderOverview('https://cdn.example.com/p.jpg?w=300')
        ).toBeNull();
    });

    it('drops a bare URL padded with whitespace', () => {
        expect(
            sanitizeProviderOverview('  http://cdn.example.com/cover.png  ')
        ).toBeNull();
    });

    it('drops a protocol-relative URL', () => {
        expect(
            sanitizeProviderOverview('//cdn.example.com/cover.jpg')
        ).toBeNull();
    });

    it('keeps prose that merely contains a URL', () => {
        const text = 'More info at http://example.com/season1';
        expect(sanitizeProviderOverview(text)).toBe(text);
    });
});
