import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_ACCENTS, THEME_PRESETS } from '@iptvnator/shared/interfaces';
import {
    contrastRatio,
    deriveThemeAccentTokens,
    readThemeAccentSurfaces,
    THEME_ACCENT_SURFACE_TOKENS,
    ThemeAccentSurfaces,
} from './theme-accent-tokens';

// The real preset surfaces, read from the palettes the app ships, so a
// palette change re-runs every contrast check below.
const PALETTES = readFileSync(
    resolve(process.cwd(), 'apps/web/src/_theme-palettes.scss'),
    'utf8'
);

function presetSurfaces(id: string): ThemeAccentSurfaces {
    const block = PALETTES.split(/^@mixin /m).find((part) =>
        part.startsWith(`${id}(`)
    );
    if (!block) throw new Error(`No palette mixin for ${id}`);
    const style = {
        getPropertyValue: (token: string) =>
            block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1] ??
            '',
    };
    const surfaces = readThemeAccentSurfaces(style);
    if (!surfaces) throw new Error(`No surfaces for ${id}`);
    return surfaces;
}

const mixHex = (base: string, top: string, amount: number) => {
    const channel = (hex: string, i: number) =>
        parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    return (
        '#' +
        [0, 1, 2]
            .map((i) =>
                Math.round(
                    channel(base, i) +
                        (channel(top, i) - channel(base, i)) * amount
                )
                    .toString(16)
                    .padStart(2, '0')
            )
            .join('')
    );
};

describe('theme accent tokens', () => {
    it('reads every surface token of each preset palette', () => {
        for (const preset of THEME_PRESETS) {
            expect(presetSurfaces(preset.id).all).toHaveLength(
                THEME_ACCENT_SURFACE_TOKENS.length
            );
        }
    });

    describe.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode]))(
        '%s preset',
        (id, mode) => {
            const surfaces = presetSurfaces(id);

            it.each(THEME_ACCENTS.map((accent) => [accent.id, accent.hex]))(
                'keeps %s readable on every surface',
                (_accent, hex) => {
                    const tokens = deriveThemeAccentTokens(hex, surfaces);
                    const selection = tokens['--app-selection-color']!;
                    const text = tokens['--app-selection-text-color']!;
                    const strongTint = mode === 'dark' ? 0.28 : 0.22;

                    for (const surface of surfaces.all) {
                        expect(
                            contrastRatio(selection, surface)
                        ).toBeGreaterThanOrEqual(mode === 'dark' ? 4.5 : 3);
                        expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(
                            4.5
                        );
                        expect(
                            contrastRatio(
                                text,
                                mixHex(surface, selection, strongTint)
                            )
                        ).toBeGreaterThanOrEqual(4.5);
                    }
                    expect(
                        contrastRatio(
                            tokens['--app-selection-on-color']!,
                            selection
                        )
                    ).toBeGreaterThanOrEqual(mode === 'dark' ? 4.5 : 3);
                    expect(
                        contrastRatio(tokens['--mat-sys-on-primary']!, text)
                    ).toBeGreaterThanOrEqual(4.5);
                    expect(
                        contrastRatio(
                            tokens['--mat-sys-on-primary-container']!,
                            tokens['--mat-sys-primary-container']!
                        )
                    ).toBeGreaterThanOrEqual(4.5);
                }
            );
        }
    );

    it('keeps the selected-row foreground of light presets', () => {
        const light = deriveThemeAccentTokens('#3b82f6', presetSurfaces('light'));
        const dark = deriveThemeAccentTokens('#3b82f6', presetSurfaces('dark'));

        expect(light['--app-list-selected-fg']).toBeUndefined();
        expect(dark['--app-list-selected-fg']).toBe(
            dark['--app-selection-text-color']
        );
    });

    it('leaves an accent that already has the contrast unchanged', () => {
        // Amber is far brighter than the dark preset's widget surface.
        const tokens = deriveThemeAccentTokens('#f59e0b', presetSurfaces('dark'));
        expect(tokens['--app-selection-color']).toBe('#f59e0b');
    });

    it('returns null when the theme styles are not loaded', () => {
        expect(
            readThemeAccentSurfaces({ getPropertyValue: () => '' })
        ).toBeNull();
    });
});
