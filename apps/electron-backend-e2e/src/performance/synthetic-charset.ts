/**
 * Title vocabulary for the synthetic M3U and XMLTV performance fixtures.
 *
 * V8 keeps a string one-byte (Latin-1) while every character fits in a byte
 * and stores the whole string as two-byte UTF-16 once a single character
 * outside Latin-1 appears. `cyrillic` fixtures exercise that two-byte path.
 *
 * Every Cyrillic entry has exactly the UTF-16 length of its Latin entry, so
 * both variants have the same line count and the same character layout; only
 * the display titles (channel, group and programme titles) differ.
 */
export const SYNTHETIC_CHARSETS = ['latin1', 'cyrillic'] as const;

export type SyntheticCharset = (typeof SYNTHETIC_CHARSETS)[number];

export interface SyntheticTitleVocabulary {
    readonly channel: string;
    readonly group: string;
    readonly language: string;
    readonly programme: string;
}

export const SYNTHETIC_TITLE_VOCABULARY: Readonly<
    Record<SyntheticCharset, SyntheticTitleVocabulary>
> = Object.freeze({
    latin1: Object.freeze({
        channel: 'Synthetic Channel',
        group: 'Synthetic Group',
        language: 'en',
        programme: 'Synthetic Programme',
    }),
    cyrillic: Object.freeze({
        channel: 'Пробный телеканал',
        group: 'Пробная рубрика',
        language: 'ru',
        programme: 'Синтетическая серия',
    }),
});

export function resolveSyntheticCharset(
    charset: SyntheticCharset | undefined
): SyntheticCharset {
    const resolved = charset ?? 'latin1';
    if (!SYNTHETIC_CHARSETS.includes(resolved)) {
        throw new Error(`Unsupported synthetic charset: ${String(charset)}`);
    }
    return resolved;
}
