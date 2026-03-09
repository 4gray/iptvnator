import { Provider, Injectable, computed, inject } from '@angular/core';
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
    StalkerPortalCatalogFacade,
} from '@iptvnator/portal/shared/util';

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
        void item;
        return {};
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
