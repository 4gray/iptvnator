import { extractYear } from '@iptvnator/services';
import {
    PortalActivityItem,
    TmdbMediaType,
    extractStalkerItemTmdbHints,
} from '@iptvnator/shared/interfaces';

/** Everything a dashboard TMDB lookup reads off an activity row */
export type DashboardTmdbLookupItem = Pick<
    PortalActivityItem,
    'title' | 'type' | 'stalker_item' | 'source'
>;

/**
 * One lookup attempt: a media type plus the query to run under it. The
 * TMDB id belongs to exactly one media type, so a second attempt under the
 * other one must drop it — `/movie/<tv id>` resolves to an unrelated film
 * whose details would then be rendered as this item's.
 */
export interface DashboardTmdbAttempt {
    readonly mediaType: TmdbMediaType;
    readonly title: string;
    readonly originalTitle?: string;
    readonly tmdbId?: number;
    readonly year: number | null;
}

/**
 * Ordered lookup attempts for one activity row. Stalker rows carry the
 * facts of the detail view's own enrichment, so they lead with those;
 * everything else can only offer the display title.
 *
 * The query is built to match what the detail view searched with, not just
 * what the card displays. A title alone is weaker identity than the detail
 * page had: without a year `pickConfidentMatch` falls back to requiring a
 * single exact title match, which common titles never satisfy, and the miss
 * is cached under a lookup key the detail view's hit can never be found at.
 *
 * A `'movie'` verdict gets a second attempt under `'tv'`, because for a
 * Stalker row `'movie'` is what everything falls back to when nothing
 * says otherwise — an embedded-VOD ("vclub") series is a `'movie'`
 * activity row, and a lazily-loaded Ministra item can be stored before
 * its series marker is known. The retry drops the id (`/movie/<tv id>`
 * resolves to an unrelated film), so a wrong default costs one
 * negatively-cached search rather than another title's metadata.
 *
 * An Xtream row gets NO such retry: its type comes from the imported
 * catalog, which files movies and series separately, so `'movie'` there
 * is evidence rather than a default. Retrying would let a same-titled
 * show answer for a film — the mirror of the `'tv'` rule below.
 *
 * `'tv'` gets no such retry. It is only ever reached on positive
 * evidence — a series category, an `is_series` flag, or a non-empty
 * episode array — and retrying it as a movie would trade that evidence
 * for a same-title film: the gate cannot tell an adaptation sharing its
 * show's name and year from the show itself.
 */
export function buildDashboardTmdbAttempts(
    item: DashboardTmdbLookupItem
): DashboardTmdbAttempt[] {
    if (item.type !== 'movie' && item.type !== 'series') {
        return [];
    }

    const hints = item.stalker_item
        ? extractStalkerItemTmdbHints(item.stalker_item)
        : null;
    const title = hints?.title ?? item.title;
    // A stalker entry with no usable name falls back to the placeholder
    // `extractStalkerItemTitle` produces. The detail view refuses to
    // enrich those, and so must this — "Unknown" is itself a real film
    // title (2011), so searching for it attaches another movie's data.
    if (!title || (hints !== null && !hints.title && title === 'Unknown')) {
        return [];
    }

    const mediaType: TmdbMediaType =
        hints?.mediaType ?? (item.type === 'series' ? 'tv' : 'movie');
    const year = hints?.year ?? extractYear(null, title);
    const primary: DashboardTmdbAttempt = {
        mediaType,
        title,
        originalTitle: hints?.originalTitle,
        tmdbId: hints?.tmdbId,
        year,
    };

    // The retry is for a `'movie'` that nothing confirmed. Two things
    // confirm one: the Xtream catalog, which files movies and series
    // apart, and a stored Stalker `tmdb_id`, which is never a provider
    // claim — its only source is a match this app already gated, under
    // this very media type. Retrying either would let a same-titled show
    // answer for a film.
    const confirmedMovie = item.source === 'xtream' || primary.tmdbId != null;
    return mediaType === 'movie' && !confirmedMovie
        ? [primary, { ...primary, mediaType: 'tv', tmdbId: undefined }]
        : [primary];
}

/**
 * Identity of the lookup for an item — memo keys, and the staleness guard
 * callers compare against while a request is in flight.
 *
 * The WHOLE attempt sequence is the identity, not just the primary one:
 * two rows can share a title, year and id yet differ in whether a `tv`
 * fallback follows, and callers cache results under this key. The hero's
 * root-level memo would otherwise hand a Stalker row's `tv` answer to an
 * Xtream movie, and `selectSeeds()` would collapse two seeds that do not
 * perform the same lookup.
 */
export function dashboardTmdbLookupKey(item: DashboardTmdbLookupItem): string {
    const attempts = buildDashboardTmdbAttempts(item);
    const [primary] = attempts;
    return primary
        ? [
              attempts.map((attempt) => attempt.mediaType).join('>'),
              primary.title,
              primary.originalTitle ?? '',
              primary.year ?? '',
              primary.tmdbId ?? '',
          ].join('|')
        : `${item.type}:${item.title}`;
}
