import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { createXtreamSeriesDownloadMetadataContext } from './serial-download-metadata';
import { createXtreamSeriesDownloadAdapter } from './xtream-series-download.adapter';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

/** The season container's download adapter for the series on screen. */
@Injectable()
export class SerialDetailsDownloadAdapterService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly translateService = inject(TranslateService);
    private readonly selectedItem = signal<Signal<XtreamSerieDetailsView | null> | null>(
        null
    );

    bind(selectedItem: Signal<XtreamSerieDetailsView | null>): void {
        this.selectedItem.set(selectedItem);
    }

    readonly adapter = computed<SeasonEpisodeDownloadAdapter | null>(() => {
        const playlist = this.xtreamStore.currentPlaylist();
        const item = this.selectedItem()?.() ?? null;
        if (!playlist || !item) {
            return null;
        }

        return createXtreamSeriesDownloadAdapter({
            playlistId: playlist.id,
            seriesId: Number(item.series_id),
            title: item.info.name,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            userAgent: playlist.userAgent,
            referrer: playlist.referrer,
            origin: playlist.origin,
            metadataContext: createXtreamSeriesDownloadMetadataContext(
                item.info,
                this.translateService.currentLang ||
                    this.translateService.defaultLang ||
                    'en'
            ),
        });
    });
}
