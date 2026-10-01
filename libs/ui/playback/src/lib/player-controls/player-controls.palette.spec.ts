import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The overlay sits on video in both app themes, so its colours come from the
// fixed `--pc-*` palette. A theme token read here stays invisible only while
// the theme leaves it undeclared; once declared, the overlay follows the theme.
const CONTROLS_DIR = resolve(
    process.cwd(),
    'libs/ui/playback/src/lib/player-controls'
);

// Comments are dropped so prose that names a token can neither trip nor
// satisfy the checks below. A `//` counts only after whitespace, which keeps
// the `://` of a URL intact.
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const STYLE_SOURCES = new Map(
    readdirSync(CONTROLS_DIR)
        .filter((file) => file.endsWith('.scss'))
        .map((file) => [
            file,
            stripComments(readFileSync(resolve(CONTROLS_DIR, file), 'utf8')),
        ])
);

const HOST_STYLES = STYLE_SOURCES.get('player-controls.component.scss') ?? '';
const TIMELINE_STYLES =
    STYLE_SOURCES.get('player-timeline.component.scss') ?? '';
const SETTINGS_STYLES =
    STYLE_SOURCES.get('player-settings-panel.component.scss') ?? '';

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

/** A translucent palette colour composited over an opaque frame. */
function over(color: { rgb: Rgb; alpha: number }, frame: Rgb): Rgb {
    return color.rgb.map(
        (channel, index) =>
            channel * color.alpha + frame[index] * (1 - color.alpha)
    ) as Rgb;
}

/** The declarations of the first rule whose selector list is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
        source.match(
            new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`)
        )?.[1] ?? ''
    );
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
        expect(
            stripComments('// names --mat-sys-error\n/* and --mat-sys-x */')
        ).not.toContain('--mat-sys-');
        expect(stripComments("url('https://example.com/a.svg')")).toBe(
            "url('https://example.com/a.svg')"
        );
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
            /\.player-controls__record-button--active:not\(\[disabled\]\),\s*\.player-controls__record-button--active:not\(\[disabled\]\) mat-icon\s*\{[^}]*color:\s*var\(--pc-danger\)/
        );
    });

    it('lets a disabled record button keep its muted colour while recording', () => {
        // The red is `!important`, so an unscoped rule would also beat the
        // disabled icon colour: a recording that reconnects (loading, so the
        // button is disabled) would show a red glyph that cannot be clicked.
        const activeRecordSelectors = [
            ...HOST_STYLES.matchAll(/([^{}]*)\{[^}]*var\(--pc-danger\)/g),
        ].flatMap(([, selectors]) =>
            selectors
                .split(',')
                .map((selector) => selector.trim())
                .filter((selector) =>
                    selector.includes('player-controls__record-button--active')
                )
        );

        expect(activeRecordSelectors).toEqual([
            '.player-controls__record-button--active:not([disabled])',
            '.player-controls__record-button--active:not([disabled]) mat-icon',
        ]);
        expect(HOST_STYLES).toMatch(
            /:host :is\(button\[mat-icon-button\]\[disabled\]\) mat-icon\s*\{[^}]*color:\s*var\(--pc-text-tertiary\);/
        );
    });

    it('keeps the settings headings at 4.5:1 on the panel glass over bright frames', () => {
        const midGrey: Rgb = [128, 128, 128];
        const white: Rgb = [255, 255, 255];
        const glass = paletteColor('--pc-glass-bg-dense');
        const secondary = paletteColor('--pc-text-secondary').rgb;

        expect(ruleBody(SETTINGS_STYLES, ':host')).toMatch(
            /background:\s*var\(--pc-glass-bg-dense\b/
        );
        expect(
            ruleBody(
                SETTINGS_STYLES,
                '.player-settings__heading,\n.player-settings__subheading'
            )
        ).toMatch(/color:\s*var\(--pc-text-secondary\b/);
        expect(SETTINGS_STYLES).not.toMatch(
            /__(sub)?heading\s*\{[^}]*--pc-text-tertiary/
        );
        for (const frame of [midGrey, white]) {
            expect(
                contrastRatio(secondary, over(glass, frame))
            ).toBeGreaterThanOrEqual(4.5);
        }
        // The tertiary step the headings used to read failed on mid-grey.
        expect(
            contrastRatio(
                paletteColor('--pc-text-tertiary').rgb,
                over(paletteColor('--pc-glass-bg'), midGrey)
            )
        ).toBeLessThan(4.5);
    });

    it('draws keyboard focus on icon buttons in the overlay text colour', () => {
        const ring = /outline:\s*2px solid var\(--pc-text[,)]/;
        for (const source of [HOST_STYLES, SETTINGS_STYLES]) {
            expect(
                ruleBody(
                    source,
                    ':host :is(button[mat-icon-button]:focus-visible)'
                )
            ).toMatch(ring);
            // Material's focus layer takes the app theme's colour.
            expect(
                ruleBody(source, ':host :is(button[mat-icon-button])')
            ).toMatch(/--mat-icon-button-focus-state-layer-opacity:\s*0;/);
        }
    });

    it('tells a focused selected swatch from one that is only selected', () => {
        const selected = ruleBody(
            SETTINGS_STYLES,
            '.player-settings__swatch--selected'
        );
        const focused = ruleBody(
            SETTINGS_STYLES,
            '.player-settings__swatch:focus-visible'
        );
        expect(selected).not.toMatch(/outline/);
        expect(focused).toMatch(/outline:\s*2px solid var\(--pc-text[,)]/);
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
