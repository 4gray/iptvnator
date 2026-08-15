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
    isStalkerSeriesFlag,
    StalkerLinkFlagSource,
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
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

    const percent = (position.positionSeconds / position.durationSeconds) * 100;

    if (position.positionSeconds > 10 && percent < 1) {
        return 1;
    }

    return Math.min(100, Math.round(percent));
}

@Injectable()
export class StalkerCatalogFacadeService implements StalkerPortalCatalogFacade<
    Record<string, unknown>,
    StalkerVodSource,
    StalkerVodSource
> {
    private readonly stalkerStore = inject(StalkerStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    private readonly destroyRef = inject(DestroyRef);
    private readonly stalkerPositions = signal<
        Map<string, PlaybackPositionData>
    >(new Map());
    private readonly stalkerSeriesPositions = signal<
        Map<number, PlaybackPositionData[]>
    >(new Map());
    private loadedPositionsForPlaylistId: string | null = null;
    // Latest-load-wins: a positions fetch superseded while in flight must
    // not patch the maps with another playlist's rows.
    private positionsLoadGeneration = 0;

    readonly provider = 'stalker' as const;
    readonly contentType = this.stalkerStore.selectedContentType;
    readonly selectedCategory = this.stalkerStore.getSelectedCategory;
    readonly paginatedContent = computed(
        () => this.stalkerStore.getPaginatedContent() ?? []
    );
    readonly selectedItem = this.stalkerStore.selectedItem;
    /**
     * The store's loading flag covers every portal page; the grid skeleton
     * belongs to the first page only — appends surface as the tail spinner.
     */
    readonly isPaginatedContentLoading = computed(
        () =>
            this.stalkerStore.isPaginatedContentLoading() &&
            this.stalkerStore.page() === 0
    );
    readonly isAppending = computed(
        () =>
            this.stalkerStore.isPaginatedContentLoading() &&
            this.stalkerStore.page() > 0
    );
    readonly hasMore = this.stalkerStore.hasMoreContent;
    readonly appendError = this.stalkerStore.hasContentAppendError;
    /**
     * Scroll offsets per list identity for inline-detail round trips. The
     * accumulated portal pages already survive in the store (same-category
     * re-initialisation is a no-op), so only the offset needs a home here.
     * Bounded like the Xtream store's snapshot list.
     */
    private readonly savedScrollPositions = new Map<string, number>();
    readonly selectedCategoryTitle = computed(() => {
        const category = this.selectedCategory();
        const fromCategory = category
            ? String(category.category_name ?? '')
            : '';

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

        const unsubscribe =
            this.playbackPositionBridge.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    if (
                        !data.playlistId ||
                        data.playlistId !== this.playlist()?.id
                    ) {
                        return;
                    }

                    void this.playbackPositions.savePlaybackPosition(
                        data.playlistId,
                        data
                    );

                    if (data.contentType === 'vod') {
                        this.updateVodPlaybackPosition(data);
                    }

                    if (data.contentType === 'episode' && data.seriesXtreamId) {
                        this.updateSeriesPlaybackPosition(data);
                    }
                }
            );

        if (unsubscribe) {
            this.destroyRef.onDestroy(unsubscribe);
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

    loadMore(): void {
        if (
            this.stalkerStore.isPaginatedContentLoading() ||
            // A failed append blocks further paging — skipping past the
            // failed portal page would leave a silent hole in the list; the
            // grid tail's retry re-runs it instead.
            this.stalkerStore.hasContentAppendError() ||
            !this.stalkerStore.hasMoreContent()
        ) {
            return;
        }

        this.stalkerStore.nextPage();
    }

    retryAppend(): void {
        void this.stalkerStore.retryContentPage();
    }

    saveScrollPosition(scrollTop: number): void {
        const key = this.scrollIdentity();
        // Re-insert so Map order stays oldest-first for the bound below.
        this.savedScrollPositions.delete(key);
        this.savedScrollPositions.set(key, scrollTop);
        if (this.savedScrollPositions.size > 8) {
            const oldestKey = this.savedScrollPositions.keys().next().value;
            if (oldestKey !== undefined) {
                this.savedScrollPositions.delete(oldestKey);
            }
        }
    }

    consumeSavedScrollPosition(): number | null {
        const key = this.scrollIdentity();
        const saved = this.savedScrollPositions.get(key);
        if (saved === undefined) {
            return null;
        }

        this.savedScrollPositions.delete(key);
        return saved;
    }

    setContentSortMode(mode: PortalCatalogSortMode): void {
        void mode;
        // Stalker catalog content is server-paginated and does not support local sort modes.
    }

    private scrollIdentity(): string {
        return [
            // The playlist belongs to the identity: the route provider (and
            // this map with it) survives a same-config portal switch, and a
            // portal A offset must never restore onto portal B's catalog.
            this.stalkerStore.currentPlaylist()?._id ?? '',
            this.stalkerStore.selectedContentType(),
            String(this.stalkerStore.selectedCategoryId() ?? ''),
            this.stalkerStore.searchPhrase(),
        ].join('|');
    }

    selectItem(item: StalkerVodSource): string[] | null {
        const needsSeriesFetch =
            this.contentType() === 'vod' && isStalkerSeriesFlag(item.is_series);

        this.stalkerStore.setSelectedItem(
            buildStalkerSelectedVodItem(item, needsSeriesFetch)
        );
        return null;
    }

    refreshSnapshotSelection(): void {
        void this.stalkerStore.refreshEmbeddedSeriesSelection();
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
            isStalkerSeriesFlag(item.is_series);

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
        cmd: string,
        series?: number,
        linkFlags?: StalkerLinkFlagSource | null
    ): Promise<string> {
        return this.stalkerStore.fetchLinkToPlay(
            portalUrl,
            macAddress,
            cmd,
            series,
            linkFlags
        );
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

    /**
     * Re-read persisted positions after a renderer-initiated mutation (the
     * season watched batch or a single toggle): the once-per-playlist load
     * cannot see them and the runtime bridge only pushes external-player
     * updates, so grid progress badges would stay stale on return.
     */
    async refreshPositions(playlistId: string): Promise<void> {
        if (this.playlist()?.id !== playlistId) {
            return;
        }
        await this.loadStalkerPositions(playlistId);
    }

    private async loadStalkerPositions(playlistId: string): Promise<void> {
        const generation = ++this.positionsLoadGeneration;
        const positions =
            await this.playbackPositions.getAllPlaybackPositions(playlistId);
        if (generation !== this.positionsLoadGeneration) {
            return;
        }

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
