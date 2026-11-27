import {
    SEASON_WORD_ALTERNATIVES,
    extractSeasonFromTitle,
} from '@iptvnator/shared/interfaces';
import { NOT_A_TITLE_NUMBER } from './m3u-episode-code.util';

/**
 * Reads the series title, season and episode out of an M3U entry name.
 *
 * This is what turns tens of thousands of loose episode rows into a few
 * thousand series on a large playlist, with every row placed. Providers
 * write the marker in at least six spellings and rarely anything else about
 * the episode, so the name is the only source there is.
 *
 * ## What is deliberately dropped
 *
 * Everything after the marker is removed from the series title and kept
 * separately as `episodeTitle`. That removal is what makes the collapse
 * work: the tail is per-episode noise far more often than a real episode
 * name ("… S1 E1 - Türkçe Dublaj"), and leaving it in place would produce
 * one "series" per episode. Providers that do write real episode titles
 * keep them, just on the episode rather than on the series.
 *
 * ## What is deliberately kept
 *
 * The leading language tag stays in the series title. `TR:HAPPY HOUSEHOLD`
 * and `DE:HAPPY HOUSEHOLD` are the same show in two dubs, and merging them
 * would interleave two audio languages inside one season, leaving S1E1
 * ambiguous. Callers that want the tag separated ask
 * `splitM3uNameTag` for it.
 */
export interface M3uEpisodeParse {
    /** Entry name with the marker and everything after it removed. */
    readonly seriesTitle: string;
    /** 1 when the name states no season — see `hasExplicitSeason`. */
    readonly seasonNumber: number;
    readonly episodeNumber: number;
    /**
     * False when the season number above is the default rather than
     * something the provider wrote. A TMDB season lookup must consult the
     * shared season-marker resolver instead of blindly asking for season 1.
     */
    readonly hasExplicitSeason: boolean;
    /** The tail after the marker, when the provider wrote one. */
    readonly episodeTitle: string | null;
}

/**
 * Episode words, shared by the number-first and the word-first form. Even
 * the weak word-first spellings ("Episode 5") are accepted here — see the
 * strong/weak marker split in `m3u-episode-code.util.ts` — because reaching
 * this function already means something classified the row as an episode.
 */
const EPISODE_WORDS =
    'episode|episodio|folge|серия|эпизод|bölüm|bolum|odcinek|aflevering|capitulo|capítulo';

interface Matcher {
    readonly pattern: RegExp;
    /** Reads season and episode out of a successful match. */
    readonly read: (match: RegExpMatchArray) => {
        season: number | null;
        episode: number;
    };
}

/**
 * Ordered: the first match wins. Codes come before words because a name can
 * carry both ("Kommissar Nebelfeld Staffel 2 Folge 12" is words-only, but
 * "Hollow S02E03 - Folge 3" is not), and the code is the more precise signal.
 */
const MATCHERS: readonly Matcher[] = [
    {
        // "S01E01", "S1 E1", "s01.e02", "S1-E1"
        pattern: /(?:^|[^\p{L}\p{N}])s(\d{1,3})\s*[._-]?\s*e(\d{1,3})(?!\d)/iu,
        read: (m) => ({ season: Number(m[1]), episode: Number(m[2]) }),
    },
    {
        // "1x02" — a 2-3 digit episode part, so the film title "6x6" and
        // other short numeric names are never read as episodes.
        pattern: /(?:^|[^\p{L}\p{N}])(\d{1,2})x(\d{2,3})(?!\d)/u,
        read: (m) => ({ season: Number(m[1]), episode: Number(m[2]) }),
    },
    {
        // "Staffel 2 Folge 3", "Сезон 1 Серия 4"
        pattern: new RegExp(
            `(?:^|[^\\p{L}])(?:${SEASON_WORD_ALTERNATIVES})[\\s._-]*(\\d{1,2})(?!\\d)[\\s\\S]*?(?:${EPISODE_WORDS})[\\s._-]*(\\d{1,3})(?!\\d)`,
            'iu'
        ),
        read: (m) => ({ season: Number(m[1]), episode: Number(m[2]) }),
    },
    {
        // Trailing number-first: "5.BÖLÜM", "12 серия". Daily serials run
        // past a hundred episodes, hence three digits. Not when the word
        // carries its own number: "The 100 Episode 5" is word-first.
        pattern: new RegExp(
            `(?:^|[^\\p{L}\\p{N}])(\\d{1,3})[\\s._-]*(?:${EPISODE_WORDS})(?!\\p{L})${NOT_A_TITLE_NUMBER}`,
            'iu'
        ),
        read: (m) => ({ season: null, episode: Number(m[1]) }),
    },
    {
        // Word-first: "Folge 3", "Episode 5", "Bölüm 7"
        pattern: new RegExp(
            `(?:^|[^\\p{L}])(?:${EPISODE_WORDS})[\\s._-]*(\\d{1,3})(?!\\d)`,
            'iu'
        ),
        read: (m) => ({ season: null, episode: Number(m[1]) }),
    },
    {
        // Bare trailing code: "… E12", "… EP 12"
        pattern: /(?:^|[^\p{L}\p{N}])ep?\s*[._-]?\s*(\d{1,3})\s*$/iu,
        read: (m) => ({ season: null, episode: Number(m[1]) }),
    },
];

/** Punctuation providers leave dangling once the marker is removed. */
const TRAILING_JUNK = /[\s\-_.:|,–—]+$/u;

/**
 * `fallbackTitle` names the series when the name is nothing but a marker —
 * a playlist that writes the show in `group-title` and only "S01E01" in the
 * name. Without it such a name is refused.
 */
export function parseM3uEpisode(
    name: string | null | undefined,
    fallbackTitle?: string | null
): M3uEpisodeParse | null {
    const raw = (name ?? '').trim();
    if (!raw) {
        return null;
    }

    for (const matcher of MATCHERS) {
        const match = matcher.pattern.exec(raw);
        if (!match || match.index === undefined) {
            continue;
        }

        // Every pattern captures digits only, so the episode is a finite,
        // non-negative number. Episode zero is kept: providers number pilots
        // and specials "E0", and the app already treats season zero as a
        // valid Specials coordinate.
        const { season, episode } = matcher.read(match);

        // The guard character the pattern consumed belongs to the title.
        const markerStart = match.index + leadingGuardLength(match[0]);
        const seriesTitle =
            raw.slice(0, markerStart).replace(TRAILING_JUNK, '') ||
            (fallbackTitle ?? '').trim();
        if (!seriesTitle) {
            // A name that is nothing but a marker names no series.
            return null;
        }

        const tail = raw
            .slice(match.index + match[0].length)
            .replace(/^[\s\-_.:|,–—]+/u, '')
            .trim();

        const explicit = season ?? extractSeasonFromTitle(raw);

        return {
            seriesTitle,
            seasonNumber: explicit ?? 1,
            episodeNumber: episode,
            hasExplicitSeason: explicit !== null,
            episodeTitle: tail || null,
        };
    }

    return null;
}

/**
 * Every pattern opens with an optional non-letter guard rather than `\b`,
 * because JS word boundaries are ASCII-only and never fire next to Cyrillic
 * or Turkish letters. That guard character is part of the title, not of the
 * marker, so it is given back here.
 */
function leadingGuardLength(matched: string): number {
    return /^[\p{L}\p{N}]/u.test(matched) ? 0 : 1;
}
