import { Injectable, Provider, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
    buildStalkerSelectedVodItem,
    isStalkerSeriesFlag,
    StalkerLinkFlagSource,
    StalkerStore,
    StalkerVodSource,
    stalkerCategoryLabelText,
} from '@iptvnator/portal/stalker/data-access';
import { injectTranslationTick } from '@iptvnator/services';
import {
    PortalCatalogItemProgress,
    PortalCatalogPlaylistMeta,
    PortalCatalogSortMode,
    PORTAL_CATALOG_FACADE,
    StalkerPortalCatalogFacade,
} from '@iptvnator/portal/shared/util';
import { createStalkerCatalogPositions } from './stalker-catalog-positions';
import { createStalkerCatalogWatchFilter } from './stalker-catalog-watch-filter';
import { StalkerWorkspaceRouteSession } from './stalker-workspace-route-session.service';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

@Injectable()
export class StalkerCatalogFacadeService implements StalkerPortalCatalogFacade<
    Record<string, unknown>,
    StalkerVodSource,
    StalkerVodSource
> {
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly positions = createStalkerCatalogPositions(
        this.stalkerStore
    );
    readonly hideWatched = createStalkerCatalogWatchFilter(
        this.stalkerStore,
        this.positions
    );

    readonly provider = 'stalker' as const;
    readonly routeReady = inject(StalkerWorkspaceRouteSession).isReady;
    readonly contentType = this.stalkerStore.selectedContentType;
    readonly selectedCategory = this.stalkerStore.getSelectedCategory;
    readonly paginatedContent = this.hideWatched.items;
    readonly selectedItem = this.stalkerStore.selectedItem;
    /**
     * The store's loading flag covers every portal page; the grid skeleton
     * belongs to the first page only — appends surface as the tail spinner.
     */
    readonly isPaginatedContentLoading = computed(
        () =>
            (this.stalkerStore.isPaginatedContentLoading() ||
                this.stalkerStore.isContentRetrying()) &&
            this.stalkerStore.page() === 0
    );
    readonly isAppending = computed(
        () =>
            ((this.stalkerStore.isPaginatedContentLoading() ||
                this.stalkerStore.isContentRetrying()) &&
                this.stalkerStore.page() > 0) ||
            this.hideWatched.scanning()
    );
    readonly hasMore = this.stalkerStore.hasMoreContent;
    readonly appendError = this.stalkerStore.hasContentAppendError;
    readonly contentError = computed(
        () =>
            Boolean(this.stalkerStore.isPaginatedContentFailed()) &&
            !this.isPaginatedContentLoading()
    );

    retryContent(): void {
        void this.stalkerStore.retryContentPage();
    }
    /**
     * Scroll offsets per list identity for inline-detail round trips. The
     * accumulated portal pages already survive in the store (same-category
     * re-initialisation is a no-op), so only the offset needs a home here.
     * Bounded like the Xtream store's snapshot list.
     */
    private readonly savedScrollPositions = new Map<string, number>();
    readonly selectedCategoryTitle = computed(() => {
        // No category means every item: the view supplies that title.
        if (!this.stalkerStore.selectedCategoryId()) {
            return null;
        }
        // The store's every-item genre is named by a key, translated in the
        // current language; the tick re-runs this after a switch.
        this.languageTick();
        return stalkerCategoryLabelText(
            this.stalkerStore.getSelectedCategoryLabel(),
            (key) => this.translate.instant(key)
        );
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
        this.hideWatched.loadMore();
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
            this.hideWatched.enabled(),
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
        return this.positions.getItemProgress(item);
    }

    /** Shares accepted inline-player ticks with the retained catalog snapshot. */
    applyPlaybackPosition(position: PlaybackPositionData): void {
        this.positions.applyPosition(position);
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
        await this.positions.refresh(playlistId);
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
