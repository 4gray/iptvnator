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

export interface VodLocalDownloadStateDeps {
    readonly downloadsService: DownloadsService;
    readonly item: Signal<VodDetailsItem>;
    /** Provider detail handoff hides local/download presentation only. */
    readonly providerOnly: Signal<boolean>;
}

/**
 * The VOD details page's view of its own download: the download-state
 * signals (always false in provider-only mode) and the two actions that
 * act on the local copy.
 */
export function createVodLocalDownloadState(deps: VodLocalDownloadStateDeps) {
    const { downloadsService, item, providerOnly } = deps;
    const downloadState = createVodDownloadState(downloadsService, item);

    return {
        isDownloaded: computed(
            () => !providerOnly() && downloadState.isDownloaded()
        ),
        isDownloading: computed(
            () => !providerOnly() && downloadState.isDownloading()
        ),
        isPausedDownload: computed(
            () => !providerOnly() && downloadState.isPausedDownload()
        ),

        /** Resume the paused download of this VOD */
        async resumePausedDownload(): Promise<void> {
            const currentItem = item();
            await downloadsService.resumeDownloadByContent(
                getVodNumericId(currentItem),
                currentItem.playlistId,
                'vod'
            );
        },

        /** Play from local downloaded file */
        async playFromLocal(): Promise<void> {
            const currentItem = item();
            const vodId = getVodNumericId(currentItem);

            const filePath = downloadsService.getDownloadedFilePath(
                vodId,
                currentItem.playlistId,
                'vod'
            );

            if (filePath) {
                await downloadsService.playDownload(filePath);
            }
        },
    };
}
