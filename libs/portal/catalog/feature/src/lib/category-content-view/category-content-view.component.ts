import {
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    StalkerSeriesViewComponent,
    VodDetailsComponent,
} from 'components';
import {
    GridListComponent,
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    isStalkerPortalCatalogFacade,
    PortalCatalogFacade,
    PortalCatalogSortMode,
    PORTAL_CATALOG_FACADE,
    StalkerPortalCatalogFacade,
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
import { PlaylistsService, DownloadsService } from 'services';
import {
    createStalkerVodItem,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    StalkerVodDetails,
    VodDetailsItem,
} from 'shared-interfaces';

interface CategoryContentItem {
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    [key: string]: unknown;
}

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
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    imports: [
        GridListComponent,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatPaginatorModule,
        MatTooltip,
        PlaylistErrorViewComponent,
        StalkerSeriesViewComponent,
        TranslatePipe,
        VodDetailsComponent,
    ],
})
export class CategoryContentViewComponent implements OnInit, OnDestroy {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playlistService = inject(PlaylistsService);
    private readonly downloadsService = inject(DownloadsService);
    private readonly catalog = inject(PORTAL_CATALOG_FACADE) as PortalCatalogFacade<
        CategoryContentItem,
        CategoryContentItem,
        CategoryContentItem
    >;
    private readonly stalkerCatalog:
        | StalkerPortalCatalogFacade<
              CategoryContentItem,
              CategoryContentItem,
              CategoryContentItem
          >
        | null = isStalkerPortalCatalogFacade(this.catalog)
        ? (this.catalog as StalkerPortalCatalogFacade<
              CategoryContentItem,
              CategoryContentItem,
              CategoryContentItem
          >)
        : null;
    private readonly logger = createLogger('CategoryContentView');
    private readonly favoritesRefresh = createRefreshTrigger();

    readonly isStalker = this.catalog.provider === 'stalker';

    /** Unsubscribe function for playback position updates */
    private unsubscribePositionUpdates: (() => void) | null = null;

    readonly contentType = this.catalog.contentType;
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    private lastInlineSaveTime = 0;

