import { Component, inject, OnInit, OnDestroy, computed, signal, effect } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistsService } from 'services';
import {
    VodDetailsItem,
    StalkerVodDetails,
    createStalkerVodItem,
    PlaybackPositionData,
} from 'shared-interfaces';
import { GridListComponent } from '../../shared/components/grid-list/grid-list.component';
import { StalkerSeriesViewComponent } from '../../stalker/stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../../stalker/stalker.store';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { XTREAM_DATA_SOURCE } from '../data-sources';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { XtreamStore } from '../stores/xtream.store';
import {
    buildStalkerSelectedVodItem,
    createPortalFavoritesResource,
    createRefreshTrigger,
    isSelectedStalkerVodFavorite,
    toggleStalkerVodFavorite,
} from '../../stalker/stalker-vod.utils';
import { createLogger } from '../../shared/utils/logger';
import { DownloadsService } from '../../services/downloads.service';
import {
    normalizeStalkerEntityId,
    normalizeStalkerEntityIdAsNumber,
} from '../../stalker/stalker-vod.utils';

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    imports: [
        GridListComponent,
        PlaylistErrorViewComponent,
        StalkerSeriesViewComponent,
        TranslatePipe,
        VodDetailsComponent,
    ],
})
export class CategoryContentViewComponent implements OnInit, OnDestroy {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly dataSource = inject(XTREAM_DATA_SOURCE);

    readonly isStalker = this.activatedRoute.snapshot.data['api'] === 'stalker';
    private readonly logger = createLogger('CategoryContentView');
    private readonly store = this.isStalker
        ? inject(StalkerStore)
        : inject(XtreamStore);

    /** Unsubscribe function for playback position updates */
    private unsubscribePositionUpdates: (() => void) | null = null;

    readonly contentType = this.store.selectedContentType;
    private readonly playlistService = inject(PlaylistsService);
    private readonly downloadsService = inject(DownloadsService);
    private readonly favoritesRefresh = createRefreshTrigger();

    readonly limit = this.store.limit;
    readonly pageIndex = this.store.page;
    readonly pageSizeOptions = this.isStalker ? [14] : [10, 25, 50, 100];
    readonly selectedCategory = this.store.getSelectedCategory;
    readonly paginatedContent = this.store.getPaginatedContent;

    /** Stalker playback positions (key: `${contentType}_${id}`) */
    private readonly stalkerPositions = signal<Map<string, PlaybackPositionData>>(new Map());
    /** Stalker series positions (key: seriesId, value: episode positions) */
    private readonly stalkerSeriesPositions = signal<Map<number, PlaybackPositionData[]>>(new Map());
    /** Track which playlist we've loaded positions for */
    private loadedPositionsForPlaylistId: string | null = null;

    constructor() {
        // Effect to load Stalker positions when playlist becomes available
        if (this.isStalker) {
            effect(() => {
                const stalkerStore = this.store as InstanceType<typeof StalkerStore>;
                const playlist = stalkerStore.currentPlaylist();
                const playlistId = playlist?._id;

                if (playlistId && playlistId !== this.loadedPositionsForPlaylistId) {
                    this.loadedPositionsForPlaylistId = playlistId;
                    this.loadStalkerPositions(playlistId);
                }
            });

            // Effect to load position for selected VOD item (ensures fresh data after playback)
            effect(() => {
                const stalkerStore = this.store as InstanceType<typeof StalkerStore>;
                const item = this.selectedItem();
                const playlist = stalkerStore.currentPlaylist();

                if (item && playlist?._id && this.contentType() === 'vod') {
                    this.loadSingleVodPosition(playlist._id, Number(item.id));
                }
            });

            // Listen for real-time playback position updates from video player
            if (window.electron?.onPlaybackPositionUpdate) {
                this.unsubscribePositionUpdates = window.electron.onPlaybackPositionUpdate(
                    (data: PlaybackPositionData) => {
                        if (data.contentType === 'vod' && data.contentXtreamId) {
                            const key = `vod_${data.contentXtreamId}`;
                            const updated = new Map(this.stalkerPositions());
                            updated.set(key, data);
                            this.stalkerPositions.set(updated);
                        }
                    }
                );
            }
        }
    }

