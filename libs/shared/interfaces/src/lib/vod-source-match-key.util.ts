/**
 * Portal-agnostic identity for a movie, used to key multi-source pins.
 *
 * Provider ids cannot be used: the same film carries a different `stream_id`
 * in every portal, which is precisely the problem this feature solves. A TMDB
 * id is the strongest identity when both sides have one, but Stalker rarely
 * does and Xtream's arrives asynchronously after enrichment — so the title
 * form has to work standalone and stay stable when a TMDB id shows up later.
 */

import { normalizeTitleKeys } from './title-normalization.util';

const TMDB_PREFIX = 'tmdb:';
const TITLE_PREFIX = 'title:';

/**
 * Build the canonical key for a movie.
 *
 * Prefers `tmdb:{id}`; falls back to `title:{normalizedBase}:{year}`. The
 * year-stripped `base` form is used deliberately: the trailing year in a
 * provider title is usually a release tag, and portals disagree about whether
 * to include it.
 *
 * Returns `null` when there is nothing identifying to key on, so callers are
 * forced to handle "cannot pin this" rather than silently writing a junk row.
 */
export function buildVodSourceMatchKey(input: {
    tmdbId?: number | string | null;
    title?: string | null;
    year?: number | null;
}): string | null {
    const tmdbId = normalizeTmdbId(input.tmdbId);
    if (tmdbId !== null) {
        return `${TMDB_PREFIX}${tmdbId}`;
    }

    const { base } = normalizeTitleKeys(input.title);
    if (!base) {
        return null;
    }

    return `${TITLE_PREFIX}${base}:${input.year ?? ''}`;
}

/**
 * Every key a movie may legitimately be stored under, most-trusted first.
 *
 * A pin written before TMDB enrichment lands is keyed by title; after
 * enrichment the same movie prefers a `tmdb:` key. Looking up both means the
 * earlier pin is not orphaned by the id arriving.
 */
export function buildVodSourceMatchKeyCandidates(input: {
    tmdbId?: number | string | null;
    title?: string | null;
    year?: number | null;
}): string[] {
    const keys: string[] = [];

    const tmdbId = normalizeTmdbId(input.tmdbId);
    if (tmdbId !== null) {
        keys.push(`${TMDB_PREFIX}${tmdbId}`);
    }

    const titleKey = buildVodSourceMatchKey({ ...input, tmdbId: null });
    if (titleKey && !keys.includes(titleKey)) {
        keys.push(titleKey);
    }

    return keys;
}

export function isTmdbMatchKey(key: string): boolean {
    return key.startsWith(TMDB_PREFIX);
}

/**
 * Coerce a provider-supplied TMDB id to a positive integer.
 *
 * Xtream sends this field as a string, as `0`, and as `""` depending on the
 * panel build; none of those are usable ids.
 */
function normalizeTmdbId(raw: number | string | null | undefined): number | null {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }

    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
