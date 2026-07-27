import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

/**
 * The row standing for the source the route is already playing.
 *
 * Discovery only returns OTHER playlists, so without this the popover would
 * list the alternatives and say nothing about where the film is coming from
 * right now — and the "playing" badge would have nothing to attach to.
 */
export function currentSourceRow(
    movie: VodMultiSourceMovie
): VodSourceCandidate {
    return {
        id: `${movie.playlistId}:xtream:${movie.contentId}`,
        playlistId: movie.playlistId,
        playlistName: movie.playlistName,
        portalType: 'xtream',
        contentId: movie.contentId,
        rawTitle: movie.title,
        matchConfidence: 'exact',
        year: movie.year ?? null,
    };
}
