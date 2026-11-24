import { THEME_ACCENTS } from '@iptvnator/shared/interfaces';

/** The colours a profile can pick: the theme accents, as the server wants `#rrggbb`. */
export const PROFILE_SWATCHES: readonly string[] = THEME_ACCENTS.map(
    (accent) => accent.hex
);

interface GraphemeSegmenter {
    segment(value: string): Iterable<{ segment: string }>;
}

// `Intl.Segmenter` is newer than this project's lib setting.
const SegmenterCtor = (
    Intl as unknown as {
        Segmenter?: new (
            locale: undefined,
            options: { granularity: 'grapheme' }
        ) => GraphemeSegmenter;
    }
).Segmenter;
const segmenter = SegmenterCtor
    ? new SegmenterCtor(undefined, { granularity: 'grapheme' })
    : null;

function graphemes(value: string): string[] {
    return segmenter
        ? Array.from(segmenter.segment(value), (part) => part.segment)
        : Array.from(value);
}

/** The first letter (grapheme) of a name, upper-cased, for a tile without an emoji. */
export function profileInitial(name: string): string {
    return (graphemes(name.trim())[0] ?? '?').toLocaleUpperCase();
}

/**
 * A light client-side check: one grapheme that contains an emoji. The server
 * validates the same rule and stays the authority.
 */
export function isSingleEmoji(value: string): boolean {
    const parts = graphemes(value);
    return parts.length === 1 && /\p{Extended_Pictographic}/u.test(value);
}

function channel(value: number): number {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) return 0;
    const [r, g, b] = [match[1], match[2], match[3]].map((part) =>
        channel(parseInt(part, 16))
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Black or white, whichever has the higher contrast on `colour`. Never
 * under 4.5:1: the two ratios multiply to at least (1.05 / 0.05) ^ 0.5 > 4.5.
 */
export function readableTextColour(colour: string): '#000000' | '#ffffff' {
    const light = luminance(colour);
    return (light + 0.05) / 0.05 > 1.05 / (light + 0.05)
        ? '#000000'
        : '#ffffff';
}
