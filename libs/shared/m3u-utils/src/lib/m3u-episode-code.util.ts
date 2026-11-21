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
 * to win — but only on evidence a film title cannot produce. Across large
 * catalogs, the dividing line is word order, not vocabulary:
 *
 *   strong  "THE IRON SQUAD S01 E01", "YILDIZ 5.BÖLÜM", "The Depot 1x02"
 *   weak    "GECE AVCISI: BÖLÜM 2", "PICNIC SEASON 3", "ÇELİK KULE - BÖLÜM 1"
 *
 * Turkish writes film instalments as "Bölüm 2" exactly where English writes
 * "Part 2", and "Picnic Season 3" is a film named after a season. Both are
 * word-first, so a lone word-first marker proves nothing under `/movie/`.
 * A trailing number-first marker ("5.BÖLÜM") is how daily serials are
 * written and has no film counterpart, and a name carrying a season word
 * AND an episode word ("Staffel 2 Folge 3") is never a film title.
 *
 * Under `/series/` this distinction is irrelevant: the path already decided.
 */
const EPISODE_WORD = `(?:${EPISODE_WORD_ALTERNATIVES})`;
/**
 * Appended to a number-first marker ("5.BÖLÜM") to reject it when the
 * episode word is itself followed by a short standalone number. In
 * "The 100 Episode 5" the 100 is the end of the title and the marker is the
 * word-first "Episode 5"; reading it number-first files every episode of the
 * show as number 100 of a series called "The".
 *
 * Longer or glued numbers ("5.BÖLÜM 1080p", "5.BÖLÜM 2023") are quality and
 * year tails, and a number that a season word follows ("12 серия 2 сезон")
 * is the season; neither rejects the number-first reading. Shared by the
 * classifier and the parser so the two cannot disagree. The cost is
 * "SHOW 5.BÖLÜM 2" (part 2 of episode 5), read as episode 2 of "SHOW 5".
 */
export const NOT_A_TITLE_NUMBER = `(?![\\s._-]*\\d{1,3}(?![\\p{L}\\p{N}])(?![\\s._-]*(?:${SEASON_WORD_ALTERNATIVES})))`;
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
 * serials run past a hundred episodes, and "SESSİZ VADİ 120.BÖLÜM" is the
 * same shape as its first episode.
 *
 * Deliberately NOT anchored to the end of the name. Turkish serials label
 * their last episode "7.BÖLÜM FINAL", and an end-anchor filed exactly those
 * rows as films. The order is what makes this safe: a film instalment is
 * written "BÖLÜM 2" (word first), never "2.BÖLÜM", so the weak cases this
 * rule exists to exclude cannot match it whatever follows.
 *
 * `NOT_A_TITLE_NUMBER` keeps "Apollo 13 Bölüm 2" out: there the number
 * belongs to the title and the marker is the weak word-first "Bölüm 2".
 */
const NUMBER_THEN_EPISODE_WORD = new RegExp(
    `(?:^|[^\\p{L}\\d])\\d{1,3}[\\s._-]*${EPISODE_WORD}(?!\\p{L})${NOT_A_TITLE_NUMBER}`,
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
