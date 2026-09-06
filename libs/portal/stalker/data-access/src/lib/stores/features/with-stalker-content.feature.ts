import { computed, inject, resource } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService, resetHostConnectivityGuard } from '@iptvnator/services';
import {
    StalkerCategoryItem,
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerItvCacheService } from '../../stalker-itv-cache.service';
import { StalkerPortalRepairService } from '../../stalker-portal-repair.service';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    ResourceState,
    StalkerCategorySliceContract,
    StalkerContentFeatureStoreContract,
    StalkerContentType,
} from '../stalker-store.contracts';
import {
    executeStalkerRequest,
    filterItvChannelsByGenre,
    toStalkerContentItem,
    toStalkerItvChannel,
} from '../utils';

/**
 * Content/categories/channels feature state.
 */
export interface StalkerContentState {
    totalCount: number;
    vodCategories: StalkerCategoryItem[];
    seriesCategories: StalkerCategoryItem[];
    itvCategories: StalkerCategoryItem[];
    radioCategories: StalkerCategoryItem[];
    hasMoreChannels: boolean;
    itvChannels: StalkerItvChannel[];
    radioChannels: StalkerItvChannel[];
    paginatedContent: StalkerContentItem[];
    categoryError: unknown;
    contentError: unknown;
    /**
     * A failed append (portal page > 1). Kept separate from `contentError`
     * so already-accumulated pages stay on screen and the grid tail can
     * offer a retry instead of collapsing to the empty state.
     */
    appendError: unknown;
}

const initialContentState: StalkerContentState = {
    totalCount: 0,
    vodCategories: [],
    seriesCategories: [],
    itvCategories: [],
    radioCategories: [],
    hasMoreChannels: false,
    itvChannels: [],
    radioChannels: [],
    paginatedContent: [],
    categoryError: null,
    contentError: null,
    appendError: null,
};

interface StalkerCategoryResponseItem {
    id?: string | number;
    title?: string;
    censored?: string | number;
}

interface StalkerCategoryResponse {
    js?: StalkerCategoryResponseItem[];
}

interface StalkerOrderedListResponse {
    js?: {
        data?: StalkerVodSource[];
        total_items?: number;
    };
}

interface StalkerContentResourceStoreContract extends StalkerContentFeatureStoreContract {
    categoryResource: ResourceState<StalkerCategoryItem[]>;
    getContentResource: ResourceState<StalkerContentItem[]>;
}

function getCategoriesByType(
    store: StalkerCategorySliceContract,
    contentType: StalkerContentType
): StalkerCategoryItem[] {
    switch (contentType) {
        case 'vod':
            return store.vodCategories();
        case 'series':
            return store.seriesCategories();
        case 'itv':
            return store.itvCategories();
        case 'radio':
            return store.radioCategories();
    }
}

function buildCategoryPatch(
    contentType: StalkerContentType,
    categories: StalkerCategoryItem[]
): Partial<StalkerContentState> {
    switch (contentType) {
        case 'vod':
            return { vodCategories: categories };
        case 'series':
            return { seriesCategories: categories };
        case 'itv':
            return { itvCategories: categories };
        case 'radio':
            return { radioCategories: categories };
    }
}

function buildAllCategory(
    contentType: StalkerContentType,
    translateService: TranslateService
): StalkerCategoryItem {
    return {
        category_name: translateService.instant(
            contentType === 'radio'
                ? 'PORTALS.ALL_RADIO'
                : 'PORTALS.ALL_CATEGORIES'
        ),
        category_id: '*',
    };
}

function prependAllCategory(
    contentType: StalkerContentType,
    categories: StalkerCategoryItem[],
    translateService: TranslateService
): StalkerCategoryItem[] {
    const allIndex = categories.findIndex(
        (category) => category.category_name.trim().toLowerCase() === 'all'
    );

    if (allIndex > 0) {
        categories.unshift(categories.splice(allIndex, 1)[0]);
        return categories;
    }

    if (
        allIndex === -1 &&
        categories.length > 0 &&
        !categories.some((category) => String(category.category_id) === '*')
    ) {
        categories.unshift(buildAllCategory(contentType, translateService));
    }

    return categories;
}

function fallbackRadioCategories(
    translateService: TranslateService
): StalkerCategoryItem[] {
    return [buildAllCategory('radio', translateService)];
}

