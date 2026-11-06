import { SEASON_WORD_ALTERNATIVES } from '@iptvnator/shared/interfaces';

// Keep provider-only matching off the shared startup import graph.
const SEASON_WORD = `(?:${SEASON_WORD_ALTERNATIVES})`;

const SEASON_RANGE_PATTERNS = [
    new RegExp(
        `(?:^|[^\\d])(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s*${SEASON_WORD}(?:s|ы|ов)?(?!\\p{L})`,
        'iu'
    ),
    new RegExp(
        `(?:^|[^\\p{L}])${SEASON_WORD}(?:s|ы|ов)?[\\s_.:]*(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})(?!\\d)`,
        'iu'
    ),
    /(?:^|[\s([{_.-])s(\d{1,2})\s*[-–—]\s*s?(\d{1,2})(?=$|[\s)\]}_.-])/i,
];

/** An explicit multi-season range gives no season coordinates for a flat list. */
export function hasSeasonRangeInTitle(raw: string | null | undefined): boolean {
    return (
        !!raw &&
        SEASON_RANGE_PATTERNS.some((pattern) => {
            const match = raw.match(pattern);
            return (
                !!match &&
                Number(match[1]) > 0 &&
                Number(match[2]) > 0 &&
                Number(match[1]) !== Number(match[2])
            );
        })
    );
}
