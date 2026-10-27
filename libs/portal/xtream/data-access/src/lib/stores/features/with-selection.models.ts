import type { PortalWatchStateFilter } from '@iptvnator/portal/shared/util/tokens';
import { ContentType, XtreamContentLoadState } from '../../xtream-state';

export type XtreamCategorySortMode =
    | 'date-desc'
    | 'date-asc'
    | 'name-asc'
    | 'name-desc'
    | 'rating-desc'
    | 'rating-asc';

/**
 * First render window of the infinite-scroll catalog grid. Growing the window
 * is a free in-memory slice, so the initial batch is a generous constant — the
 * shared scroll directive tops it up by measuring container overflow rather
 * than by computing card counts from the viewport.
 */
export const CATALOG_INITIAL_WINDOW = 50;

/** How many more items each `loadMoreContent()` reveals. */
export const CATALOG_WINDOW_CHUNK = 50;

/**
 * Grid scroll position captured when a list view goes away (detail opened,
 * tab switched), so returning to the same list restores both the render
 * window and the scroll offset. The selection coordinates identify the
 * snapshot: only an exact match may restore it.
 */
export interface CatalogScrollState {
    contentType: ContentType;
    categoryId: number | null;
    searchTerm: string;
    sortMode: XtreamCategorySortMode;
    minRating: number | null;
    watchStateFilter: PortalWatchStateFilter;
    visibleCount: number;
    scrollTop: number;
}

/**
 * Snapshots are kept per selection identity (one slot would let a tab detour
 * — VOD → Series → VOD — overwrite the first tab's spot with the second's on
 * destroy). Bounded so a long browsing session cannot accumulate one entry
 * per category visited.
 */
export const MAX_SAVED_CATALOG_SCROLLS = 8;

/**
 * Selection state for managing UI selection and the infinite-scroll window
 */
export interface SelectionState {
    selectedContentType: ContentType;
    selectedCategoryId: number | null;
    selectedItem: XtreamSelectionItem | null;
    visibleCount: number;
    savedCatalogScrolls: CatalogScrollState[];
    contentSortMode: XtreamCategorySortMode;
    categorySearchTerm: string;
    minRating: number | null;
    watchStateFilter: PortalWatchStateFilter;
    isLoadingDetails: boolean;
    detailsError: string | null;
}

/**
 * Initial selection state
 */
export const initialSelectionState: SelectionState = {
    selectedContentType: 'vod',
    selectedCategoryId: null,
    selectedItem: null,
    visibleCount: CATALOG_INITIAL_WINDOW,
    savedCatalogScrolls: [],
    contentSortMode: 'date-desc',
    categorySearchTerm: '',
    minRating: null,
    watchStateFilter: null,
    isLoadingDetails: false,
    detailsError: null,
};

export const matchesCurrentSelection = (
    snapshot: CatalogScrollState,
    current: Omit<CatalogScrollState, 'visibleCount' | 'scrollTop'>
): boolean =>
    snapshot.contentType === current.contentType &&
    snapshot.categoryId === current.categoryId &&
    snapshot.searchTerm === current.searchTerm &&
    snapshot.sortMode === current.sortMode &&
    snapshot.minRating === current.minRating &&
    snapshot.watchStateFilter === current.watchStateFilter;

export interface XtreamSelectionCategory {
    readonly [key: string]: unknown;
    readonly category_name?: string;
    readonly category_id?: string | number;
    readonly id?: string | number;
    readonly name?: string;
    readonly type?: ContentType;
    readonly hidden?: boolean;
}

export interface XtreamSelectionItem {
    readonly [key: string]: unknown;
    readonly added?: string;
    readonly category_id?: string | number;
    readonly episodes?: unknown;
    readonly id?: string | number;
    readonly info?:
        | {
              readonly actors?: string;
              readonly backdrop_path?: string[];
              readonly cast?: string;
              readonly country?: string;
              readonly cover?: string;
              readonly description?: string;
              readonly director?: string;
              readonly duration?: string;
              readonly episode_run_time?: number | string;
              readonly genre?: string;
              readonly movie_image?: string;
              readonly name?: string;
              readonly plot?: string;
              readonly rating?: number | string;
              readonly rating_imdb?: string;
              readonly rating_kinopoisk?: string;
              readonly releaseDate?: string;
              readonly releasedate?: string;
              readonly youtube_trailer?: string;
          }
        | []
        | null;
    readonly last_modified?: string;
    readonly movie_data?: {
        readonly name?: string;
    };
    readonly name?: string;
    readonly series_id?: string | number;
    readonly stream_id?: string | number;
    readonly title?: string;
    readonly xtream_id?: number;
}

export type ParentSelectionStoreLike = {
    contentLoadStateByType?: () => Record<ContentType, XtreamContentLoadState>;
    isLoadingContent?: () => boolean;
    liveCategories?: () => XtreamSelectionCategory[];
    liveStreams?: () => XtreamSelectionItem[];
    serialCategories?: () => XtreamSelectionCategory[];
    serialStreams?: () => XtreamSelectionItem[];
    vodCategories?: () => XtreamSelectionCategory[];
    vodStreams?: () => XtreamSelectionItem[];
};
