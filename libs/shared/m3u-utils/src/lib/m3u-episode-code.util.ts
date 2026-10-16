import { SEASON_WORD_ALTERNATIVES } from '@iptvnator/shared/interfaces';
import {
    EPISODE_WORD_ALTERNATIVES,
    SEASON_EPISODE_CODE,
    CROSS_EPISODE_CODE,
} from './m3u-vod-detection.util';

// Catalog-only: kept out of `m3u-vod-detection.util`, which the main barrel
// puts on the startup path, so these patterns load with the catalog.

/**
 * The subset of episode markers strong enough to overrule a `/movie/` path.
 *
 * Providers do dump whole series under `/movie/`, so the name has to be able
 * to win — but only on evidence a film title cannot produce. Measured
 * against a real catalog, the dividing line is word order, not vocabulary:
 *
 *   strong  "THE BAD BATCH S01 E01", "DELIKANLI 5.BÖLÜM", "The Office 1x02"
 *   weak    "KILL BILL: BÖLÜM 2", "OPEN SEASON 3", "AÇLIK OYUNLARI - BÖLÜM 1"
 *
 * Turkish writes film instalments as "Bölüm 2" exactly where English writes
 * "Part 2", and "Open Season 3" is a film named after a season. Both are
 * word-first, so a lone word-first marker proves nothing under `/movie/`.
 * A trailing number-first marker ("5.BÖLÜM") is how daily serials are
 * written and has no film counterpart, and a name carrying a season word
 * AND an episode word ("Staffel 2 Folge 3") is never a film title.
 *
 * Under `/series/` this distinction is irrelevant: the path already decided.
 */
const EPISODE_WORD = `(?:${EPISODE_WORD_ALTERNATIVES})`;
const SEASON_WORD_THEN_NUMBER = new RegExp(
    `(?:^|[^\\p{L}])(?:${SEASON_WORD_ALTERNATIVES})[\\s._-]*\\d{1,3}(?!\\d)`,
    'iu'
);
const EPISODE_WORD_THEN_NUMBER = new RegExp(
    `(?:^|[^\\p{L}])${EPISODE_WORD}[\\s._-]*\\d{1,3}(?!\\d)`,
    'iu'
);
/**
 * Number-first: "5.BÖLÜM", "12 серия".
 *
 * `\d{1,3}` rather than the two digits the general marker allows: daily
 * serials run past a hundred episodes, and "UZAK ŞEHİR 120.BÖLÜM" is the
 * same shape as its first episode.
 *
 * Deliberately NOT anchored to the end of the name. Turkish serials label
 * their last episode "7.BÖLÜM FINAL", and an end-anchor filed exactly those
 * rows as films. The order is what makes this safe: a film instalment is
 * written "BÖLÜM 2" (word first), never "2.BÖLÜM", so the weak cases this
 * rule exists to exclude cannot match it whatever follows.
 */
const NUMBER_THEN_EPISODE_WORD = new RegExp(
    `(?:^|[^\\p{L}\\d])\\d{1,3}[\\s._-]*${EPISODE_WORD}(?!\\p{L})`,
    'iu'
);

export function hasStrongEpisodeCode(name: string | null | undefined): boolean {
    if (!name) {
        return false;
    }

    return (
        SEASON_EPISODE_CODE.test(name) ||
        CROSS_EPISODE_CODE.test(name) ||
        NUMBER_THEN_EPISODE_WORD.test(name) ||
        (SEASON_WORD_THEN_NUMBER.test(name) &&
            EPISODE_WORD_THEN_NUMBER.test(name))
    );
}
