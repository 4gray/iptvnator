import type {
    TmdbEnrichmentService,
    TmdbMatchIdentity,
    TmdbMatchService,
    TmdbMovieDetails,
    TmdbTvDetails,
} from '@iptvnator/services';
import {
    type PlaybackPositionData,
    PortalActivityItem,
    extractStalkerItemTmdbHints,
} from '@iptvnator/shared/interfaces';
import {
    DashboardTmdbAttempt,
    DashboardTmdbLookupItem,
    buildDashboardTmdbAttempts,
} from './dashboard-tmdb-lookup.util';

/** An activity row with what its TMDB match identity is built from */
export type DashboardTmdbMatchItem = DashboardTmdbLookupItem &
    Partial<Pick<PortalActivityItem, 'playlist_id' | 'xtream_id'>>;

export interface DashboardTmdbResolution {
    readonly attempt: DashboardTmdbAttempt;
    /** `null`: the viewer chose the provider's data — no TMDB for this row */
    readonly details: TmdbMovieDetails | TmdbTvDetails | null;
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const text =
            typeof value === 'string' || typeof value === 'number'
                ? String(value).trim()
                : '';
        if (text) return text;
    }
    return '';
}

/**
 * The identity a detail view stores the viewer's TMDB match choice under
 * for this row (`TmdbMatchService`), built the way those views build it:
 * Xtream from the catalog type and the stream/series id, Stalker from the
 * stored entry's id, media type and catalog. M3U rows have no detail match.
 */
export function dashboardTmdbMatchIdentity(
    item: DashboardTmdbMatchItem,
    position?: Pick<
        PlaybackPositionData,
        'contentType' | 'contentXtreamId' | 'seriesXtreamId'
    > | null
): TmdbMatchIdentity | null {
    const playlistId = firstText(item.playlist_id);
    if (!playlistId || (item.type !== 'movie' && item.type !== 'series')) {
        return null;
    }
    if (item.source === 'xtream') {
        let itemId = firstText(item.xtream_id);
        if (item.type === 'series' && position?.contentType === 'episode') {
            // A recent row can be keyed by an episode. Its position may
            // already point to the next episode, which has the same parent.
            const parent = position.seriesXtreamId;
            if (parent && Number.isSafeInteger(parent) && parent > 0) {
                itemId = String(parent);
            } else if (Number(itemId) === position.contentXtreamId) {
                return null;
            }
        }
        return itemId
            ? {
                  provider: 'xtream',
                  playlistId,
                  mediaType: item.type === 'series' ? 'tv' : 'movie',
                  itemId,
              }
            : null;
    }
    if (item.source === 'stalker' && item.stalker_item) {
        const raw = item.stalker_item as unknown as Record<string, unknown>;
        const itemId = firstText(raw['id'], raw['stream_id']);
        const series =
            String(raw['category_id'] ?? '').toLowerCase() === 'series' ||
            raw['favoriteContentType'] === 'series';
        return itemId
            ? {
                  provider: 'stalker',
                  playlistId,
                  // The series catalog itself makes it a show, as in the
                  // detail view (a favorite saved there keeps its genre id).
                  mediaType: series
                      ? 'tv'
                      : extractStalkerItemTmdbHints(raw).mediaType,
                  itemId,
                  catalog: series ? 'series' : 'vod',
              }
            : null;
    }
    return null;
}

/**
 * The viewer's stored choice for the row, as part of a cache key: a changed
 * match must load again. Empty while the match store is not loaded or the
 * row has no choice.
 */
export function dashboardTmdbMatchToken(
    matches: TmdbMatchService | null,
    identity: TmdbMatchIdentity | null
): string {
    if (!identity) return '';
    const choice = matches?.read(identity);
    if (choice?.mode === 'manual') {
        return `manual:${identity.mediaType}:${choice.tmdbId}`;
    }
    return choice?.mode === 'provider' ? 'provider' : '';
}

function toQuery(attempt: DashboardTmdbAttempt) {
    return {
        title: attempt.title,
        originalTitle: attempt.originalTitle,
        tmdbId: attempt.tmdbId,
        year: attempt.year,
    };
}

function enrich(
    enrichment: TmdbEnrichmentService,
    mediaType: DashboardTmdbAttempt['mediaType'],
    query: Parameters<TmdbEnrichmentService['enrichMovie']>[0]
): Promise<TmdbMovieDetails | TmdbTvDetails | null> {
    return mediaType === 'tv'
        ? enrichment.enrichTv(query)
        : enrichment.enrichMovie(query);
}

/**
 * Resolves a row to TMDB details the way its detail view does. A match the
 * viewer picked by hand is that title; "use the provider's data" means no
 * TMDB data at all — the automatic attempts must not then find one, and it
 * resolves with `details: null`. Rows without a choice run the automatic
 * attempts in order; `null` means none matched (or TMDB failed).
 */
export async function resolveDashboardTmdbDetails(
    enrichment: TmdbEnrichmentService,
    item: DashboardTmdbMatchItem,
    matches?: TmdbMatchService | null,
    identity = dashboardTmdbMatchIdentity(item)
): Promise<DashboardTmdbResolution | null> {
    const attempts = buildDashboardTmdbAttempts(item);
    if (identity) {
        const store =
            matches === undefined ? await enrichment.getMatches?.() : matches;
        if (!store) return null;
        const choice = store.read(identity);
        if (choice?.mode === 'provider') {
            return {
                attempt: attempts[0] ?? {
                    title: item.title,
                    mediaType: identity.mediaType,
                    year: null,
                },
                details: null,
            };
        }
        if (choice?.mode === 'manual') {
            const attempt = attempts.find(
                (candidate) => candidate.mediaType === identity.mediaType
            ) ?? {
                ...(attempts[0] ?? { title: choice.title, year: null }),
                mediaType: identity.mediaType,
            };
            const details = await enrich(enrichment, identity.mediaType, {
                ...toQuery(attempt),
                matchIdentity: identity,
            });
            return details ? { attempt, details } : null;
        }
    }

    for (const attempt of attempts) {
        const details = await enrich(
            enrichment,
            attempt.mediaType,
            toQuery(attempt)
        );
        if (details) return { attempt, details };
    }
    return null;
}
