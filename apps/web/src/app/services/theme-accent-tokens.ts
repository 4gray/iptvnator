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

// The strongest selection tint the palettes draw (`--app-selection-surface-
// strong`): text in the accent must stay readable on it.
const STRONG_TINT = { dark: 0.28, light: 0.22 };
// Dark presets also use the selection colour itself as text in selected
// rows, so it needs text contrast there; light presets only draw with it.
const SELECTION_MIN = { dark: 4.5, light: 3 };
const TEXT_MIN = 4.5;
// Head-room for the 8-bit rounding of the browser's own colour-mix().
const MARGIN = 0.05;

export function deriveThemeAccentTokens(
    accentHex: string,
    surfaces: ThemeAccentSurfaces
): Partial<Record<(typeof THEME_ACCENT_TOKEN_NAMES)[number], string>> {
    const dark = luminance(parseHex(surfaces.widget)) < 0.2;
    const mode = dark ? 'dark' : 'light';
    const all = surfaces.all.map(parseHex);

    const selection = fitLightness(
        parseHex(accentHex),
        dark,
        (color) => minContrast(color, all) >= SELECTION_MIN[mode] + MARGIN
    );
    const tints = all.map((surface) =>
        mix(surface, selection, STRONG_TINT[mode])
    );
    const text = fitLightness(
        selection,
        dark,
        (color) => minContrast(color, [...all, ...tints]) >= TEXT_MIN + MARGIN
    );
    const container = mix(
        parseHex(surfaces.widget),
        selection,
        STRONG_TINT[mode]
    );

    return {
        '--app-selection-color': toHex(selection),
        '--app-selection-text-color': toHex(text),
        '--app-selection-on-color': toHex(onColor(selection)),
        '--app-focus-ring': toHex(text),
        // Light presets set selected rows in the heading colour already.
        ...(dark ? { '--app-list-selected-fg': toHex(text) } : {}),
        '--mat-sys-primary': toHex(text),
        '--mat-sys-on-primary': toHex(onColor(text)),
        '--mat-sys-primary-container': toHex(container),
        '--mat-sys-on-primary-container': toHex(text),
    };
}

/** Reads the active theme's surfaces; `null` when its styles are missing. */
export function readThemeAccentSurfaces(
    style: Pick<CSSStyleDeclaration, 'getPropertyValue'>
): ThemeAccentSurfaces | null {
    const values = THEME_ACCENT_SURFACE_TOKENS.map((token) =>
        style.getPropertyValue(token).trim()
    );
    const all = values.filter((value) => HEX.test(value));
    const widget = values[0];
    return HEX.test(widget) ? { widget, all } : null;
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

/** The readable foreground for a solid fill in the accent's own hue. */
function onColor(fill: Rgb): Rgb {
    const [, chroma, hue] = toOklch(fill);
    const light = fromOklch(0.985, Math.min(chroma, 0.02), hue);
    const deep = fromOklch(0.2, Math.min(chroma, 0.05), hue);
    return contrast(light, fill) >= contrast(deep, fill) ? light : deep;
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
