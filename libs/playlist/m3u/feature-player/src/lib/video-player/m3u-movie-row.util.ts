import { Channel } from '@iptvnator/shared/interfaces';
import {
    classifyM3uEntry,
    isLikelyM3uMovie,
} from '@iptvnator/shared/m3u-utils';

/**
 * Whether a row opens as a film.
 *
 * Two rules answer this and they are not the same one. `isLikelyM3uMovie`
 * is the player's original gate and rejects any episode-looking word in the
 * name; the catalog's classifier is stricter about what an episode is, so
 * it files "KILL BILL: BÖLÜM 2" under Movies. A row the Movies grid offers
 * must open as a film, so either rule is enough.
 */
export function isM3uMovieRow(
    channel: Pick<Channel, 'url' | 'name' | 'radio' | 'tvg' | 'catchup'>
): boolean {
    return isLikelyM3uMovie(channel) || classifyM3uEntry(channel) === 'movie';
}
