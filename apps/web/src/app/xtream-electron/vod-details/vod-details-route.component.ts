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
import { ExternalPlaybackService } from '../../services/external-playback.service';
import { PlayerService } from '../../services/player.service';
import { SettingsStore } from '../../services/settings-store.service';
import { PortalInlinePlayerComponent } from '../../shared/components/portal-inline-player/portal-inline-player.component';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { SafePipe } from '@iptvnator/pipes';
import { createLogger } from '@iptvnator/portal/shared/util';

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
        PortalInlinePlayerComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private location = inject(Location);
    private settingsStore = inject(SettingsStore);
    private route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);
    private readonly externalPlayback = inject(ExternalPlaybackService);
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
    readonly matchedExternalPlayback = computed(() => {
        const session = this.externalPlayback.activeSession();
        const vodId = Number(this.route.snapshot.params.vodId);
        const playlistId = this.xtreamStore.currentPlaylist()?.id;

        if (
            !session?.contentInfo ||
            !playlistId ||
            session.status === 'error' ||
            session.status === 'closed'
        ) {
            return null;
        }

        const contentInfo = session.contentInfo;
        if (
            contentInfo.playlistId !== playlistId ||
            contentInfo.contentType !== 'vod' ||
            contentInfo.contentXtreamId !== vodId
        ) {
            return null;
        }

        return session;
    });
    readonly externalPrimaryLabel = computed(() => {
        const session = this.matchedExternalPlayback();
        if (!session) {
            return null;
        }

        const player = session.player.toUpperCase();
        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
            case 'playing':
                return `Stop ${player}`;
            default:
                return null;
        }
    });
    readonly externalPrimaryIcon = computed(() => {
        const session = this.matchedExternalPlayback();
        switch (session?.status) {
            case 'launching':
                return 'hourglass_top';
            case 'opened':
            case 'playing':
                return 'stop_circle';
            default:
                return 'play_arrow';
        }
    });
    readonly isExternalLaunchPending = computed(
        () => this.matchedExternalPlayback()?.status === 'launching'
    );
    readonly isExternalStopAction = computed(() => {
        const status = this.matchedExternalPlayback()?.status;
        return status === 'opened' || status === 'playing';
    });
    readonly externalPrimaryButtonState = computed(() => {
        if (this.isExternalLaunchPending()) {
            return 'launching';
        }

        return this.isExternalStopAction() ? 'stop' : 'idle';
    });

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

    onPrimaryAction(vodItem: XtreamVodDetails): void {
        if (this.isExternalStopAction()) {
            void this.stopExternalPlayback();
            return;
        }

        if (this.hasPlaybackPosition()) {
            this.resumeVod(vodItem);
            return;
        }

        this.playVod(vodItem);
    }

    async stopExternalPlayback(): Promise<void> {
        await this.externalPlayback.closeSession(this.matchedExternalPlayback());
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
        void this.playerService.openResolvedPlayback(playback, true);
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
