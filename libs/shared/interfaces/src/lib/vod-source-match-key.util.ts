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
 * Enrichment arrives late and adds BOTH identifying fields, so a pin can have
 * been written under any earlier, poorer form of the same movie:
 *   - before the TMDB id → `title:{base}:{year}`
 *   - before the release year too → `title:{base}:`
 * Each of those is a key the row may still be sitting under, and a lookup that
 * skipped it would silently lose a preference the user set minutes ago.
 */
export function buildVodSourceMatchKeyCandidates(input: {
    tmdbId?: number | string | null;
    title?: string | null;
    year?: number | null;
}): string[] {
    const keys: string[] = [];
    const push = (key: string | null) => {
        if (key && !keys.includes(key)) {
            keys.push(key);
        }
    };

    const tmdbId = normalizeTmdbId(input.tmdbId);
    if (tmdbId !== null) {
        push(`${TMDB_PREFIX}${tmdbId}`);
    }

    push(buildVodSourceMatchKey({ ...input, tmdbId: null }));
    // The yearless form, for a pin set before the release date was known.
    push(buildVodSourceMatchKey({ ...input, tmdbId: null, year: null }));

    return keys;
}

/**
 * The keys that name exactly ONE film — the only ones safe to write to or
 * delete.
 *
 * `buildVodSourceMatchKeyCandidates` deliberately also offers the yearless
 * `title:{base}:` form, because a pin set before the release year was known
 * lives there. But that form is shared by every remake: storing a
 * known-year decision in it would answer for a different film, and deleting
 * it could throw away a different film's preference.
 */
export function buildVodSourceMatchKeyWriteKeys(input: {
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
    // The yearless form (`title:dune:`) names every remake at once, so once a
    // precise key exists it must not be written OR retired alongside it — the
    // row may hold a different film's pre-enrichment preference. When it is
    // the ONLY key we have, it is still better than refusing to pin at all,
    // and `retirablePinKeys` re-adds it whenever this session actually read
    // it.
    const isAmbiguous = titleKey?.endsWith(':') === true;
    const hasPreciseKey = keys.length > 0;
    if (
        titleKey &&
        !keys.includes(titleKey) &&
        !(isAmbiguous && hasPreciseKey)
    ) {
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
