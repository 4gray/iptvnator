import { computed, Signal } from '@angular/core';
import { DownloadsService } from '@iptvnator/services';
import { getVodNumericId, VodDetailsItem } from '@iptvnator/shared/interfaces';

/**
 * Download-state signals for a VOD detail view. Reading
 * `downloadsService.downloads()` inside each computed creates the reactive
 * dependency on the download list.
 */
export function createVodDownloadState(
    downloadsService: DownloadsService,
    item: Signal<VodDetailsItem>
) {
    const query = (
        check: (vodId: number, playlistId: string) => boolean
    ): Signal<boolean> =>
        computed(() => {
            const currentItem = item();
            downloadsService.downloads();
            return check(getVodNumericId(currentItem), currentItem.playlistId);
        });

    return {
        isDownloaded: query((vodId, playlistId) =>
            downloadsService.isDownloaded(vodId, playlistId, 'vod')
        ),
        isDownloading: query((vodId, playlistId) =>
            downloadsService.isDownloading(vodId, playlistId, 'vod')
        ),
        isPausedDownload: query((vodId, playlistId) =>
            downloadsService.isPaused(vodId, playlistId, 'vod')
        ),
    };
}
