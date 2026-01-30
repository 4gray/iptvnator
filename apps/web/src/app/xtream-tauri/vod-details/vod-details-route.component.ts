import { Location, SlicePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, computed } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ContentHeroComponent } from 'components';
import { XtreamVodDetails } from 'shared-interfaces';
import { DownloadsService } from '../../services/downloads.service';
import { SettingsStore } from '../../services/settings-store.service';
import { XtreamStore } from '../stores/xtream.store';
import { SafePipe } from '@iptvnator/pipes';

/**
 * Route-based VOD details container for Xtream.
 *
 * This is a "smart" component that:
 * - Reads route params (vodId, categoryId)
 * - Fetches data via XtreamStore
 * - Manages playback and favorites
 *
 * Used for route-based navigation: /xtreams/:id/vod/:categoryId/:vodId
 */
@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: ['../detail-view.scss'],
    imports: [
        ContentHeroComponent,
        MatIcon,
        SafePipe,
        SlicePipe,
        TranslateModule,
        MatProgressSpinnerModule,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private location = inject(Location);
    private settingsStore = inject(SettingsStore);
    private route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = this.xtreamStore.selectedItem;

    readonly hasPlaybackPosition = computed(() => {
        const vodId = this.route.snapshot.params.vodId;
        const inProgress = this.xtreamStore.isInProgress(Number(vodId), 'vod');
        console.log(
            `[VodDetails] hasPlaybackPosition check: vodId=${vodId}, inProgress=${inProgress}`
        );
        return inProgress;
    });

    /** Check if VOD is already downloaded */
    readonly isDownloaded = computed(() => {
        const vodId = Number(this.route.snapshot.params.vodId);
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        // Access downloads signal to make this reactive
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(vodId, playlistId, 'vod');
    });

    /** Check if VOD is currently downloading */
    readonly isDownloading = computed(() => {
        const vodId = Number(this.route.snapshot.params.vodId);
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        // Access downloads signal to make this reactive
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(vodId, playlistId, 'vod');
    });

    ngOnInit(): void {
        const { categoryId, vodId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({ vodId, categoryId });
        this.xtreamStore.checkFavoriteStatus(
            vodId,
            this.xtreamStore.currentPlaylist().id
        );
        this.xtreamStore.loadVodPosition(
            this.xtreamStore.currentPlaylist().id,
            Number(vodId)
        );
    }

    ngOnDestroy() {
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails) {
        this.addToRecentlyViewed();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        // Use route param vodId if available to match ngOnInit logic, otherwise fallback to item id
        const routeVodId = this.route.snapshot.params.vodId;
        const id = routeVodId
            ? Number(routeVodId)
            : Number(
                  vodItem.movie_data?.stream_id || (vodItem as any).stream_id
              );

        console.log(`[VodDetails] playVod: Resolved ID=${id} for item`, vodItem);

        const contentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: id,
            contentType: 'vod',
        };

        this.xtreamStore.openPlayer(
            streamUrl,
            vodItem.info.name ?? vodItem?.movie_data?.name,
            vodItem.info.movie_image,
            undefined,
            contentInfo
        );
    }

    resumeVod(vodItem: XtreamVodDetails) {
        this.addToRecentlyViewed();
        const vodId = Number(this.route.snapshot.params.vodId);
        const position = this.xtreamStore
            .playbackPositions()
            .get(`vod_${vodId}`);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        // Use vodId from route (same as above)
        const contentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: vodId,
            contentType: 'vod',
        };

        this.xtreamStore.openPlayer(
            streamUrl,
            vodItem.info.name ?? vodItem?.movie_data?.name,
            vodItem.info.movie_image,
            position?.positionSeconds,
            contentInfo
        );
    }

    formatPosition(): string {
        const vodId = Number(this.route.snapshot.params.vodId);
        const position = this.xtreamStore.playbackPositions().get(`vod_${vodId}`);
        if (!position) return '';
        
        const date = new Date(0);
        date.setSeconds(position.positionSeconds);
        const timeString = date.toISOString().substr(11, 8);
        return timeString.startsWith('00:') ? timeString.substr(3) : timeString;
    }

    toggleFavorite() {
        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.vodId,
            this.xtreamStore.currentPlaylist().id
        );
    }

    private addToRecentlyViewed() {
        this.xtreamStore.addRecentItem({
            contentId: this.route.snapshot.params.vodId,
            playlist: this.xtreamStore.currentPlaylist,
        });
    }

    goBack() {
        this.location.back();
    }

    async downloadVod(vodItem: XtreamVodDetails) {
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.route.snapshot.params.vodId;
        const id = routeVodId
            ? Number(routeVodId)
            : Number(vodItem.movie_data?.stream_id || (vodItem as any).stream_id);

        const playlist = this.xtreamStore.currentPlaylist();

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: vodItem.info?.name || vodItem?.movie_data?.name || 'Unknown',
            url: streamUrl,
            posterUrl: vodItem.info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        });
    }

    async playFromLocal() {
        const vodId = Number(this.route.snapshot.params.vodId);
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return;

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
