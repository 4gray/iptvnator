import { inject, signal } from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';

export interface XtreamRecentItemRequest {
    readonly xtreamId: number | string;
    readonly contentType: 'movie' | 'series';
    readonly backdropUrl?: string;
}

/**
 * Records a movie or series as recently viewed once `streamUrl` has really
 * played — inline for a couple of seconds, or launched in MPV/VLC — so a
 * source that fails straight away never reaches history or the dashboard
 * hero.
 *
 * A confirmation that arrives after the user switched to another playlist
 * (only a slow MPV/VLC launch can: the inline player goes with the page) is
 * dropped: the store's recent list belongs to the other playlist by then,
 * and recording it would misfile the item or replace that list. The check
 * lives here, off the initial bundle the Xtream store ships in.
 *
 * Must run in an injection context.
 */
export function injectXtreamRecentHistory(): (
    streamUrl: string,
    request: XtreamRecentItemRequest
) => void {
    const gate = inject(PlaybackHistoryGate);
    const store = inject(XtreamStore);

    return (streamUrl, request) => {
        const playlist = signal(store.currentPlaylist()).asReadonly();
        gate.defer({ streamUrls: [streamUrl] }, () => {
            if (store.currentPlaylist()?.id === playlist()?.id) {
                store.addRecentItem({ ...request, playlist });
            }
        });
    };
}
