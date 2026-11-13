import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Component SCSS is not applied in jsdom, so the gutter is pinned at the
// source: the scroll container clips the cards' focus ring and hover lift
// unless it pads the grid the way the portal grids do.
describe('M3U catalog grid gutter', () => {
    const source = readFileSync(
        resolve(
            process.cwd(),
            'libs/playlist/m3u/feature-player/src/lib/m3u-catalog/m3u-catalog-route.component.scss'
        ),
        'utf8'
    );
    const narrowStart = source.indexOf('@media (max-width: 720px)');
    const contentRule = (css: string): string =>
        css.match(/\.catalog__content\s*\{([^}]*)\}/)?.[1] ?? '';

    it('pads the scrolling content pane like the portal grids', () => {
        const rule = contentRule(source.slice(0, narrowStart));

        expect(rule).toMatch(/overflow-y:\s*auto;/);
        expect(rule).toMatch(/padding:\s*16px 20px 20px;/);
        expect(rule).toMatch(/box-sizing:\s*border-box;/);
    });

    it('keeps a tighter gutter on narrow viewports', () => {
        expect(narrowStart).toBeGreaterThan(-1);
        expect(contentRule(source.slice(narrowStart))).toMatch(
            /padding:\s*12px 16px 16px;/
        );
    });
});
