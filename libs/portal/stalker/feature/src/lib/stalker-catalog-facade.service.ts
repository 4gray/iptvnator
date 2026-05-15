import {
    DestroyRef,
    Injectable,
    Provider,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import {
    buildStalkerSelectedVodItem,
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    PortalCatalogItemProgress,
    PortalCatalogPlaylistMeta,
    PortalCatalogSortMode,
    PORTAL_CATALOG_FACADE,
    PORTAL_PLAYBACK_POSITIONS,
    StalkerPortalCatalogFacade,
} from '@iptvnator/portal/shared/util';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';

function calculateProgress(position: PlaybackPositionData | undefined): number {
    if (!position || !position.durationSeconds) {
        return 0;
    }

    const percent =
        (position.positionSeconds / position.durationSeconds) * 100;

    if (position.positionSeconds > 10 && percent < 1) {
        return 1;
    }

    return Math.min(100, Math.round(percent));
}

@Injectable()
export class StalkerCatalogFacadeService
    implements
        StalkerPortalCatalogFacade<
            Record<string, unknown>,
            StalkerVodSource,
            StalkerVodSource
        >
{
    private readonly stalkerStore = inject(StalkerStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly destroyRef = inject(DestroyRef);
    private readonly stalkerPositions = signal<Map<string, PlaybackPositionData>>(
        new Map()
    );
    private readonly stalkerSeriesPositions = signal<
        Map<number, PlaybackPositionData[]>
    >(new Map());
    private loadedPositionsForPlaylistId: string | null = null;

    readonly provider = 'stalker' as const;
    readonly pageSizeOptions = [14] as const;
    readonly contentType = this.stalkerStore.selectedContentType;
    readonly limit = this.stalkerStore.limit;
    readonly pageIndex = this.stalkerStore.page;
    readonly selectedCategory = this.stalkerStore.getSelectedCategory;
    readonly paginatedContent = computed(
        () => this.stalkerStore.getPaginatedContent() ?? []
    );
    readonly selectedItem = this.stalkerStore.selectedItem;
    readonly totalPages = this.stalkerStore.getTotalPages;
    readonly isPaginatedContentLoading =
        this.stalkerStore.isPaginatedContentLoading;
    readonly selectedCategoryTitle = computed(() => {
        const category = this.selectedCategory();
        const fromCategory = String(
            category?.['category_name'] ?? category?.['name'] ?? ''
        );

        if (fromCategory) {
            return fromCategory;
        }

        return this.stalkerStore.getSelectedCategoryName() ?? '';
    });
    readonly categoryItemCount = computed(() => this.stalkerStore.totalCount());
    readonly contentSortMode = computed<PortalCatalogSortMode | null>(
        () => null
    );
    readonly playlist = computed<PortalCatalogPlaylistMeta | null>(() => {
        const playlist = this.stalkerStore.currentPlaylist();
        if (!playlist?._id) {
            return null;
        }

        return {
            id: playlist._id,
            title: playlist.title ?? 'Stalker Portal',
            portalUrl: playlist.portalUrl,
            macAddress: playlist.macAddress,
            userAgent: playlist.userAgent,
            referer: playlist.referrer,
            origin: playlist.origin,
        };
    });

    constructor() {
        effect(() => {
            const playlistId = this.playlist()?.id;

            if (!playlistId) {
                this.loadedPositionsForPlaylistId = null;
                this.stalkerPositions.set(new Map());
                this.stalkerSeriesPositions.set(new Map());
                return;
            }

            if (playlistId === this.loadedPositionsForPlaylistId) {
                return;
            }

            this.loadedPositionsForPlaylistId = playlistId;
            void this.loadStalkerPositions(playlistId);
        });

        if (window.electron?.onPlaybackPositionUpdate) {
            const unsubscribe = window.electron.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    if (data.playlistId !== this.playlist()?.id) {
                        return;
                    }

                    void this.playbackPositions.savePlaybackPosition(
                        data.playlistId,
                        data
                    );

                    if (data.contentType === 'vod') {
                        this.updateVodPlaybackPosition(data);
                    }

                    if (
                        data.contentType === 'episode' &&
                        data.seriesXtreamId
                    ) {
                        this.updateSeriesPlaybackPosition(data);
                    }
                }
            );

            if (typeof unsubscribe === 'function') {
                this.destroyRef.onDestroy(unsubscribe);
            }
        }
    }

    initialize(categoryId?: string | null): void {
        this.clearSelectedItem();
        if (categoryId) {
            this.stalkerStore.setSelectedCategory(categoryId);
            return;
        }

        this.stalkerStore.setSelectedCategory('*');
    }

    clearSelectedItem(): void {
        this.stalkerStore.clearSelectedItem();
    }

    setSearchQuery(query: string): void {
        this.stalkerStore.setSearchPhrase(query);
    }

    setPage(page: number): void {
        this.stalkerStore.setPage(page);
    }

    setLimit(limit: number): void {
        this.stalkerStore.setLimit(limit);
    }

    setContentSortMode(mode: PortalCatalogSortMode): void {
        void mode;
        // Stalker catalog content is server-paginated and does not support local sort modes.
    }

    selectItem(item: StalkerVodSource): string[] | null {
        const needsSeriesFetch =
            this.contentType() === 'vod' &&
            (item.is_series === '1' || item.is_series === 1);

        this.stalkerStore.setSelectedItem(
            buildStalkerSelectedVodItem(item, needsSeriesFetch)
        );
        return null;
    }

    getItemProgress(item: StalkerVodSource): PortalCatalogItemProgress {
        const numericId = Number(item.id);
        if (Number.isNaN(numericId)) {
            return {};
        }

        const hasSeriesProgress = Boolean(
            this.stalkerSeriesPositions().get(numericId)?.length
        );
        const isSeries =
            this.contentType() === 'series' ||
            item.is_series === '1' ||
            item.is_series === 1;

        if (hasSeriesProgress) {
            return { hasSeriesProgress: true };
        }

        if (isSeries) {
            return { hasSeriesProgress: false };
        }

        const progress = calculateProgress(
            this.stalkerPositions().get(`vod_${numericId}`)
        );
        return {
            progress,
            isWatched: progress >= 90,
        };
    }

    async createLinkToPlayVod(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ): Promise<void> {
        await this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void): void {
        this.stalkerStore.addToFavorites(item, onDone);
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void): void {
        this.stalkerStore.removeFromFavorites(favoriteId, onDone);
    }

    fetchMovieFileId(itemId: string): Promise<string | null> {
        return this.stalkerStore.fetchMovieFileId(itemId);
    }

    async fetchLinkToPlay(
        portalUrl: string,
        macAddress: string,
        cmd: string
    ): Promise<string> {
        return this.stalkerStore.fetchLinkToPlay(portalUrl, macAddress, cmd);
    }

    resolveVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ) {
        return this.stalkerStore.resolveVodPlayback(
            cmd,
            title,
            thumbnail,
            undefined,
            undefined,
            startTime
        );
    }

    private async loadStalkerPositions(playlistId: string): Promise<void> {
        const positions =
            await this.playbackPositions.getAllPlaybackPositions(playlistId);

        const positionsMap = new Map<string, PlaybackPositionData>();
        const seriesMap = new Map<number, PlaybackPositionData[]>();

        positions.forEach((position) => {
            positionsMap.set(
                `${position.contentType}_${position.contentXtreamId}`,
                position
            );

            if (position.contentType === 'episode' && position.seriesXtreamId) {
                const existing = seriesMap.get(position.seriesXtreamId) ?? [];
                existing.push(position);
                seriesMap.set(position.seriesXtreamId, existing);
            }
        });

        this.stalkerPositions.set(positionsMap);
        this.stalkerSeriesPositions.set(seriesMap);
    }

    private updateVodPlaybackPosition(position: PlaybackPositionData): void {
        const updated = new Map(this.stalkerPositions());
        updated.set(`vod_${position.contentXtreamId}`, position);
        this.stalkerPositions.set(updated);
    }

    private updateSeriesPlaybackPosition(position: PlaybackPositionData): void {
        if (!position.seriesXtreamId) {
            return;
        }

        const updated = new Map(this.stalkerSeriesPositions());
        const positionsForSeries = [
            ...(updated.get(position.seriesXtreamId) ?? []).filter(
                (item) => item.contentXtreamId !== position.contentXtreamId
            ),
            position,
        ];
        updated.set(position.seriesXtreamId, positionsForSeries);
        this.stalkerSeriesPositions.set(updated);
    }
}

export function provideStalkerCatalogFacade(): Provider[] {
    return [
        StalkerCatalogFacadeService,
        {
            provide: PORTAL_CATALOG_FACADE,
            useExisting: StalkerCatalogFacadeService,
        },
    ];
}
