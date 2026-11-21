import { ChannelActions } from '@iptvnator/m3u-state';
import { Channel } from '@iptvnator/shared/interfaces';
import { isLikelyM3uMovie } from '@iptvnator/shared/m3u-utils';
import { classifyM3uEntry } from '@iptvnator/shared/m3u-utils/catalog';
import { isM3uCollectionView } from './m3u-collection-view.util';

/**
 * Whether a row opens as a film.
 *
 * Two rules can answer this and they disagree at the edges, so exactly one
 * is asked per row. While the catalog split is in effect the classifier
 * decides for the rows it moved, because it is what filed them: "GECE
 * AVCISI: BÖLÜM 2" sits in Movies and must open as a film, and "SESSİZ VADİ
 * 120.BÖLÜM" sits in Series and must not. A row the classifier left in the
 * live list keeps the player's original gate: the classifier resolves doubt
 * toward live on the promise that such a film "only keeps today's
 * behaviour", and one classified row elsewhere in the playlist must not
 * take the detail view away from it. With the split off, or on a live-only
 * playlist, the original gate decides for every row.
 */
export function isM3uMovieRow(
    channel: Pick<
        Channel,
        'url' | 'name' | 'radio' | 'tvg' | 'catchup' | 'timeshift'
    >,
    splitsCatalog: boolean
): boolean {
    if (!splitsCatalog) {
        return isLikelyM3uMovie(channel);
    }
    const kind = classifyM3uEntry(channel);
    return kind === 'movie' || (kind === 'live' && isLikelyM3uMovie(channel));
}

/**
 * The action that opens a row handed over through navigation state.
 *
 * A live channel is only selected: it has a row in the list the handoff
 * lands on, and "open stream on double click" users start it from there.
 * A film or episode has no such row while the split is in effect — the All
 * and Groups views render live channels only — so for an external player
 * nothing on screen could start it (the detail shell offers Play for inline
 * players alone). Those rows carry the playback request with them. The
 * Favorites and Recent views list every stored row, so they keep selecting.
 */
export function handoffAction(
    channel: Channel,
    view: string | null | undefined,
    catalog: { splitsCatalog(): boolean }
) {
    const kind = classifyM3uEntry(channel);
    const hasNoListRow =
        !isM3uCollectionView(view) &&
        catalog.splitsCatalog() &&
        (kind === 'movie' || kind === 'episode');
    return ChannelActions.setActiveChannel(
        hasNoListRow ? { channel, startPlayback: true } : { channel }
    );
}
