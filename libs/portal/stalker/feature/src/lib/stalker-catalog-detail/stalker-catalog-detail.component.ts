import {
    Component,
    OnDestroy,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    getStalkerReturnToState,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
} from '@iptvnator/portal/shared/util';
import {
    createPortalFavoritesResource,
    createRefreshTrigger,
    isSelectedStalkerVodFavorite,
    normalizeStalkerEntityId,
    normalizeStalkerEntityIdAsNumber,
    StalkerSelectedVodItem,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import {
    type PlaybackFallbackRequest,
    VodDetailsComponent,
} from '@iptvnator/ui/playback';
import { DownloadsService, PlaylistsService } from 'services';
import {
    createStalkerVodItem,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    StalkerVodDetails,
    VodDetailsItem,
} from 'shared-interfaces';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';

interface DownloadVodData {
    id?: string | number;
    has_files?: unknown;
    info?: {
        name?: string;
        movie_image?: string;
    };
    title?: string;
}

@Component({
    selector: 'app-stalker-catalog-detail',
    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
    templateUrl: './stalker-catalog-detail.component.html',
    styles: [
        `
            :host {
                display: block;
                height: 100%;
                width: 100%;
            }
        `,
    ],
})
export class StalkerCatalogDetailComponent implements OnDestroy {
    private readonly catalog = inject(StalkerCatalogFacadeService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly router = inject(Router);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playlistService = inject(PlaylistsService);
    private readonly downloadsService = inject(DownloadsService);
    private readonly logger = createLogger('StalkerCatalogDetail');
    private readonly favoritesRefresh = createRefreshTrigger();

    readonly contentType = this.catalog.contentType;
    readonly selectedItem = computed<StalkerSelectedVodItem | null>(
        () =>
            (this.catalog.selectedItem() as StalkerSelectedVodItem | null) ??
            null
    );
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    private readonly selectedVodPosition = signal<PlaybackPositionData | null>(
        null
    );
    private lastInlineSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;

    readonly isSeriesDetail = computed(() => {
        const item = this.selectedItem();
        return Boolean(
            item &&
                (this.contentType() === 'series' ||
                    item.is_series === true ||
                    String(item.is_series) === '1')
        );
    });

    readonly vodDetailsItem = computed<VodDetailsItem | null>(() => {
        const item = this.selectedItem();
        if (!item || this.contentType() !== 'vod' || this.isSeriesDetail()) {
            return null;
        }

        return createStalkerVodItem(
            item as unknown as StalkerVodDetails,
            this.catalog.playlist()?.id ?? ''
        );
    });

    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
    );

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.catalog.playlist()?.id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly isSelectedVodFavorite = computed<boolean>(() =>
        isSelectedStalkerVodFavorite(
            this.vodDetailsItem(),
            this.portalFavorites.value() ?? []
        )
    );

    constructor() {
        effect(() => {
            const item = this.selectedItem();
            const playlistId = this.catalog.playlist()?.id;

            if (
                !item ||
                !playlistId ||
                this.contentType() !== 'vod' ||
                this.isSeriesDetail()
            ) {
                this.selectedVodPosition.set(null);
                return;
            }

            void this.loadSelectedVodPosition(playlistId, Number(item.id));
        });

        effect(() => {
            const selectedItemId = this.selectedItem()?.id;
            void selectedItemId;
            this.closeInlinePlayer();
        });

        if (window.electron?.onPlaybackPositionUpdate) {
            this.unsubscribePositionUpdates =
                window.electron.onPlaybackPositionUpdate(
                    (data: PlaybackPositionData) => {
                        const currentItem = this.selectedItem();
                        if (
                            data.contentType !== 'vod' ||
                            data.playlistId !== this.catalog.playlist()?.id ||
                            data.contentXtreamId !== Number(currentItem?.id)
                        ) {
                            return;
                        }

                        this.selectedVodPosition.set(data);
                    }
                );
        }
    }

    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    onVodResume(event: {
        item: VodDetailsItem;
        positionSeconds: number;
    }): void {
        if (event.item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                event.item.cmd,
                event.item.data.info?.name,
                event.item.data.info?.movie_image,
                event.positionSeconds
            );
        }
    }

    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) =>
                this.catalog.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.catalog.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
            },
        });
    }

    onVodBack(): void {
        const returnTo = getStalkerReturnToState(window.history.state);
        this.closeInlinePlayer();
        this.catalog.clearSelectedItem();

        if (returnTo) {
            void this.router.navigateByUrl(returnTo);
        }
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) {
            return;
        }

        const now = Date.now();
        if (now - this.lastInlineSaveTime <= 15000) {
            return;
        }

        this.lastInlineSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };

        void this.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.selectedVodPosition.set(position);
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.lastInlineSaveTime = 0;
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

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }

    async onVodDownload(item: VodDetailsItem): Promise<void> {
        if (item.type !== 'stalker') {
            return;
        }

        const playlist = this.catalog.playlist();
        if (!playlist || !playlist.portalUrl || !playlist.macAddress) {
            return;
        }

        let cmdToUse = item.cmd;
        const itemData = item.data as DownloadVodData;
        const normalizedItemId = normalizeStalkerEntityId(itemData?.id);

        if (
            itemData?.has_files !== undefined &&
            cmdToUse &&
            !cmdToUse.includes('://') &&
            cmdToUse.includes('/media/') &&
            !cmdToUse.includes('/media/file_')
        ) {
            const fileId =
                await this.catalog.fetchMovieFileId(normalizedItemId);
            if (fileId) {
                cmdToUse = `/media/file_${fileId}.mpg`;
            }
        }

        const url = await this.catalog.fetchLinkToPlay(
            playlist.portalUrl,
            playlist.macAddress,
            cmdToUse
        );
        if (!url) {
            return;
        }

        const numericId = normalizeStalkerEntityIdAsNumber(itemData?.id) ?? 0;

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: numericId,
            contentType: 'vod',
            title: itemData?.info?.name || itemData?.title || 'Unknown',
            url,
            posterUrl: itemData?.info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referer,
                origin: playlist.origin,
            },
            playlistName: playlist.title || 'Stalker Portal',
            playlistType: 'stalker',
            portalUrl: playlist.portalUrl,
            macAddress: playlist.macAddress,
        });
    }

    ngOnDestroy(): void {
        this.closeInlinePlayer();
        this.unsubscribePositionUpdates?.();
    }

    private async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        if (Number.isNaN(vodId)) {
            this.selectedVodPosition.set(null);
            return;
        }

        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );
        this.selectedVodPosition.set(position ?? null);
    }

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        try {
            const playback = await this.catalog.resolveVodPlayback(
                cmd,
                title,
                thumbnail,
                startTime
            );

            this.lastInlineSaveTime = 0;
            if (this.portalPlayer.isEmbeddedPlayer()) {
                this.inlinePlayback.set(playback);
                return;
            }

            this.closeInlinePlayer();
            void this.portalPlayer.openResolvedPlayback(playback, true);
        } catch (error) {
            this.logger.error('Failed to start inline VOD playback', error);
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.translateService.instant(
                          'PORTALS.CONTENT_NOT_AVAILABLE'
                      )
                    : this.translateService.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, null, {
                duration: 3000,
            });
        }
    }
}
