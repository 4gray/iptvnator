import { PROFILE_COLOURS } from '@iptvnator/shared/interfaces/profiles';

/** The colours a profile can pick, the same ones the server hands out to new profiles. */
export const PROFILE_SWATCHES = PROFILE_COLOURS;

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

const EMOJI_MAX_LENGTH = 32;
/** The server's pictograph rule: flags (regional indicators) and keycaps count. */
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

/**
 * A light client-side check, the same rule as the server's: one grapheme of
 * at most 32 code units that contains an emoji. The server stays the authority.
 */
export function isSingleEmoji(value: string): boolean {
    return (
        value.length <= EMOJI_MAX_LENGTH &&
        // Without Intl.Segmenter a flag or keycap cannot be counted as one
        // grapheme here; the server counts it.
        (!segmenter || graphemes(value).length === 1) &&
        PICTOGRAPH.test(value)
    );
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
