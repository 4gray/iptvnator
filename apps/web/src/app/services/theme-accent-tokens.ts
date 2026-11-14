/**
 * Derives the selection and Material primary tokens for a user accent laid
 * over a theme preset. The accent keeps its hue; only its OKLCH lightness
 * moves until each role reaches its WCAG contrast against the theme's own
 * surfaces, so no accent can make a preset unreadable.
 */

type Rgb = readonly [number, number, number];

/** Surfaces of the active theme, read from its `--app-*` tokens. */
export interface ThemeAccentSurfaces {
    /** Card and widget background; Material containers are tinted over it. */
    readonly widget: string;
    /** Every surface the accent is drawn on, `widget` included. */
    readonly all: readonly string[];
    /** Heading ink; accent fills are pulled toward it for depth. */
    readonly heading: string;
}

/** Every token `deriveThemeAccentTokens()` can set, for clean removal. */
export const THEME_ACCENT_TOKEN_NAMES = [
    '--app-selection-color',
    '--app-selection-text-color',
    '--app-selection-on-color',
    '--app-focus-ring',
    '--app-list-selected-fg',
    '--mat-sys-primary',
    '--mat-sys-on-primary',
    '--mat-sys-primary-container',
    '--mat-sys-on-primary-container',
] as const;

export const THEME_ACCENT_SURFACE_TOKENS = [
    '--app-widget-bg',
    '--app-shell-bg',
    '--app-rail-bg',
    '--app-content-bg',
    '--app-card-hover-bg',
] as const;

// The palettes' selection tints. The accent itself is text on the plain one
// (`--app-selection-surface`, and 12% badges); `--app-selection-text-color`
// is the text role on the strongest (`--app-selection-surface-strong`).
const SOFT_TINT = { dark: 0.18, light: 0.14 };
const STRONG_TINT = { dark: 0.28, light: 0.22 };
// Solid accent fills that carry `--app-selection-on-color` or
// `--mat-sys-on-primary` text: the accent itself and the empty-state CTA
// gradient, which pulls it 20–40% toward the heading ink.
const FILL_HEADING_MIX = [0, 0.2, 0.4];
const TEXT_MIN = 4.5;
// Head-room for the 8-bit rounding of the browser's own colour-mix().
const MARGIN = 0.05;

/**
 * The accent is a text colour too (badges, selected labels) and a fill under
 * text, so it keeps 4.5:1 against every surface and its plain tint, and some
 * on-accent colour keeps 4.5:1 across every fill made from it. The text role
 * also keeps 4.5:1 on the strongest tint.
 */
export function deriveThemeAccentTokens(
    accentHex: string,
    surfaces: ThemeAccentSurfaces
): Partial<Record<(typeof THEME_ACCENT_TOKEN_NAMES)[number], string>> {
    const dark = luminance(parseHex(surfaces.widget)) < 0.2;
    const mode = dark ? 'dark' : 'light';
    const all = surfaces.all.map(parseHex);
    const heading = parseHex(surfaces.heading);
    const readableOn = (color: Rgb, tint: number) => {
        const tints = all.map((surface) => mix(surface, color, tint));
        return minContrast(color, [...all, ...tints]) >= TEXT_MIN + MARGIN;
    };
    const fills = (color: Rgb) =>
        FILL_HEADING_MIX.map((amount) => mix(color, heading, amount));

    const selection = fitLightness(
        parseHex(accentHex),
        dark,
        (color) =>
            readableOn(color, SOFT_TINT[mode]) &&
            onColor(color, fills(color)).contrast >= TEXT_MIN + MARGIN
    );
    const text = fitLightness(selection, dark, (color) =>
        readableOn(color, STRONG_TINT[mode])
    );
    // One foreground for every accent fill, `--mat-sys-primary` included.
    const on = onColor(selection, [...fills(selection), text]).color;
    const container = mix(
        parseHex(surfaces.widget),
        selection,
        STRONG_TINT[mode]
    );

    return {
        '--app-selection-color': toHex(selection),
        '--app-selection-text-color': toHex(text),
        '--app-selection-on-color': toHex(on),
        '--app-focus-ring': toHex(text),
        // Light presets set selected rows in the heading colour already.
        ...(dark ? { '--app-list-selected-fg': toHex(text) } : {}),
        '--mat-sys-primary': toHex(text),
        '--mat-sys-on-primary': toHex(on),
        '--mat-sys-primary-container': toHex(container),
        '--mat-sys-on-primary-container': toHex(text),
    };
}

