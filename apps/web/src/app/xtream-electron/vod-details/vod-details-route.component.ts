import { Location, SlicePipe } from '@angular/common';
import {
    Component,
    OnDestroy,
    OnInit,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from 'components';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamVodDetails,
} from 'shared-interfaces';
import { DownloadsService } from '../../services/downloads.service';
import { PlayerService } from '../../services/player.service';
import { SettingsStore } from '../../services/settings-store.service';
import { PortalInlinePlayerComponent } from '../../shared/components/portal-inline-player/portal-inline-player.component';
import { XtreamStore } from '../stores/xtream.store';
import { SafePipe } from '@iptvnator/pipes';
import { createLogger } from '../../shared/utils/logger';

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
        PortalInlinePlayerComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private location = inject(Location);
    private settingsStore = inject(SettingsStore);
    private route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);
    private readonly playerService = inject(PlayerService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('VodDetailsRoute');
    private readonly detailsInitDone = signal(false);
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    private lastSaveTime = 0;

    readonly hasPlaybackPosition = computed(() => {
        const vodId = this.route.snapshot.params.vodId;
        const inProgress = this.xtreamStore.isInProgress(Number(vodId), 'vod');
        this.logger.debug('hasPlaybackPosition check', {
            vodId,
            inProgress,
        });
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

    constructor() {
        // Route can initialize before currentPlaylist signal is ready.
        // Retry initialization once playlist becomes available.
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            if (!playlistId || this.detailsInitDone()) return;
            this.initializeVodDetails(playlistId);
            this.detailsInitDone.set(true);
        });
    }

    ngOnInit(): void {
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        if (!currentPlaylist?.id) {
            this.logger.warn('Deferring VOD details init: playlist not ready');
            return;
        }
        this.initializeVodDetails(currentPlaylist.id);
        this.detailsInitDone.set(true);
    }

    ngOnDestroy() {
        this.inlinePlayback.set(null);
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

        this.logger.debug('playVod resolved ID', { id, vodItem });

        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: id,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: vodItem.info.name ?? vodItem?.movie_data?.name,
            thumbnail: vodItem.info.movie_image,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    resumeVod(vodItem: XtreamVodDetails) {
        this.addToRecentlyViewed();
        const vodId = Number(this.route.snapshot.params.vodId);
        const position = this.xtreamStore
            .playbackPositions()
            .get(`vod_${vodId}`);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        // Use vodId from route (same as above)
        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: vodId,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: vodItem.info.name ?? vodItem?.movie_data?.name,
            thumbnail: vodItem.info.movie_image,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
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

    private initializeVodDetails(playlistId: string): void {
        const { categoryId, vodId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({ vodId, categoryId });
        this.xtreamStore.checkFavoriteStatus(vodId, playlistId);
        this.xtreamStore.loadVodPosition(playlistId, Number(vodId));
    }

    goBack() {
        this.closeInlinePlayer();
        this.location.back();
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.lastSaveTime = 0;
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return;

        this.lastSaveTime = now;
        void this.xtreamStore.savePosition(playback.contentInfo.playlistId, {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        });
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        if (this.playerService.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        this.playerService.openResolvedPlayback(playback, true);
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