    readonly limit = this.catalog.limit;
    readonly pageIndex = this.catalog.pageIndex;
    readonly pageSizeOptions = Array.from(this.catalog.pageSizeOptions);
    readonly selectedCategory = this.catalog.selectedCategory;
    readonly paginatedContent = this.catalog.paginatedContent;
    readonly selectedCategoryTitle = this.catalog.selectedCategoryTitle;
    readonly categoryItemCount = this.catalog.categoryItemCount;
    readonly categoryItemSubtitle = computed(() => {
        const itemCount = this.categoryItemCount();
        return `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    });

    /** Stalker playback positions (key: `${contentType}_${id}`) */
    private readonly stalkerPositions = signal<
        Map<string, PlaybackPositionData>
    >(new Map());
    /** Stalker series positions (key: seriesId, value: episode positions) */
    private readonly stalkerSeriesPositions = signal<
        Map<number, PlaybackPositionData[]>
    >(new Map());
    /** Track which playlist we've loaded positions for */
    private loadedPositionsForPlaylistId: string | null = null;

    constructor() {
        if (this.isStalker) {
            effect(() => {
                const playlistId = this.catalog.playlist()?.id;

                if (
                    playlistId &&
                    playlistId !== this.loadedPositionsForPlaylistId
                ) {
                    this.loadedPositionsForPlaylistId = playlistId;
                    this.loadStalkerPositions(playlistId);
                }
            });

            effect(() => {
                const item = this.selectedItem();
                const playlistId = this.catalog.playlist()?.id;

                if (item && playlistId && this.contentType() === 'vod') {
                    this.loadSingleVodPosition(playlistId, Number(item.id));
                }
            });

            if (window.electron?.onPlaybackPositionUpdate) {
                this.unsubscribePositionUpdates =
                    window.electron.onPlaybackPositionUpdate(
                        (data: PlaybackPositionData) => {
                            if (
                                data.contentType === 'vod' &&
                                data.contentXtreamId
                            ) {
                                const key = `vod_${data.contentXtreamId}`;
                                const updated = new Map(
                                    this.stalkerPositions()
                                );
                                updated.set(key, data);
                                this.stalkerPositions.set(updated);
                            }
                        }
                    );
            }

            effect(() => {
                const selectedItemId = this.selectedItem()?.id;
                void selectedItemId;
                this.closeInlinePlayer();
            });
        }
    }

    readonly contentWithProgress = computed(() => {
        const items = this.paginatedContent();
        if (!items) return [];

        if (this.isStalker) {
            const positions = this.stalkerPositions();
            const seriesPositions = this.stalkerSeriesPositions();
            const contentType = this.contentType();

            return items.map((item: CategoryContentItem) => {
                const id = Number(item.id);
                const hasSeriesProgress = Boolean(
                    seriesPositions.get(id)?.length
                );
                const isSeries =
                    contentType === 'series' ||
                    item.is_series === '1' ||
                    item.is_series === 1;

                if (hasSeriesProgress) {
                    return { ...item, hasSeriesProgress: true };
                }

                if (isSeries) {
                    return { ...item, hasSeriesProgress: false };
                }

                const vodKey = `vod_${id}`;
                const vodPosition = positions.get(vodKey);
                const vodProgress = this.calculateProgress(vodPosition);
                return {
                    ...item,
                    progress: vodProgress,
                    isWatched: vodProgress >= 90,
                };
            });
        }

        return items.map((item: CategoryContentItem) => ({
            ...item,
            ...this.catalog.getItemProgress(item),
        }));
    });

    readonly isPaginatedContentLoading =
        this.catalog.isPaginatedContentLoading;
    readonly selectedItem = this.catalog.selectedItem;
    readonly totalPages = this.catalog.totalPages;
    readonly contentSortMode = this.catalog.contentSortMode;
    readonly selectedStalkerItem = computed<StalkerSelectedVodItem | null>(
        () => {
            if (!this.isStalker) {
                return null;
            }

            return (this.selectedItem() as unknown as StalkerSelectedVodItem | null) ?? null;
        }
    );

    /** Computed VodDetailsItem for the vod-details component */
    readonly vodDetailsItem = computed<VodDetailsItem | null>(() => {
        const item = this.selectedStalkerItem();
        if (!item || !this.isStalker) return null;

        return createStalkerVodItem(
            item as unknown as StalkerVodDetails,
            this.catalog.playlist()?.id ?? ''
        );
    });

    /** Playback position for the selected VOD item (Stalker) */
    readonly selectedVodPlaybackPosition = computed<number | null>(() => {
        if (!this.isStalker) return null;
        const item = this.selectedStalkerItem();
        if (!item) return null;

        const id = Number(item.id);
        const vodKey = `vod_${id}`;
        const position = this.stalkerPositions().get(vodKey);

        return position?.positionSeconds ?? null;
    });

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => (this.isStalker ? this.catalog.playlist()?.id : undefined),
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly isSelectedVodFavorite = computed<boolean>(() =>
        isSelectedStalkerVodFavorite(
            this.vodDetailsItem(),
            this.portalFavorites.value() ?? []
        )
    );

    seasons = [];

    setContentSortMode(mode: PortalCatalogSortMode): void {
        this.catalog.setContentSortMode(mode);
    }

    ngOnInit() {
        const { categoryId } = this.activatedRoute.snapshot.params;
        this.catalog.initialize(categoryId ?? null);

        if (this.isStalker) {
            const selectedCategory =
                (this.selectedCategory() as CategoryContentItem | null) ?? null;
            this.logger.warn('Stalker category init from route', {
                routeCategoryId: categoryId ?? null,
                selectedCategoryId:
                    selectedCategory?.category_id ??
                    selectedCategory?.id ??
                    null,
                selectedContentType: this.contentType(),
            });
        }
    }

    /**
     * Load all playback positions for a Stalker portal
     */
    private async loadStalkerPositions(playlistId: string): Promise<void> {
        const positions =
            await this.playbackPositions.getAllPlaybackPositions(playlistId);

        const positionsMap = new Map<string, PlaybackPositionData>();
        const seriesMap = new Map<number, PlaybackPositionData[]>();

        positions.forEach((pos) => {
            const key = `${pos.contentType}_${pos.contentXtreamId}`;
            positionsMap.set(key, pos);

            if (pos.contentType === 'episode' && pos.seriesXtreamId) {
                const existing = seriesMap.get(pos.seriesXtreamId) || [];
                existing.push(pos);
                seriesMap.set(pos.seriesXtreamId, existing);
            }
        });

        this.stalkerPositions.set(positionsMap);
        this.stalkerSeriesPositions.set(seriesMap);
    }

    /**
     * Load playback position for a single VOD item
     */
    private async loadSingleVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );

        if (position) {
            const key = `vod_${vodId}`;
            const updated = new Map(this.stalkerPositions());
            updated.set(key, position);
            this.stalkerPositions.set(updated);
        }
    }

    /**
     * Calculate progress percentage from position data
     */
    private calculateProgress(
        position: PlaybackPositionData | undefined
    ): number {
        if (!position || !position.durationSeconds) return 0;

        const percent =
            (position.positionSeconds / position.durationSeconds) * 100;

        if (position.positionSeconds > 10 && percent < 1) {
            return 1;
        }

        return Math.min(100, Math.round(percent));
    }

    onPageChange(event: PageEvent) {
        this.catalog.setPage(event.pageIndex);
        this.catalog.setLimit(event.pageSize);
    }

    onItemClick(item: CategoryContentItem) {
        const navigation = this.catalog.selectItem(item);
        if (navigation?.length) {
            this.router.navigate(navigation, {
                relativeTo: this.activatedRoute,
            });
        }
    }

    async createLinkToPlayVod(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        if (!this.stalkerCatalog) {
            return;
        }

        await this.stalkerCatalog.createLinkToPlayVod(cmd, title, thumbnail);
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.logger.debug('Add to favorites', item);
        if (this.stalkerCatalog) {
            this.stalkerCatalog.addToFavorites(item, onDone);
            return;
        }

        onDone?.();
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void) {
        this.logger.debug('Remove from favorites', favoriteId);
        if (this.stalkerCatalog) {
            this.stalkerCatalog.removeFromFavorites(favoriteId, onDone);
            return;
        }

        onDone?.();
    }

    /** Handle play from vod-details component */
    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    /** Handle resume from vod-details component */
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

    /** Handle favorite toggle from vod-details component */
    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) => this.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
            },
        });
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.closeInlinePlayer();
        this.catalog.clearSelectedItem();
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastInlineSaveTime <= 15000) return;

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

        const key = `vod_${position.contentXtreamId}`;
        const updated = new Map(this.stalkerPositions());
        updated.set(key, position);
        this.stalkerPositions.set(updated);
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

    /** Handle download from vod-details component */
    async onVodDownload(item: VodDetailsItem): Promise<void> {
        if (item.type !== 'stalker' || !this.stalkerCatalog) return;

        const playlist = this.catalog.playlist();
        if (!playlist || !playlist.portalUrl || !playlist.macAddress) return;

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
                await this.stalkerCatalog.fetchMovieFileId(normalizedItemId);
            if (fileId) {
                cmdToUse = `/media/file_${fileId}.mpg`;
            }
        }

        const url = await this.stalkerCatalog.fetchLinkToPlay(
            playlist.portalUrl,
            playlist.macAddress,
            cmdToUse
        );
        if (!url) return;

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

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        if (!this.stalkerCatalog) {
            return;
        }

        try {
            const playback = await this.stalkerCatalog.resolveVodPlayback(
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
