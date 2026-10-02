import {
    VIDSTACK_LAYOUT_THEME_HREF,
    loadVidstackLayoutTheme,
} from './vidstack-layout-theme';

describe('loadVidstackLayoutTheme', () => {
    function themeLinks(doc: Document): HTMLLinkElement[] {
        return Array.from(
            doc.head.querySelectorAll<HTMLLinkElement>(
                'link[data-vidstack-theme]'
            )
        );
    }

    it('adds the theme stylesheet once per document and resolves on load', async () => {
        const doc = document.implementation.createHTMLDocument('player');
        let loaded = false;

        const first = loadVidstackLayoutTheme(doc).then(() => {
            loaded = true;
        });
        const second = loadVidstackLayoutTheme(doc);
        await Promise.resolve();

        const links = themeLinks(doc);
        expect(links).toHaveLength(1);
        expect(links[0].rel).toBe('stylesheet');
        expect(links[0].getAttribute('href')).toBe(VIDSTACK_LAYOUT_THEME_HREF);
        expect(loaded).toBe(false);

        links[0].dispatchEvent(new Event('load'));
        await first;
        await expect(second).resolves.toBeUndefined();
        expect(loaded).toBe(true);
    });

    it('resolves when the stylesheet fails so the layout is never stuck hidden', async () => {
        const doc = document.implementation.createHTMLDocument('player');

        const pending = loadVidstackLayoutTheme(doc);
        themeLinks(doc)[0].dispatchEvent(new Event('error'));

        await expect(pending).resolves.toBeUndefined();
    });

    it('retries a failed stylesheet on the next load', async () => {
        const doc = document.implementation.createHTMLDocument('player');
        const failed = loadVidstackLayoutTheme(doc);
        themeLinks(doc)[0].dispatchEvent(new Event('error'));
        await failed;
        expect(themeLinks(doc)).toHaveLength(0);

        const retry = loadVidstackLayoutTheme(doc);

        expect(retry).not.toBe(failed);
        expect(themeLinks(doc)).toHaveLength(1);
        themeLinks(doc)[0].dispatchEvent(new Event('load'));
        await expect(retry).resolves.toBeUndefined();
        expect(loadVidstackLayoutTheme(doc)).toBe(retry);
    });
});
