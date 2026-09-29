import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The overlay sits on video in both app themes, so its colours come from the
// fixed `--pc-*` palette. A theme token read here stays invisible only while
// the theme leaves it undeclared; once declared, the overlay follows the theme.
const CONTROLS_DIR = resolve(
    process.cwd(),
    'libs/ui/playback/src/lib/player-controls'
);

const STYLE_SOURCES = new Map(
    readdirSync(CONTROLS_DIR)
        .filter((file) => file.endsWith('.scss'))
        .map((file) => [
            file,
            readFileSync(resolve(CONTROLS_DIR, file), 'utf8'),
        ])
);

const HOST_STYLES = STYLE_SOURCES.get('player-controls.component.scss') ?? '';
const TIMELINE_STYLES =
    STYLE_SOURCES.get('player-timeline.component.scss') ?? '';

type Rgb = [number, number, number];

function paletteColor(token: string): { rgb: Rgb; alpha: number } {
    const value =
        HOST_STYLES.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim() ??
        '';
    const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
    if (hex) {
        const rgb = [0, 2, 4].map((offset) =>
            Number.parseInt(hex.slice(offset, offset + 2), 16)
        ) as Rgb;
        return { rgb, alpha: 1 };
    }
    const rgba = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    if (rgba) {
        const rgb = rgba.slice(1, 4).map(Number) as Rgb;
        return { rgb, alpha: Number(rgba[4]) };
    }
    throw new Error(`${token} is not a literal palette colour: "${value}"`);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
    const luminance = (rgb: Rgb): number => {
        const [red, green, blue] = rgb.map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const values = [luminance(foreground), luminance(background)].sort(
        (left, right) => right - left
    );
    return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('player controls overlay palette', () => {
    it('never reads the app theme system tokens', () => {
        expect([...STYLE_SOURCES.keys()]).toEqual(
            expect.arrayContaining([
                'player-controls.component.scss',
                'player-timeline.component.scss',
            ])
        );
        const offenders = [...STYLE_SOURCES]
            .filter(([, source]) => source.includes('--mat-sys-'))
            .map(([file]) => file);

        expect(offenders).toEqual([]);
    });

    it('draws the LIVE badge and the recording reds from the palette', () => {
        expect(TIMELINE_STYLES).toMatch(
            /\.player-controls__live-badge\s*\{[^}]*background:\s*var\(--pc-live\);/
        );
        expect(TIMELINE_STYLES).toMatch(
            /\.player-controls__recording-status--active\s*\{[^}]*color:\s*var\(--pc-danger\);/
        );
        expect(TIMELINE_STYLES).toMatch(
            /\.player-controls__recording-status--active mat-icon\s*\{[^}]*color:\s*var\(--pc-danger\);/
        );
        // The icon-button rule colours the mat-icon itself, so a red set only
        // on the button never reaches the glyph.
        expect(HOST_STYLES).toMatch(
            /\.player-controls__record-button--active,\s*\.player-controls__record-button--active mat-icon\s*\{[^}]*color:\s*var\(--pc-danger\)/
        );
    });

    it('keeps the palette reds readable on video', () => {
        const white: Rgb = [255, 255, 255];
        const glass = paletteColor('--pc-glass-bg');
        const glassOnBlackFrame = glass.rgb.map(
            (channel) => channel * glass.alpha
        ) as Rgb;

        // The white LIVE label is small bold text: the 4.5:1 text floor.
        expect(
            contrastRatio(white, paletteColor('--pc-live').rgb)
        ).toBeGreaterThanOrEqual(4.5);
        // "REC 0:12" is text too, so it gets the text floor as well, not
        // just the 3:1 a glyph would need.
        expect(
            contrastRatio(paletteColor('--pc-danger').rgb, glassOnBlackFrame)
        ).toBeGreaterThanOrEqual(4.5);
    });
});
