import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { DownloadsService } from '@iptvnator/services';
import {
    XtreamVodDetails,
    getXtreamVodInfo,
} from '@iptvnator/shared/interfaces';

/**
 * Offline downloads for the movie on screen.
 *
 * Every read re-touches `downloads()` so the computed tracks the signal the
 * service updates — the per-item helpers are plain lookups and would not
 * otherwise re-run when a download's state changes.
 */
@Injectable()
export class VodDetailsDownloadsService {
    private readonly downloadsService = inject(DownloadsService);
    private readonly xtreamStore = inject(XtreamStore);

    private routeContentId: Signal<number> = signal(NaN);

    bind(bindings: { routeContentId: Signal<number> }): void {
        this.routeContentId = bindings.routeContentId;
    }

    private readonly context = computed(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        // Read so the state below re-derives as downloads progress.
        this.downloadsService.downloads();
        return playlistId ? { playlistId, vodId: this.routeContentId() } : null;
    });

    readonly isDownloaded = computed(() => {
        const context = this.context();
        return context
            ? this.downloadsService.isDownloaded(
                  context.vodId,
                  context.playlistId,
                  'vod'
              )
            : false;
    });

    readonly isDownloading = computed(() => {
        const context = this.context();
        return context
            ? this.downloadsService.isDownloading(
                  context.vodId,
                  context.playlistId,
                  'vod'
              )
            : false;
    });

    readonly isPausedDownload = computed(() => {
        const context = this.context();
        return context
            ? this.downloadsService.isPaused(
                  context.vodId,
                  context.playlistId,
                  'vod'
              )
            : false;
    });

    async resumePaused(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }

        await this.downloadsService.resumeDownloadByContent(
            this.routeContentId(),
            playlistId,
            'vod'
        );
    }

    async start(vodItem: XtreamVodDetails | null): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!vodItem || !playlist) {
            return;
        }

        const info = getXtreamVodInfo(vodItem);
        const routeVodId = this.routeContentId();
        const id = Number.isFinite(routeVodId)
            ? routeVodId
            : Number(
                  vodItem.movie_data?.stream_id ||
                      (vodItem as { stream_id?: number }).stream_id
              );

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: info?.name ?? vodItem.movie_data?.name ?? 'Unknown',
            url: this.xtreamStore.constructVodStreamUrl(vodItem),
            posterUrl: info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        });
    }

    async playLocal(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }

        const filePath = this.downloadsService.getDownloadedFilePath(
            this.routeContentId(),
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
