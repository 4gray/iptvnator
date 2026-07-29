import {
    extractYear,
    releaseTagYear,
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
        // The title is read for a release TAG only. Here the year is part of
        // the movie's identity — it gates discovery and keys the pin — so a
        // year that is part of the NAME ("2001: A Space Odyssey") would reject
        // every genuine 1968 copy and move the pin key the moment enrichment
        // supplies the real one.
        year: extractYear(vodInfo?.releasedate) ?? releaseTagYear(title),
        tmdbId: vodInfo?.tmdb_id,
    };
}

/**
 * Identity key for "this is still the same movie, described the same way".
 *
 * Includes every field that changes matching or pin lookup, not just the ids.
 * The catalog title usually arrives before `get_vod_info` supplies the TMDB id
 * and release year; if the key ignored those, enrichment would never trigger a
 * reload, discovery would stay yearless and a `tmdb:`-keyed pin would never be
 * found.
 */
export function vodMultiSourceMovieKey(movie: VodMultiSourceMovie): string {
    return [
        movie.playlistId,
        movie.contentId,
        movie.title,
        movie.year ?? '',
        movie.tmdbId ?? '',
    ].join(':');
}

/**
 * Identity of the FILM, made of the only two things that cannot change while
 * it stays on screen.
 *
 * The key above deliberately reacts to metadata, so enrichment re-runs
 * discovery. This one answers the question that arises at that same moment:
 * is this a different movie — reset everything — or the same one being
 * described better, whose session must survive?
 */
export function vodMultiSourceSessionKey(movie: VodMultiSourceMovie): string {
    return `${movie.playlistId}:${movie.contentId}`;
}
