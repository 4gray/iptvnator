import { applyApiMetadata } from '@iptvnator/portal/shared/data-access';
import {
    unambiguousCategoryLanguage,
    type VodSourceCandidate,
} from '@iptvnator/shared/interfaces';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

/**
 * The row standing for the source the route is already playing.
 *
 * Discovery only returns OTHER playlists, so without this the popover would
 * list the alternatives and say nothing about where the film is coming from
 * right now — and the "playing" badge would have nothing to attach to.
 *
 * It carries the provider's stated facts when the page has them. An
 * alternative gets its facts from the resolve that precedes playing it, but
 * this row is never resolved — the film is already playing from it — so
 * without this it held no metadata at all. Everything comparing two sources
 * then had nothing on one side: `audioDiffersFactually` in particular returns
 * false whenever either side is silent, so the "dub may differ" warning could
 * not fire on a route-to-alternative switch, which is the commonest one there
 * is.
 */
export function currentSourceRow(
    movie: VodMultiSourceMovie
): VodSourceCandidate {
    const row: VodSourceCandidate = {
        id: `${movie.playlistId}:xtream:${movie.contentId}`,
        playlistId: movie.playlistId,
        playlistName: movie.playlistName,
        portalType: 'xtream',
        contentId: movie.contentId,
        rawTitle: movie.title,
        matchConfidence: 'exact',
        year: movie.year ?? null,
        categoryLanguage: routeCategoryLanguage(movie),
    };

    return movie.metadata ? applyApiMetadata(row, movie.metadata) : row;
}

/**
 * The route row's category-derived language: what the one category the route
 * arrived through states, if that is a language. Alternatives read this off
 * every category the DB knows; the route only knows the visible one. Shared
 * with the host's refresh path so the two cannot drift — the category loads
 * late on cold/direct routes and arrives without changing the movie key.
 */
export function routeCategoryLanguage(
    movie: VodMultiSourceMovie
): string | null {
    return unambiguousCategoryLanguage(
        movie.categoryName ? [movie.categoryName] : null
    );
}
