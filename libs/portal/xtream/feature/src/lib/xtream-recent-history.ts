import { inject, Injector, signal } from '@angular/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    type IXtreamDataSource,
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';

export interface XtreamRecentItemRequest {
    readonly xtreamId: number | string;
    readonly contentType: 'movie' | 'series';
    readonly backdropUrl?: string;
}

/**
 * Records a movie or series as recently viewed once `streamUrl` has really
 * played — inline for a couple of seconds, or launched in MPV/VLC — so a
 * source that fails straight away never reaches history or the dashboard
 * hero. The playlist is captured when playback starts, so navigating to
 * another one meanwhile cannot misfile the item.
 *
 * A confirmation that arrives after the user switched to another playlist
 * (only a slow MPV/VLC launch can: the inline player goes with the page) is
 * saved to the captured playlist without touching the store, whose recent
 * list belongs to the other playlist by then.
 *
 * Must run in an injection context.
 */
export function injectXtreamRecentHistory(): (
    streamUrl: string,
    request: XtreamRecentItemRequest
) => void {
    const gate = inject(PlaybackHistoryGate);
    const store = inject(XtreamStore);
    const injector = inject(Injector);

    return (streamUrl, request) => {
        const playlist = signal(store.currentPlaylist()).asReadonly();
        gate.defer({ streamUrls: [streamUrl] }, () => {
            const playlistId = playlist()?.id;
            if (store.currentPlaylist()?.id === playlistId) {
                store.addRecentItem({ ...request, playlist });
            } else if (playlistId) {
                void saveWithoutListRefresh(
                    injector.get(XTREAM_DATA_SOURCE),
                    // The data source factory picks SQLite by this contract,
                    // not by a generic Electron bridge.
                    !injector.get(RuntimeCapabilitiesService)
                        .supportsXtreamSqliteDataSource,
                    playlistId,
                    request
                );
            }
        });
    };
}

/**
 * The save half of `withRecentItems.addRecentItem` (same content lookup;
 * the API-only data source keys cold content by its Xtream id), without
 * reloading the store's recent list. Kept here rather than shared with the store: the
 * store and its library barrel ship in the initial bundle, this path is
 * only reached from lazy detail pages.
 */
async function saveWithoutListRefresh(
    dataSource: IXtreamDataSource,
    keysByXtreamId: boolean,
    playlistId: string,
    { xtreamId, contentType, backdropUrl }: XtreamRecentItemRequest
): Promise<void> {
    const id = Number(xtreamId);
    if (!Number.isFinite(id) || id <= 0) {
        return;
    }
    const content = await dataSource.getContentByXtreamId(
        id,
        playlistId,
        contentType
    );
    const contentId = content?.id ?? (keysByXtreamId ? id : null);
    if (contentId != null) {
        await dataSource.addRecentItem(contentId, playlistId, backdropUrl);
    }
}
