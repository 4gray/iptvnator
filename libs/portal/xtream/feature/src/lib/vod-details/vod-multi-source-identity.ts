import {
    extractYear,
    type XtreamVodInfo,
    type XtreamVodStream,
} from '@iptvnator/shared/interfaces';

/**
 * Who the movie on screen is, in the portal-agnostic terms multi-source needs.
 *
 * Pulled out of the host service so the "which of these three shapes carries
 * the title" question stays a pure, testable function.
 */
export interface VodMultiSourceMovie {
    playlistId: string;
    playlistName: string;
    contentId: number;
    title: string;
    year: number | null;
    tmdbId?: number | string | null;
}

type CatalogItem =
    | (Partial<XtreamVodStream> & { title?: string })
    | null
    | undefined;

/**
 * Resolve the movie identity, or null while it is not yet knowable.
 *
 * The title can arrive from either the catalog row (present immediately) or
 * `get_vod_info` (arrives later, and again after TMDB enrichment replaces
 * `selectedItem`). Returning null until one exists keeps discovery from
 * firing on an empty query.
 */
export function resolveVodMultiSourceMovie(input: {
    playlistId: string | null | undefined;
    playlistName: string | null | undefined;
    vodId: number;
    vodInfo: XtreamVodInfo | null;
    catalogItem: CatalogItem;
}): VodMultiSourceMovie | null {
    const { playlistId, vodId, vodInfo, catalogItem } = input;

    if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) {
        return null;
    }

    const title =
        vodInfo?.name?.trim() ||
        catalogItem?.title?.trim() ||
        catalogItem?.name?.trim();
    if (!title) {
        return null;
    }

    return {
        playlistId,
        playlistName: input.playlistName?.trim() || playlistId,
        contentId: vodId,
        title,
        year: extractYear(vodInfo?.releasedate, title),
        tmdbId: vodInfo?.tmdb_id,
    };
}

/**
 * Identity key for "this is still the same movie".
 *
 * Includes the title because it can arrive after the ids do — the first pass
 * may run against the catalog title and a better one may follow.
 */
export function vodMultiSourceMovieKey(movie: VodMultiSourceMovie): string {
    return `${movie.playlistId}:${movie.contentId}:${movie.title}`;
}
