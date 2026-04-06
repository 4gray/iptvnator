import { InjectionToken, Signal } from '@angular/core';
import { ResolvedPortalPlayback } from 'shared-interfaces';

export type PortalCatalogProvider = 'xtream' | 'stalker';

export type PortalCatalogSortMode =
    | 'date-desc'
    | 'date-asc'
    | 'name-asc'
    | 'name-desc';

export interface PortalCatalogPlaylistMeta {
    id: string;
    title?: string;
    portalUrl?: string;
    macAddress?: string;
    userAgent?: string;
    referer?: string;
    origin?: string;
}

export interface PortalCatalogItemProgress {
    progress?: number;
    isWatched?: boolean;
    hasSeriesProgress?: boolean;
}

export interface PortalCatalogFacade<
    TCategory = unknown,
    TItem = unknown,
    TSelectedItem = unknown,
> {
    readonly provider: PortalCatalogProvider;
    readonly pageSizeOptions: readonly number[];
    readonly contentType: Signal<string | null | undefined>;
    readonly limit: Signal<number>;
    readonly pageIndex: Signal<number>;
    readonly selectedCategory: Signal<TCategory | null | undefined>;
    readonly paginatedContent: Signal<readonly TItem[] | undefined>;
    readonly selectedItem: Signal<TSelectedItem | null | undefined>;
    readonly totalPages: Signal<number>;
    readonly isPaginatedContentLoading: Signal<boolean>;
    readonly selectedCategoryTitle: Signal<string>;
    readonly categoryItemCount: Signal<number>;
    readonly contentSortMode: Signal<PortalCatalogSortMode | null>;
    readonly playlist: Signal<PortalCatalogPlaylistMeta | null>;

    initialize(categoryId?: string | null): void;
    setSearchQuery?(query: string): void;
    clearSelectedItem(): void;
    setPage(page: number): void;
    setLimit(limit: number): void;
    setContentSortMode(mode: PortalCatalogSortMode): void;
    selectItem(item: TItem): string[] | null;
    getItemProgress(item: TItem): PortalCatalogItemProgress;
}

export interface StalkerPortalCatalogFacade<
    TCategory = unknown,
    TItem = unknown,
    TSelectedItem = unknown,
> extends PortalCatalogFacade<TCategory, TItem, TSelectedItem> {
    readonly provider: 'stalker';

    createLinkToPlayVod(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ): Promise<void>;
    addToFavorites(item: Record<string, unknown>, onDone?: () => void): void;
    removeFromFavorites(favoriteId: string, onDone?: () => void): void;
    fetchMovieFileId(itemId: string): Promise<string | null>;
    fetchLinkToPlay(
        portalUrl: string,
        macAddress: string,
        cmd: string
    ): Promise<string>;
    resolveVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<ResolvedPortalPlayback>;
}

export const PORTAL_CATALOG_FACADE = new InjectionToken<PortalCatalogFacade>(
    'PORTAL_CATALOG_FACADE'
);

export function isStalkerPortalCatalogFacade(
    facade: PortalCatalogFacade
): facade is StalkerPortalCatalogFacade {
    return facade.provider === 'stalker';
}
