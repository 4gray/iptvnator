import { inject, signal } from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackHistoryGate } from '@iptvnator/services';

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
        gate.defer({ streamUrls: [streamUrl] }, () =>
            store.addRecentItem({ ...request, playlist })
        );
    };
}
