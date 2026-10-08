import { Channel } from '@iptvnator/shared/interfaces';
import {
    classifyM3uEntry,
    isLikelyM3uMovie,
} from '@iptvnator/shared/m3u-utils';

/**
 * Whether a row opens as a film.
 *
 * Two rules can answer this and they disagree at the edges, so exactly one
 * is asked. While the catalog split is in effect the classifier decides,
 * because it is what filed the row: "KILL BILL: BÖLÜM 2" sits in Movies
 * and must open as a film, and "UZAK ŞEHİR 120.BÖLÜM" sits in Series and
 * must not. With the split off, or on a live-only playlist, the player's
 * original gate decides and behaviour is exactly what it was.
 */
export function isM3uMovieRow(
    channel: Pick<
        Channel,
        'url' | 'name' | 'radio' | 'tvg' | 'catchup' | 'timeshift'
    >,
    splitsCatalog: boolean
): boolean {
    return splitsCatalog
        ? classifyM3uEntry(channel) === 'movie'
        : isLikelyM3uMovie(channel);
}
