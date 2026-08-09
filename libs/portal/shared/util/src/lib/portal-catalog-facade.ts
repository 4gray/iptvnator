import { InjectionToken, Signal } from '@angular/core';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

export type PortalCatalogProvider = 'xtream' | 'stalker';

export type PortalCatalogSortMode =
    | 'date-desc'
    | 'date-asc'
    | 'name-asc'
    | 'name-desc'
    | 'rating-desc'
    | 'rating-asc';

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
    readonly contentType: Signal<string | null | undefined>;
    readonly selectedCategory: Signal<TCategory | null | undefined>;
    readonly paginatedContent: Signal<readonly TItem[] | undefined>;
    readonly selectedItem: Signal<TSelectedItem | null | undefined>;
    readonly isPaginatedContentLoading: Signal<boolean>;
    readonly selectedCategoryTitle: Signal<string>;
    readonly categoryItemCount: Signal<number>;
    readonly contentSortMode: Signal<PortalCatalogSortMode | null>;
    readonly playlist: Signal<PortalCatalogPlaylistMeta | null>;
    /**
     * Infinite-scroll capability. `true` means the facade grows one continuous
     * list via `loadMore()` and the catalog view renders no paginator.
     *
     * Transitional (PR 1 of the pagination removal): Xtream sets `true`;
     * Stalker still pages and leaves it unset. Once Stalker appends too, this
     * flag and the paged members below are deleted and the infinite-scroll
     * members become required.
     */
    readonly supportsInfiniteScroll?: boolean;
    readonly hasMore?: Signal<boolean>;
    /** True while an asynchronous append is in flight (tail spinner). */
    readonly isAppending?: Signal<boolean>;
    /** True when the latest append failed; the tail shows a retry action. */
    readonly appendError?: Signal<boolean>;
    loadMore?(): void;
    retryAppend?(): void;
    /**
     * Scroll-position handoff for detail round-trips: the view saves the grid
     * offset when an item opens, and consumes it (the facade restores the
     * matching list window first) when the same list is shown again. Returns
     * null when the saved position no longer matches the current selection.
     */
    saveScrollPosition?(scrollTop: number): void;
    consumeSavedScrollPosition?(): number | null;
    /**
     * Legacy paged members — only implemented while `supportsInfiniteScroll`
     * is not `true` (Stalker during the transition). Deleted in PR 2.
     */
    readonly pageSizeOptions?: readonly number[];
    readonly limit?: Signal<number>;
    readonly pageIndex?: Signal<number>;
    readonly totalPages?: Signal<number>;
    /**
     * Optional IMDb-rating capability (Xtream VOD/series). Providers without
     * structured ratings (e.g. Stalker) leave these undefined, and the rating
     * sort options + minimum-rating filter hide themselves in the UI.
     */
    readonly supportsRatingSort?: boolean;
    readonly minRating?: Signal<number | null>;

    initialize(categoryId?: string | null): void;
    setSearchQuery?(query: string): void;
    clearSelectedItem(): void;
    setPage?(page: number): void;
    setLimit?(limit: number): void;
    setContentSortMode(mode: PortalCatalogSortMode): void;
    setMinRating?(value: number | null): void;
    selectItem(item: TItem): string[] | null;
    /**
     * Optional: re-fetches a selection that was injected from a stored
     * snapshot (navigation state, favorites) so stale embedded data —
     * e.g. a Stalker embedded-series episode list — is refreshed in the
     * background. No-op for providers whose selections are always fresh.
     */
    refreshSnapshotSelection?(): void;
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
    /**
     * `linkFlags` carries the catalog row's `use_http_tmp_link` /
     * `use_load_balancing`; without it the portal is always asked for a
     * temporary link.
     *
     * The shape is spelled out rather than imported as `StalkerLinkFlagSource`
     * on purpose: this lib is `type:util`/`domain:portal-shared` and may not
     * depend on `portal-stalker-data-access` (`type:data-access`/`domain:stalker`)
     * — the Nx module-boundary rule rejects that edge.
     */
    fetchLinkToPlay(
        portalUrl: string,
        macAddress: string,
        cmd: string,
        series?: number,
        linkFlags?: { use_http_tmp_link?: unknown; use_load_balancing?: unknown }
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