    readonly contentWithProgress = computed(() => {
        const items = this.store.getPaginatedContent();
        if (!items) return [];

        if (this.isStalker) {
            // Enrich Stalker items with progress data
            const positions = this.stalkerPositions();
            const seriesPositions = this.stalkerSeriesPositions();
            const contentType = this.contentType();

            return items.map((item: any) => {
                const id = Number(item.id);

                // Check if this item has series/episode progress (watched episodes)
                // This works even when is_series flag isn't set on the item
                const hasSeriesProgress = seriesPositions.has(id) && seriesPositions.get(id)!.length > 0;

                // For series content type, or items with is_series flag
                const isSeries = contentType === 'series' || item.is_series === '1' || item.is_series === 1;

                if (hasSeriesProgress) {
                    return { ...item, hasSeriesProgress: true };
                } else if (isSeries) {
                    return { ...item, hasSeriesProgress: false };
                } else {
                    // Regular VOD item
                    const vodKey = `vod_${id}`;
                    const vodPosition = positions.get(vodKey);
                    const vodProgress = this.calculateProgress(vodPosition);
                    return {
                        ...item,
                        progress: vodProgress,
                        isWatched: vodProgress >= 90,
                    };
                }
            });
        }

        const xtreamStore = this.store as any;
        if (!xtreamStore.getProgressPercent) return items;

        return items.map((item: any) => {
            const isSeries = this.contentType() === 'series';
            const id = Number(item.xtream_id || item.series_id || item.stream_id);

            if (isSeries) {
                return {
                    ...item,
                    hasSeriesProgress: xtreamStore.hasSeriesProgress(id),
                };
            } else {
                return {
                    ...item,
                    progress: xtreamStore.getProgressPercent(id, 'vod'),
                    isWatched: xtreamStore.isWatched(id, 'vod'),
                };
            }
        });
    });

    readonly isPaginatedContentLoading = this.store.isPaginatedContentLoading;
    readonly selectedItem = this.store.selectedItem;
    readonly totalPages = this.store.getTotalPages;
    readonly bigStore = inject(Store);

    /** Computed VodDetailsItem for the vod-details component */
    readonly vodDetailsItem = computed<VodDetailsItem | null>(() => {
        const item = this.selectedItem();
        if (!item || !this.isStalker) return null;
        // Access currentPlaylist from the store (type-safe since we're in stalker mode)
        const stalkerStore = this.store as unknown as {
            currentPlaylist: () => { _id: string } | null;
        };
        return createStalkerVodItem(
            item as StalkerVodDetails,
            stalkerStore.currentPlaylist()?._id ?? ''
        );
    });

    /** Playback position for the selected VOD item (Stalker) */
    readonly selectedVodPlaybackPosition = computed<number | null>(() => {
        if (!this.isStalker) return null;
        const item = this.selectedItem();
        if (!item) return null;

        const id = Number(item.id);
        const vodKey = `vod_${id}`;
        const position = this.stalkerPositions().get(vodKey);

        return position?.positionSeconds ?? null;
    });

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => {
            if (!this.isStalker) return undefined;
            const stalkerStore = this.store as InstanceType<typeof StalkerStore>;
            return stalkerStore.currentPlaylist()?._id;
        },
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly isSelectedVodFavorite = computed<boolean>(() =>
        isSelectedStalkerVodFavorite(
            this.vodDetailsItem(),
            this.portalFavorites.value() ?? []
        )
    );

    seasons = [];

    ngOnInit() {
        const { categoryId } = this.activatedRoute.snapshot.params;

        // Ensure playback positions are loaded (Xtream only - Stalker is handled via effect in constructor)
        if (!this.isStalker) {
            const xtreamStore = this.store as any;
            if (xtreamStore.currentPlaylist()?.id) {
                xtreamStore.loadAllPositions(xtreamStore.currentPlaylist().id);
            }
        }

        // Clear any previous selectedItem when entering category view
        // This ensures the content-header is visible
        this.store.setSelectedItem(null);

        // Set category - setSelectedCategory only resets page if category actually changes
        // This preserves the page state when navigating back from detail view
        if (categoryId) {
            this.store.setSelectedCategory(categoryId);
        } else {
            // No categoryId in route means "All Items"
            this.store.setSelectedCategory(null);
        }
    }

