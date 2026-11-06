import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { THEME_PRESETS } from '@iptvnator/shared/interfaces';

// A custom property that reads another one is resolved where it is declared,
// so a token derived from a per-theme colour has to be declared again inside
// `.dark-theme`; inherited from `html`, it would keep the light value there.
const THEME = readFileSync(
    resolve(process.cwd(), 'apps/web/src/m3-theme.scss'),
    'utf8'
)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

// Resolve the compiler from the Angular builder that already owns its version.
const { compileString } = createRequire(
    resolve(process.cwd(), 'node_modules/@angular/build/package.json')
)('sass') as {
    compileString(
        source: string,
        options: { url: URL; loadPaths: string[]; quietDeps: boolean }
    ): { css: string };
};
const compiledThemes = new Map<string, string>();

/** Read actual emitted roles from the mode boundary and preset overrides. */
function themeContexts(preview = false, theme = THEME): Record<string, string> {
    let css = compiledThemes.get(theme);
    if (!css) {
        css = compileString(theme, {
            url: pathToFileURL(
                resolve(process.cwd(), 'apps/web/src/m3-theme.scss')
            ),
            loadPaths: [resolve(process.cwd(), 'node_modules')],
            quietDeps: true,
        }).css.replace(/\/\*[\s\S]*?\*\//g, '');
        compiledThemes.set(theme, css);
    }
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const declarations = (...selectors: string[]) =>
        rules
            .filter(([, ruleSelectors]) =>
                ruleSelectors
                    .split(',')
                    .some((value) => selectors.includes(value.trim()))
            )
            .flatMap(
                ([, , body]) => body.match(/--app-[\w-]+:\s*[^;]+;/g) ?? []
            )
            .join('\n');

    return Object.fromEntries(
        THEME_PRESETS.map(({ id, mode }) => [
            id,
            preview
                ? declarations(`html [data-theme-preview=${id}]`)
                : declarations(
                      mode === 'dark' ? 'html .dark-theme' : 'html',
                      `html [data-app-theme=${id}]`
                  ),
        ])
    );
}

describe('theme context extraction', () => {
    it('does not invent shared dark roles when the mode stops supplying them', () => {
        const contexts = themeContexts(
            false,
            THEME.replace('@include palettes.dark;', '')
        );
        for (const name of ['dark', 'mocha', 'night-owl', 'black-oled']) {
            expect(contexts[name]).not.toContain('--app-progress-color:');
            expect(contexts[name]).not.toContain('--app-success-color:');
        }
    });
});

describe('m3-theme watch-progress token', () => {
    it('declares --app-progress-color from the selection colour in every preset', () => {
        const contexts = themeContexts();
        const { light, dark } = contexts;
        const progress =
            /--app-progress-color:\s*var\(--app-selection-color\);/;
        const selection = /--app-selection-color:\s*#[0-9a-f]{6};/i;

        for (const context of Object.values(contexts)) {
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
    const value = [
        ...context.matchAll(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'gi')),
    ].at(-1)?.[1];
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

    it('declares a ring with at least 3:1 on every surface in every preset', () => {
        const contexts = themeContexts();

        for (const [theme, context] of Object.entries(contexts)) {
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

describe('theme preset text palettes', () => {
    it('limits decorative previews to the seven actual app colors they draw', () => {
        const contexts = themeContexts();
        for (const [name, preview] of Object.entries(themeContexts(true))) {
            const tokens = new Map(
                [
                    ...preview.matchAll(/(--app-[\w-]+):\s*(#[0-9a-f]{6});/gi),
                ].map((match) => [match[1], match[2]])
            );
            expect(tokens.size).toBe(7);
            for (const [token, value] of tokens) {
                expect(value).toBe(hexToken(contexts[name], token));
            }
            expect(preview).not.toContain('var(');
        }
    });

    it('keeps new dark preset text readable over the strongest composited selection tint', () => {
        for (const [name, context] of Object.entries(themeContexts()).filter(
            ([name]) => name === 'night-owl' || name === 'black-oled'
        )) {
            const selection = hexToken(context, '--app-selection-color');
            const text = hexToken(context, '--app-selection-text-color');
            const tint = 28;
            for (const surface of [
                '--app-content-bg',
                '--app-widget-bg',
                '--app-card-hover-bg',
            ]) {
                expect({
                    name,
                    surface,
                    readable:
                        contrast(
                            text,
                            mix(selection, tint, hexToken(context, surface))
                        ) >= 4.5,
                }).toEqual({ name, surface, readable: true });
            }
        }
    });
    it('keeps normal text readable on every app surface', () => {
        for (const [name, context] of Object.entries(themeContexts())) {
            for (const surface of [
                '--app-content-bg',
                '--app-widget-bg',
                '--app-widget-header-bg',
                '--app-card-hover-bg',
            ]) {
                for (const text of [
                    '--app-heading-color',
                    '--app-body-color',
                    '--app-muted-color',
                ]) {
                    expect({
                        name,
                        surface,
                        text,
                        readable:
                            contrast(
                                hexToken(context, text),
                                hexToken(context, surface)
                            ) >= 4.5,
                    }).toEqual({ name, surface, text, readable: true });
                }
            }
        }
    });

    it('preserves the existing four presets’ surface and selection colors', () => {
        const contexts = themeContexts();
        expect(
            [
                '--app-shell-bg',
                '--app-content-bg',
                '--app-widget-bg',
                '--app-selection-color',
            ].map((name) => hexToken(contexts['light'], name))
        ).toEqual(['#eef0f3', '#f5f6f8', '#ffffff', '#2f7bff']);
        expect(
            [
                '--app-shell-bg',
                '--app-content-bg',
                '--app-widget-bg',
                '--app-selection-color',
            ].map((name) => hexToken(contexts['dark'], name))
        ).toEqual(['#0d0f12', '#161a22', '#1e2330', '#78adff']);
        for (const [name, colors] of [
            ['cream', ['#e9e1d4', '#f3eee4', '#fcf8f0', '#8a5a3b']],
            ['mocha', ['#171310', '#251f1b', '#302823', '#d5ad89']],
        ] as const) {
            expect(
                [
                    '--app-shell-bg',
                    '--app-content-bg',
                    '--app-widget-bg',
                    '--app-selection-color',
                ].map((token) => hexToken(contexts[name], token))
            ).toEqual(colors);
        }
    });
});
