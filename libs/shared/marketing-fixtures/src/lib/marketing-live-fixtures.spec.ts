import {
    MARKETING_LIVE_CATEGORIES,
    MARKETING_LIVE_CHANNELS,
    marketingSlug,
    marketingTitleFromSlug,
    renderMarketingLogoSvg,
} from './marketing-live-fixtures';

describe('marketing live fixtures', () => {
    it('places every channel in a declared category with a schedule', () => {
        const keys = new Set(MARKETING_LIVE_CATEGORIES.map((c) => c.key));

        for (const channel of MARKETING_LIVE_CHANNELS) {
            expect(keys.has(channel.categoryKey)).toBe(true);
            expect(channel.epgTitles.length).toBeGreaterThan(0);
        }
        expect(new Set(MARKETING_LIVE_CHANNELS.map((c) => c.name)).size).toBe(
            MARKETING_LIVE_CHANNELS.length
        );
    });

    it('round-trips a channel name through the slug used in asset URLs', () => {
        expect(marketingSlug('Aurora News')).toBe('aurora-news');
        expect(marketingTitleFromSlug('aurora-news.svg')).toBe('Aurora News');
    });

    it.each([
        ['...Aurora / News!!!', 'aurora-news'],
        ['---Aurora___News---', 'aurora-news'],
        ['A1 + B2', 'a1-b2'],
        ['', ''],
        [' !?---___ ', ''],
        ['-'.repeat(100_000), ''],
        [`${'!'.repeat(100_000)}Aurora${'?'.repeat(100_000)}`, 'aurora'],
    ])('normalizes punctuation and separators in slug case %#', (value, slug) => {
        expect(marketingSlug(value)).toBe(slug);
    });

    it('renders a self-contained SVG logo with the channel initials', () => {
        const svg = renderMarketingLogoSvg('aurora-news.svg', '128x128');

        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
            true
        );
        expect(svg).toContain('width="128"');
        expect(svg).toContain('>AN</text>');
        expect(svg).not.toContain('http://localhost');
    });

    it('escapes markup that leaks into a slug', () => {
        expect(renderMarketingLogoSvg('<b>x', undefined)).not.toContain('<b>');
    });
});