function buildEmptyContentPatch(
    contentType: StalkerContentType,
    error: unknown
): Partial<StalkerContentState> {
    const patch: Partial<StalkerContentState> = {
        totalCount: 0,
        paginatedContent: [],
        contentError: error,
        appendError: null,
    };

    if (contentType === 'itv' || contentType === 'radio') {
        patch.hasMoreChannels = false;
        if (contentType === 'itv') {
            patch.itvChannels = [];
        } else {
            patch.radioChannels = [];
        }
    }

    return patch;
}

/**
 * Portals can shift items between pages while the list is being appended —
 * a duplicate id would render the same card twice and break `track` hints.
 */
function dedupeContentById(items: StalkerContentItem[]): StalkerContentItem[] {
    const seenIds = new Set<string>();
    return items.filter((item) => {
        const id =
            item.id === undefined || item.id === null ? null : String(item.id);
        if (id === null) {
            return true;
        }
        if (seenIds.has(id)) {
            return false;
        }
        seenIds.add(id);
        return true;
    });
}

export function withStalkerContent() {
    const logger = createLogger('withStalkerContent');

    return signalStoreFeature(
        withState<StalkerContentState>(initialContentState),
        withProps(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService),
                portalRepair = inject(StalkerPortalRepairService),
                translateService = inject(TranslateService),
                itvCache = inject(StalkerItvCacheService)
            ) => {
                const storeContext = store as typeof store &
                    StalkerContentResourceStoreContract;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                    portalRepair,
                };

                let lastLivePageKey = '';
                return {
                    categoryResource: resource({
                        params: () => ({
                            contentType: storeContext.selectedContentType(),
                            currentPlaylist: storeContext.currentPlaylist(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerCategoryItem[]> => {
                            if (!params.currentPlaylist) {
                                patchState(store, { categoryError: null });
                                return [];
                            }

                            const cachedCategories = getCategoriesByType(
                                store,
                                params.contentType
                            );
                            if (cachedCategories.length > 0) {
                                patchState(store, { categoryError: null });
                                return cachedCategories;
                            }

                            try {
                                const response =
                                    await executeStalkerRequest<StalkerCategoryResponse>(
                                        requestDeps,
                                        params.currentPlaylist,
                                        {
                                            action: StalkerContentTypes[
                                                params.contentType
                                            ].getCategoryAction,
                                            type: params.contentType,
                                        }
                                    );

                                if (!Array.isArray(response?.js)) {
                                    const invalidResponseError = new Error(
                                        'Invalid categories response'
                                    );
                                    logger.warn(
                                        'Invalid categories response',
                                        response
                                    );
                                    if (params.contentType === 'radio') {
                                        const fallback =
                                            fallbackRadioCategories(
                                                translateService
                                            );
                                        patchState(store, {
                                            radioCategories: fallback,
                                            categoryError: null,
                                        });
                                        return fallback;
                                    }
                                    patchState(store, {
                                        ...buildCategoryPatch(
                                            params.contentType,
                                            []
                                        ),
                                        categoryError: invalidResponseError,
                                    });
                                    return [];
                                }

                                const normalizedCategories = response.js.map(
                                    (item): StalkerCategoryItem => ({
                                        category_name: item.title ?? '',
                                        category_id: String(item.id),
                                        censored:
                                            item.censored === 1 ||
                                            item.censored === '1',
                                    })
                                );
                                const categories = prependAllCategory(
                                    params.contentType,
                                    params.contentType === 'radio' &&
                                        normalizedCategories.length === 0
                                        ? fallbackRadioCategories(
                                              translateService
                                          )
                                        : normalizedCategories,
                                    translateService
                                );

                                patchState(store, {
                                    ...buildCategoryPatch(
                                        params.contentType,
                                        categories
                                    ),
                                    categoryError: null,
                                });

                                return categories;
                            } catch (error) {
                                logger.warn('Error loading categories', {
                                    contentType: params.contentType,
                                    error,
                                });
                                if (params.contentType === 'radio') {
                                    const fallback =
                                        fallbackRadioCategories(
                                            translateService
                                        );
                                    patchState(store, {
                                        radioCategories: fallback,
                                        categoryError: null,
                                    });
                                    return fallback;
                                }
                                patchState(store, {
                                    ...buildCategoryPatch(
                                        params.contentType,
                                        []
                                    ),
                                    categoryError: error,
                                });
                                return [];
                            }
                        },
                    }),
                    getContentResource: resource({
                        params: () => ({
                            contentType: storeContext.selectedContentType(),
                            category: storeContext.selectedCategoryId(),
                            // ITV fields filter locally; server search would narrow
                            // the shared pages behind the independent fullscreen field.
                            search:
                                storeContext.selectedContentType() === 'itv'
                                    ? ''
                                    : storeContext.searchPhrase(),
                            pageIndex: storeContext.page() + 1,
                            currentPlaylist: storeContext.currentPlaylist(),
                            // Re-fires the loader once THIS portal's full ITV
                            // channel list finishes loading or is refreshed.
                            // Read only for ITV and scoped per-portal so a
                            // different portal's (or a radio/vod) load never
                            // re-fires and re-appends this resource's page.
                            itvCacheVersion:
                                storeContext.selectedContentType() === 'itv'
                                    ? itvCache.versionFor(
                                          storeContext.currentPlaylist()
                                      )
                                    : 0,
                            availableCategoryCount: getCategoriesByType(
                                store,
                                storeContext.selectedContentType()
                            ).filter(
                                (category) =>
                                    String(category.category_id) !== '*'
                            ).length,
                        }),
                        loader: async ({
                            params,
                            abortSignal,
                        }): Promise<StalkerContentItem[]> => {
                            if (!params.category || params.category === '') {
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        null
                                    )
                                );
                                return [];
                            }

                            if (
                                params.category === '*' &&
                                (params.contentType === 'vod' ||
                                    params.contentType === 'series') &&
                                params.availableCategoryCount === 0
                            ) {
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        null
                                    )
                                );
                                return [];
                            }

                            const playlist = params.currentPlaylist;
                            if (!playlist?.portalUrl) {
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        null
                                    )
                                );
                                return [];
                            }

                            const categoryParam = params.category || '*';

                            if (params.contentType === 'itv') {
                                const cachedChannels =
                                    itvCache.getChannels(playlist);
                                const channels =
                                    cachedChannels !== null
                                        ? filterItvChannelsByGenre(
                                              cachedChannels,
                                              categoryParam
                                          )
                                        : null;
                                // Serve from the cache only when it actually
                                // has channels for this genre. Censored (adult)
                                // genres are typically EXCLUDED from
                                // get_all_channels by the portal, so an empty
                                // filter result falls through to the legacy
                                // paged fetch, which still returns them.
                                if (
                                    channels !== null &&
                                    (categoryParam === '*' ||
                                        channels.length > 0)
                                ) {
                                    patchState(store, {
                                        totalCount: channels.length,
                                        paginatedContent: channels,
                                        itvChannels: channels,
                                        hasMoreChannels: false,
                                        contentError: null,
                                    });
                                    return channels;
                                }

                                // Full-list load runs in the background; the
                                // resource re-fires via `itvCacheVersion` once
                                // the cache is ready. Until then the legacy
                                // paged flow below serves the first pages.
                                void itvCache.ensureLoaded(playlist);
                            }

                            const paramsPlaylistKey =
                                params.currentPlaylist?._id ??
                                params.currentPlaylist?.portalUrl ??
                                null;
                            const isCurrentRequest = (): boolean => {
                                const currentPlaylist =
                                    storeContext.currentPlaylist();
                                const currentPlaylistKey =
                                    currentPlaylist?._id ??
                                    currentPlaylist?.portalUrl ??
                                    null;

                                return (
                                    !abortSignal.aborted &&
                                    params.contentType ===
                                        storeContext.selectedContentType() &&
                                    params.category ===
                                        storeContext.selectedCategoryId() &&
                                    (params.contentType === 'itv' ||
                                        params.search ===
                                            storeContext.searchPhrase()) &&
                                    params.pageIndex ===
                                        storeContext.page() + 1 &&
                                    paramsPlaylistKey === currentPlaylistKey &&
                                    // A legacy paged response must not overwrite
                                    // the full cached list that a re-fired
                                    // loader served in the meantime. Scoped
                                    // per-portal and to ITV so another portal's
                                    // load never invalidates this response.
                                    params.itvCacheVersion ===
                                        (params.contentType === 'itv'
                                            ? itvCache.versionFor(
                                                  currentPlaylist
                                              )
                                            : 0)
                                );
                            };
                            const queryParams: Record<string, string | number> =
                                {
                                    action: StalkerContentTypes[
                                        params.contentType
                                    ].getContentAction,
                                    type: params.contentType,
                                    sortby: 'added',
                                    ...(params.search !== ''
                                        ? { search: params.search }
                                        : {}),
                                    p: params.pageIndex,
                                };

                            if (params.contentType === 'vod') {
                                queryParams['genre'] = '0';
                                queryParams['category'] = categoryParam;
                            } else if (params.contentType === 'series') {
                                queryParams['category'] = categoryParam;
                            } else if (params.contentType === 'itv') {
                                queryParams['category'] = categoryParam;
                                queryParams['genre'] = categoryParam;
                            } else {
                                queryParams['category'] = categoryParam;
                                queryParams['sortby'] = 'number';
                            }

                            try {
                                // Only a fresh list (page 1) blanks the grid
                                // for the skeleton; appends keep the already
                                // accumulated pages on screen.
                                patchState(store, {
                                    ...(params.pageIndex === 1
                                        ? { paginatedContent: [] }
                                        : {}),
                                    contentError: null,
                                    appendError: null,
                                });

                                const response =
                                    await executeStalkerRequest<StalkerOrderedListResponse>(
                                        requestDeps,
                                        playlist,
                                        queryParams
                                    );

                                if (!isCurrentRequest()) {
                                    return [];
                                }

                                if (!Array.isArray(response?.js?.data)) {
                                    const invalidResponseError = new Error(
                                        'Invalid response structure'
                                    );
                                    logger.warn(
                                        'Invalid response structure',
                                        response
                                    );
                                    if (params.pageIndex > 1) {
                                        // A broken append must not collapse
                                        // the pages already on screen.
                                        patchState(store, {
                                            appendError: invalidResponseError,
                                        });
                                        return store.paginatedContent();
                                    }
                                    patchState(store, {
                                        ...buildEmptyContentPatch(
                                            params.contentType,
                                            invalidResponseError
                                        ),
                                    });
                                    return [];
                                }

                                const newItems = response.js.data.map((item) =>
                                    toStalkerContentItem(
                                        item,
                                        playlist.portalUrl ?? ''
                                    )
                                );

                                if (
                                    params.contentType === 'itv' ||
                                    params.contentType === 'radio'
                                ) {
                                    const channels =
                                        newItems.map(toStalkerItvChannel);
                                    const existingChannels =
                                        params.contentType === 'itv'
                                            ? store.itvChannels()
                                            : store.radioChannels();
                                    const nextChannels =
                                        params.pageIndex === 1
                                            ? channels
                                            : dedupeContentById([
                                                  ...existingChannels,
                                                  ...channels,
                                              ]).map(toStalkerItvChannel);

                                    const livePageKey = JSON.stringify([
                                        paramsPlaylistKey,
                                        params.contentType,
                                        params.category,
                                        params.pageIndex,
                                    ]);
                                    // Cache readiness can replay the current censored page.
                                    // A different page adding no ids is a stalled portal.
                                    const replay =
                                        livePageKey === lastLivePageKey;
                                    lastLivePageKey = livePageKey;
                                    patchState(store, {
                                        totalCount:
                                            response.js.total_items ?? 0,
                                        paginatedContent: newItems,
                                        contentError: null,
                                        ...(params.contentType === 'itv'
                                            ? { itvChannels: nextChannels }
                                            : { radioChannels: nextChannels }),
                                        hasMoreChannels:
                                            channels.length > 0 &&
                                            (params.pageIndex === 1 ||
                                                replay ||
                                                nextChannels.length >
                                                    existingChannels.length) &&
                                            nextChannels.length <
                                                (response.js.total_items ?? 0),
                                    });
                                } else {
                                    // VOD/series pages accumulate into one
                                    // continuous list for the infinite-scroll
                                    // grid; page 1 replaces it.
                                    const previousContent =
                                        store.paginatedContent();
                                    const nextContent =
                                        params.pageIndex === 1
                                            ? newItems
                                            : dedupeContentById([
                                                  ...previousContent,
                                                  ...newItems,
                                              ]);
                                    // An append that adds no unique items is
                                    // the practical end of the list even when
                                    // the portal's total_items claims more
                                    // (dedup after mid-list mutations can
                                    // leave the unique list short forever) —
                                    // clamp the total so hasMoreContent turns
                                    // false instead of requesting past the
                                    // end on every scroll crossing.
                                    const appendStalled =
                                        params.pageIndex > 1 &&
                                        nextContent.length <=
                                            previousContent.length;

                                    patchState(store, {
                                        totalCount: appendStalled
                                            ? nextContent.length
                                            : (response.js.total_items ?? 0),
                                        paginatedContent: nextContent,
                                        contentError: null,
                                        appendError: null,
                                        hasMoreChannels: false,
                                    });
                                    return nextContent;
                                }

                                return newItems;
                            } catch (error) {
                                if (!isCurrentRequest()) {
                                    return [];
                                }

                                logger.warn('Error loading content', {
                                    contentType: params.contentType,
                                    category: params.category,
                                    error,
                                });
                                if (params.pageIndex > 1) {
                                    // Keep the accumulated pages; the grid
                                    // tail offers a retry for this page.
                                    patchState(store, { appendError: error });
                                    return store.paginatedContent();
                                }
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        error
                                    )
                                );
                                return [];
                            }
                        },
                    }),
                };
            }
        ),
        withComputed((store) => {
            const storeContext = store as typeof store &
                StalkerContentResourceStoreContract;
            const itvCache = inject(StalkerItvCacheService);

            /**
             * The whole portal's ITV channel list (all categories) when
             * cached. `versionFor` establishes the reactive dependency so this
             * recomputes when the list becomes ready or is refreshed.
             */
            const itvFullChannelList = computed(() => {
                const playlist = storeContext.currentPlaylist();
                itvCache.versionFor(playlist);
                return itvCache.getChannels(playlist) ?? [];
            });

            /**
             * Per-genre channel counts for ITV category badges, keyed by
             * numeric `tv_genre_id` (mirrors the Xtream count map). Only
             * populated when the full list is cached. The "All" pseudo
             * category has id `'*'` → `Number('*')` is NaN, and a Map keys
             * NaN by SameValueZero, so the grand total under `NaN` makes the
             * "All" row show every channel. Genres with NO cached channels
             * get no entry at all: adult genres are excluded from
             * `get_all_channels` (with or without a `censored` flag from
             * `get_genres`), so their real count is unknown and the badge
             * is omitted rather than showing a misleading "0".
             */
            const itvCategoryItemCounts = computed(() => {
                const counts = new Map<number, number>();
                const channels = itvFullChannelList();
                for (const channel of channels) {
                    const genreId = Number(channel.tv_genre_id);
                    if (!Number.isNaN(genreId)) {
                        counts.set(genreId, (counts.get(genreId) ?? 0) + 1);
                    }
                }
                counts.set(Number.NaN, channels.length);
                return counts;
            });

            return {
                /** True when the complete ITV channel list is cached, so local search covers all channels. */
                itvFullListActive: computed(() =>
                    itvCache.isReady(storeContext.currentPlaylist())
                ),
                itvFullListLoading: computed(() =>
                    itvCache.isLoading(storeContext.currentPlaylist())
                ),
                itvFullListProgress: computed(() =>
                    itvCache.progressOf(storeContext.currentPlaylist())
                ),
                /** Exposes the whole portal's ITV channel list so search can span every channel. */
                itvFullChannelList,
                /**
                 * True when the currently selected ITV category can be served
                 * from the full-list cache. Censored (adult) genres are usually
                 * excluded from `get_all_channels`, so a genre with zero cached
                 * channels stays on the legacy paged flow. O(1): reuses the
                 * memoized per-genre count map instead of re-scanning the list
                 * on every category click.
                 */
                itvSelectedCategoryFromCache: computed(() => {
                    const playlist = storeContext.currentPlaylist();
                    if (!itvCache.isReady(playlist)) {
                        return false;
                    }

                    const categoryId = storeContext.selectedCategoryId();
                    if (!categoryId) {
                        return false;
                    }
                    if (categoryId === '*') {
                        return true;
                    }

                    const genreId = Number(categoryId);
                    if (Number.isNaN(genreId)) {
                        // Non-numeric genre id would collide with the NaN
                        // "All" total key — fall back to the direct scan.
                        return (
                            filterItvChannelsByGenre(
                                itvFullChannelList(),
                                categoryId
                            ).length > 0
                        );
                    }

                    return (itvCategoryItemCounts().get(genreId) ?? 0) > 0;
                }),
                itvCategoryItemCounts,
                /**
                 * Whether the portal reports more items than the grid has
                 * accumulated. Derived from `total_items` versus the actual
                 * list length, so it stays correct even when the portal
                 * ignores requested page sizes.
                 */
                hasMoreContent: computed(
                    () => store.paginatedContent().length < store.totalCount()
                ),
                hasContentAppendError: computed(
                    () => store.appendError() !== null
                ),
                getSelectedCategory: computed(() => {
                    const categoryId = storeContext.selectedCategoryId();
                    if (!categoryId) {
                        return {
                            id: 0,
                            category_name: 'All Items',
                            type: storeContext.selectedContentType(),
                        };
                    }

                    const contentType = storeContext.selectedContentType();
                    const categories = getCategoriesByType(store, contentType);

                    return (
                        categories.find(
                            (category) =>
                                String(category.category_id) ===
                                String(categoryId)
                        ) || {
                            category_id: categoryId,
                            category_name: '',
                            type: contentType,
                        }
                    );
                }),
                getSelectedCategoryName: computed(() => {
                    const selectedCategoryId =
                        storeContext.selectedCategoryId();
                    if (!selectedCategoryId) {
                        return '';
                    }

                    const category = getCategoriesByType(
                        store,
                        storeContext.selectedContentType()
                    ).find(
                        (item) =>
                            String(item.category_id) ===
                            String(selectedCategoryId)
                    );

                    return category?.category_name ?? '';
                }),
                getPaginatedContent: computed(() => store.paginatedContent()),
                isPaginatedContentLoading: computed(() =>
                    storeContext.getContentResource.isLoading()
                ),
                isPaginatedContentFailed: computed(() => store.contentError()),
                getCategoryResource: computed(() =>
                    getCategoriesByType(
                        store,
                        storeContext.selectedContentType()
                    )
                ),
                isCategoryResourceLoading: computed(() =>
                    storeContext.categoryResource.isLoading()
                ),
                isCategoryResourceFailed: computed(() => store.categoryError()),
            };
        }),
        withMethods((store) => {
            const storeContext = store as typeof store &
                StalkerContentResourceStoreContract;
            const itvCache = inject(StalkerItvCacheService);
            const dataService = inject(DataService);

            return {
                /**
                 * Kicks off the full ITV channel list load as soon as the Live TV
                 * section is entered (instead of waiting for the first category
                 * click), so the all-channels view and category count badges are
                 * available immediately. Safe to call repeatedly — the cache
                 * de-duplicates in-flight loads and memoizes unsupported portals.
                 */
                preloadItvChannels(): void {
                    void itvCache.ensureLoaded(storeContext.currentPlaylist());
                },
                /**
                 * Re-runs the content loader with unchanged params — the retry
                 * for a failed append page.
                 *
                 * The guard reset comes FIRST: two failed appends are exactly what
                 * opens the breaker, so without it this button would fast-fail
                 * without a request and appear to do nothing for 30 seconds.
                 */
                async retryContentPage(): Promise<void> {
                    // Clear the flag synchronously, before the await: otherwise
                    // this stays re-enterable and the next `nearEnd` event
                    // fires a second retry.
                    patchState(store, { appendError: null });
                    await resetHostConnectivityGuard(
                        dataService,
                        storeContext.currentPlaylist()?.portalUrl
                    );
                    storeContext.getContentResource.reload();
                },
                async refreshItvChannels(): Promise<void> {
                    await itvCache.refresh(storeContext.currentPlaylist());
                },
                setCategories(
                    type: StalkerContentType,
                    categories: StalkerCategoryItem[]
                ) {
                    patchState(store, buildCategoryPatch(type, categories));
                },
                resetCategories() {
                    patchState(store, {
                        vodCategories: [],
                        seriesCategories: [],
                        itvCategories: [],
                        radioCategories: [],
                        categoryError: null,
                    });
                },
                setItvChannels(channels: StalkerItvChannel[]) {
                    patchState(store, { itvChannels: channels });
                },
                setRadioChannels(channels: StalkerItvChannel[]) {
                    patchState(store, { radioChannels: channels });
                },
            };
        })
    );
}