    /**
     * Load all playback positions for a Stalker portal
     */
    private async loadStalkerPositions(playlistId: string): Promise<void> {
        const positions = await this.dataSource.getAllPlaybackPositions(playlistId);

        const positionsMap = new Map<string, PlaybackPositionData>();
        const seriesMap = new Map<number, PlaybackPositionData[]>();

        positions.forEach((pos) => {
            const key = `${pos.contentType}_${pos.contentXtreamId}`;
            positionsMap.set(key, pos);

            // Group episodes by series ID
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
    private async loadSingleVodPosition(playlistId: string, vodId: number): Promise<void> {
        const position = await this.dataSource.getPlaybackPosition(playlistId, vodId, 'vod');

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
    private calculateProgress(position: PlaybackPositionData | undefined): number {
        if (!position || !position.durationSeconds) return 0;

        const percent = (position.positionSeconds / position.durationSeconds) * 100;

        // If watched > 10s but percent < 1, return 1 to show visual progress
        if (position.positionSeconds > 10 && percent < 1) {
            return 1;
        }

        return Math.min(100, Math.round(percent));
    }

    onPageChange(event: PageEvent) {
        this.store.setPage(event.pageIndex);
        this.store.setLimit(event.pageSize);
        localStorage.setItem('xtream-page-size', event.pageSize.toString());
    }

    onItemClick(item: any) {
        const selectedItem = buildStalkerSelectedVodItem(
            item,
            this.contentType() === 'vod' &&
                (item.is_series === '1' || item.is_series === 1)
        );

        if (this.isStalker) {
            this.store.setSelectedItem(selectedItem);
        } else {
            // When viewing "Recently Added" (no category selected), include category_id in path
            const categoryId = this.store.selectedCategoryId();
            if (categoryId) {
                this.router.navigate([item.xtream_id], {
                    relativeTo: this.activatedRoute,
                });
            } else {
                this.router.navigate([item.category_id, item.xtream_id], {
                    relativeTo: this.activatedRoute,
                });
            }
        }
    }

    async createLinkToPlayVod(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        await this.store.createLinkToPlayVod(cmd, title, thumbnail);
    }

    addToFavorites(item: any, onDone?: () => void) {
        this.logger.debug('Add to favorites', item);
        if (this.isStalker) {
            (this.store as InstanceType<typeof StalkerStore>).addToFavorites(
                item,
                onDone
            );
            return;
        }
        this.store.addToFavorites(item);
        onDone?.();
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void) {
        this.logger.debug('Remove from favorites', favoriteId);
        if (this.isStalker) {
            (this.store as InstanceType<typeof StalkerStore>).removeFromFavorites(
                favoriteId,
                onDone
            );
            return;
        }
        this.store.removeFromFavorites(favoriteId);
        onDone?.();
    }

    /** Handle play from vod-details component */
    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            this.createLinkToPlayVod(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    /** Handle resume from vod-details component */
    onVodResume(event: { item: VodDetailsItem; positionSeconds: number }): void {
        if (event.item.type === 'stalker') {
            const stalkerStore = this.store as InstanceType<typeof StalkerStore>;
            stalkerStore.createLinkToPlayVod(
                event.item.cmd,
                event.item.data.info?.name,
                event.item.data.info?.movie_image,
                undefined, // episodeNum
                undefined, // episodeId
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
        this.store.setSelectedItem(null);
    }

    /** Handle download from vod-details component */
    async onVodDownload(item: VodDetailsItem): Promise<void> {
        if (item.type !== 'stalker') return;

        const stalkerStore = this.store as InstanceType<typeof StalkerStore>;
        const playlist = stalkerStore.currentPlaylist();
        if (!playlist || !playlist.portalUrl || !playlist.macAddress) return;

        let cmdToUse = item.cmd;
        const itemData = item.data as any;
        const normalizedItemId = normalizeStalkerEntityId(itemData?.id);

        // Align with playback path: resolve has_files references to /media/file_{id}.mpg
        if (
            itemData?.has_files !== undefined &&
            cmdToUse &&
            !cmdToUse.includes('://') &&
            cmdToUse.includes('/media/') &&
            !cmdToUse.includes('/media/file_')
        ) {
            const fileId = await stalkerStore.fetchMovieFileId(normalizedItemId);
            if (fileId) {
                cmdToUse = `/media/file_${fileId}.mpg`;
            }
        }

        const url = await stalkerStore.fetchLinkToPlay(
            playlist.portalUrl,
            playlist.macAddress,
            cmdToUse
        );
        if (!url) return;

        const numericId =
            normalizeStalkerEntityIdAsNumber(itemData?.id) ?? 0;

        await this.downloadsService.startDownload({
            playlistId: playlist._id,
            xtreamId: numericId,
            contentType: 'vod',
            title: itemData?.info?.name || itemData?.title || 'Unknown',
            url,
            posterUrl: itemData?.info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
            // Playlist info for auto-creation (Stalker playlists)
            playlistName: playlist.title || 'Stalker Portal',
            playlistType: 'stalker',
            portalUrl: playlist.portalUrl,
            macAddress: playlist.macAddress,
        });
    }

    ngOnDestroy(): void {
        this.unsubscribePositionUpdates?.();
    }
}
