import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A custom property that reads another one is resolved where it is declared,
// so a token derived from a per-theme colour has to be declared again inside
// `.dark-theme`; inherited from `html`, it would keep the light value there.
const THEME = readFileSync(
    resolve(process.cwd(), 'apps/web/src/m3-theme.scss'),
    'utf8'
)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

/** The body of the brace block that opens at `start` (an index of `{`). */
function block(source: string, start: number): string {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) {
            return source.slice(start + 1, index);
        }
    }
    throw new Error('Unbalanced braces in m3-theme.scss');
}

/** Light declarations (the `html` block minus `.dark-theme`) and dark ones. */
function themeContexts(): { light: string; dark: string } {
    const darkStart = THEME.indexOf('.dark-theme {');
    const htmlStart = THEME.lastIndexOf('html {', darkStart);
    expect(darkStart).toBeGreaterThan(-1);
    expect(htmlStart).toBeGreaterThan(-1);

    const html = block(THEME, THEME.indexOf('{', htmlStart));
    const dark = block(THEME, THEME.indexOf('{', darkStart));
    return { light: html.replace(dark, ''), dark };
}

describe('m3-theme watch-progress token', () => {
    it('declares --app-progress-color from the selection colour in both themes', () => {
        const { light, dark } = themeContexts();
        const progress =
            /--app-progress-color:\s*var\(--app-selection-color\);/;
        const selection = /--app-selection-color:\s*#[0-9a-f]{6};/i;

        for (const context of [light, dark]) {
            expect(context).toMatch(selection);
            expect(context).toMatch(progress);
        }
        expect(light.match(selection)?.[0]).not.toBe(
            dark.match(selection)?.[0]
        );
    });
});