/** Reads the active theme's surfaces; `null` when its styles are missing. */
export function readThemeAccentSurfaces(
    style: Pick<CSSStyleDeclaration, 'getPropertyValue'>
): ThemeAccentSurfaces | null {
    const read = (token: string) => style.getPropertyValue(token).trim();
    const values = THEME_ACCENT_SURFACE_TOKENS.map(read);
    const all = values.filter((value) => HEX.test(value));
    const [widget] = values;
    const heading = read('--app-heading-color');
    return HEX.test(widget) && HEX.test(heading)
        ? { widget, all, heading }
        : null;
}

export function contrastRatio(a: string, b: string): number {
    return contrast(parseHex(a), parseHex(b));
}

// ── colour maths ────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;

function parseHex(hex: string): Rgb {
    const value = hex.slice(1);
    return [0, 2, 4].map(
        (i) => parseInt(value.slice(i, i + 2), 16) / 255
    ) as unknown as Rgb;
}

function toHex(rgb: Rgb): string {
    return (
        '#' +
        rgb
            .map((v) =>
                Math.round(clamp(v) * 255)
                    .toString(16)
                    .padStart(2, '0')
            )
            .join('')
    );
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function luminance([r, g, b]: Rgb): number {
    return (
        0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
    );
}

function contrast(a: Rgb, b: Rgb): number {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const minContrast = (color: Rgb, others: readonly Rgb[]) =>
    Math.min(...others.map((other) => contrast(color, other)));

/** `color-mix(in srgb, …)`: interpolation of the gamma-encoded channels. */
function mix(base: Rgb, top: Rgb, amount: number): Rgb {
    return base.map((v, i) => v + (top[i] - v) * amount) as unknown as Rgb;
}

/**
 * The foreground with the best worst-case contrast across `fills`: a near
 * white or a deep tone in the accent's own hue.
 */
function onColor(
    accent: Rgb,
    fills: readonly Rgb[]
): { color: Rgb; contrast: number } {
    const [, chroma, hue] = toOklch(accent);
    const candidates = [
        fromOklch(0.985, Math.min(chroma, 0.02), hue),
        fromOklch(0.2, Math.min(chroma, 0.05), hue),
    ].map((color) => ({ color, contrast: minContrast(color, fills) }));
    return candidates[0].contrast >= candidates[1].contrast
        ? candidates[0]
        : candidates[1];
}

/**
 * Moves the lightness away from the background (up on dark themes, down on
 * light ones) until `passes`; keeps hue and chroma within the sRGB gamut.
 */
function fitLightness(
    color: Rgb,
    lighten: boolean,
    passes: (color: Rgb) => boolean
): Rgb {
    const [start, chroma, hue] = toOklch(color);
    let candidate = color;
    for (let step = 0; step <= 200 && !passes(candidate); step++) {
        const lightness = clamp(start + (lighten ? step : -step) * 0.005);
        candidate = fromOklch(lightness, chroma, hue);
    }
    return candidate;
}

function toOklch(rgb: Rgb): [number, number, number] {
    const [r, g, b] = rgb.map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [lightness, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function fromOklch(lightness: number, chroma: number, hue: number): Rgb {
    for (let c = chroma; ; c = Math.max(0, c - 0.004)) {
        const linear = oklabToLinear(
            lightness,
            c * Math.cos(hue),
            c * Math.sin(hue)
        );
        const inGamut = linear.every((v) => v >= -0.0005 && v <= 1.0005);
        if (inGamut || c === 0) {
            // Quantised as the hex token will be, so checks see that value.
            return linear.map(
                (v) => Math.round(toGamma(clamp(v)) * 255) / 255
            ) as unknown as Rgb;
        }
    }
}

function oklabToLinear(lightness: number, a: number, b: number): Rgb {
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
}
