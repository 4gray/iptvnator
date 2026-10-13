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

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((start) => {
        const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
        return channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/** `top` at `percent`% over an opaque `base`, as color-mix(in srgb) does. */
function mix(top: string, percent: number, base: string): string {
    return `#${[1, 3, 5]
        .map((start) => {
            const over = parseInt(top.slice(start, start + 2), 16);
            const under = parseInt(base.slice(start, start + 2), 16);
            return Math.round((over * percent + under * (100 - percent)) / 100)
                .toString(16)
                .padStart(2, '0');
        })
        .join('')}`;
}

function hexToken(context: string, name: string): string {
    const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(
        context
    )?.[1];
    expect(value).toBeDefined();
    return (value ?? '').toLowerCase();
}

describe('m3-theme focus ring token', () => {
    // The ring sits 2px outside the focused element, on whatever the element
    // sits on: an app surface, or one tinted by the selection colour.
    const surfaces = [
        '--app-shell-bg',
        '--app-rail-bg',
        '--app-header-bg',
        '--app-content-bg',
        '--app-widget-bg',
        '--app-widget-header-bg',
        '--app-card-hover-bg',
    ];

    it('declares a ring with at least 3:1 on every surface in both themes', () => {
        const { light, dark } = themeContexts();

        for (const [theme, context] of Object.entries({ light, dark })) {
            const ring = hexToken(context, '--app-focus-ring');
            const selection = hexToken(context, '--app-selection-color');
            const strongTint = Number(
                /--app-selection-surface-strong:\s*color-mix\(\s*in srgb,\s*var\(--app-selection-color\)\s*(\d+)%/.exec(
                    context
                )?.[1]
            );
            expect(strongTint).toBeGreaterThan(0);

            for (const surface of surfaces) {
                const base = hexToken(context, surface);
                for (const background of [
                    base,
                    mix(selection, strongTint, base),
                ]) {
                    expect({
                        theme,
                        surface,
                        background,
                        ratio: contrast(ring, background) >= 3,
                    }).toEqual({ theme, surface, background, ratio: true });
                }
            }
        }
    });
});
