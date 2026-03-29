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
import { DataService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    StalkerCategoryItem,
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerContentTypes } from '../../stalker-content-types';
import { toStalkerContentItem, toStalkerItvChannel } from '../utils';

/**
 * Augments a Playlist with an optional customPortalKey property.
 * The real interface may already define this property in the feature branch,
 * but we add it here locally to avoid TypeScript errors and to document its
 * expected type.
 */
type PlaylistWithCustomKey = Playlist & { customPortalKey?: string };

/**
 * Content/categories/channels feature state.
 */
export interface StalkerContentState {
    totalCount: number;
    vodCategories: StalkerCategoryItem[];
    seriesCategories: StalkerCategoryItem[];
    itvCategories: StalkerCategoryItem[];
    hasMoreChannels: boolean;
    itvChannels: StalkerItvChannel[];
}

const initialContentState: StalkerContentState = {
    totalCount: 0,
    vodCategories: [],
    seriesCategories: [],
    itvCategories: [],
    hasMoreChannels: false,
    itvChannels: [],
};

interface ResourceState<T> {
    value(): T;
    isLoading(): boolean;
    error(): unknown;
}

interface StalkerCategoryResponseItem {
    id?: string | number;
    title?: string;
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

interface StalkerContentStoreContext {
    selectedContentType(): 'vod' | 'series' | 'itv';
    currentPlaylist(): Playlist | undefined;
    selectedCategoryId(): string | null | undefined;
    searchPhrase(): string;
    page(): number;
    limit(): number;
    getContentResource: ResourceState<StalkerContentItem[] | undefined>;
    getCategoryResource: ResourceState<StalkerCategoryItem[]>;
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
                translateService = inject(TranslateService)
            ) => {
                const storeContext =
                    store as unknown as StalkerContentStoreContext;

                return {
                    getCategoryResource: resource({
                        params: () => ({
                            contentType: storeContext.selectedContentType(),
                            action: StalkerPortalActions.GetCategories,
                            currentPlaylist: storeContext.currentPlaylist(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerCategoryItem[]> => {
                            if (!params.currentPlaylist) return [];

                            // If categories are already loaded, return cached ones
                            switch (params.contentType) {
                                case 'itv':
                                    if (store.itvCategories().length > 0) {
                                        return store.itvCategories();
                                    }
                                    break;
                                case 'vod':
                                    if (store.vodCategories().length > 0) {
                                        return store.vodCategories();
                                    }
                                    break;
                                case 'series':
                                    if (store.seriesCategories().length > 0) {
                                        return store.seriesCategories();
                                    }
                                    break;
                            }

                            const { portalUrl, macAddress } =
                                params.currentPlaylist;

                            // Prepare query params for categories
                            const playlist = params.currentPlaylist as PlaylistWithCustomKey;
                            const queryParams: Record<string, string | number> = {
                                action: StalkerContentTypes[params.contentType]
                                    .getCategoryAction,
                                type: params.contentType,
                            };
                            // Include the custom portal key in the query params when present.
                            // Use the original property name 'customPortalKey' instead of
                            // converting it to 'key', as some portals expect this exact name.
                            if (playlist.customPortalKey) {
                                queryParams['customPortalKey'] = playlist.customPortalKey;
                            }

                            let response: StalkerCategoryResponse;
                            if (playlist.isFullStalkerPortal) {
                                // Full stalker portal - use authenticated request with retry
                                response = await stalkerSession.makeAuthenticatedRequest<StalkerCategoryResponse>(
                                    playlist,
                                    queryParams
                                );
                            } else {
                                // Simple stalker portal - no auth needed
                                // Build payload with optional top-level customPortalKey so that the electron
                                // backend can access it if needed
                                const payload: any = {
                                    url: portalUrl,
                                    macAddress,
                                    params: queryParams,
                                };
                                if (playlist.customPortalKey) {
                                    payload.customPortalKey = playlist.customPortalKey;
                                }
                                response = await dataService.sendIpcEvent<StalkerCategoryResponse>(
                                    STALKER_REQUEST,
                                    payload
                                );
                            }

                            // Normalize categories array. Some portals return
                            // categories in different shapes. Accept an array at
                            // response.js (baseline), response.js.data, or
                            // response.js.categories. Fallback to empty array
                            // and log unexpected structures for easier debugging.
                            let rawCategories: unknown[] = [];
                            const js = (response as any)?.js;
                            if (Array.isArray(js)) {
                                rawCategories = js as unknown[];
                            } else if (js && Array.isArray(js.data)) {
                                rawCategories = js.data as unknown[];
                            } else if (js && Array.isArray(js.categories)) {
                                rawCategories = js.categories as unknown[];
                            } else {
                                // In some APIs the array might be under js.data.items
                                if (js?.data && Array.isArray(js.data.items)) {
                                    rawCategories = js.data.items as unknown[];
                                }
                            }
                            // If no categories returned from the primary action (e.g. get_categories),
                            // attempt a fallback request using the 'get_genres' action. Some portals
                            // may use get_genres for VOD and series categories. Only attempt fallback
                            // when rawCategories is empty and contentType is vod or series.
                            if (
                                (!Array.isArray(rawCategories) || rawCategories.length === 0) &&
                                (params.contentType === 'vod' || params.contentType === 'series')
                            ) {
                                logger.info(
                                    `No categories returned for ${params.contentType} via ${queryParams.action}, falling back to get_genres.`
                                );
                                // Build fallback query params by copying existing ones and overriding the action
                                const fallbackQuery = {
                                    ...queryParams,
                                    action: StalkerPortalActions.GetGenres,
                                } as Record<string, string | number>;
                                // Keep the custom portal key if present
                                if (playlist.customPortalKey) {
                                    fallbackQuery['customPortalKey'] = playlist.customPortalKey;
                                }
                                // Perform fallback request via appropriate channel
                                let fallbackResponse: StalkerCategoryResponse;
                                if (playlist.isFullStalkerPortal) {
                                    fallbackResponse = await stalkerSession.makeAuthenticatedRequest<StalkerCategoryResponse>(
                                        playlist,
                                        fallbackQuery
                                    );
                                } else {
                                    const fallbackPayload: any = {
                                        url: portalUrl,
                                        macAddress,
                                        params: fallbackQuery,
                                    };
                                    if (playlist.customPortalKey) {
                                        fallbackPayload.customPortalKey = playlist.customPortalKey;
                                    }
                                    fallbackResponse = await dataService.sendIpcEvent<StalkerCategoryResponse>(
                                        STALKER_REQUEST,
                                        fallbackPayload
                                    );
                                }
                                response = fallbackResponse;
                                // Extract raw categories from fallback response
                                const fjs = (fallbackResponse as any)?.js;
                                if (Array.isArray(fjs)) {
                                    rawCategories = fjs;
                                } else if (fjs && Array.isArray(fjs.data)) {
                                    rawCategories = fjs.data;
                                } else if (fjs && Array.isArray(fjs.categories)) {
                                    rawCategories = fjs.categories;
                                } else if (fjs?.data && Array.isArray(fjs.data.items)) {
                                    rawCategories = fjs.data.items;
                                }
                            }
                            if (!Array.isArray(rawCategories) || rawCategories.length === 0) {
                                logger.warn('Invalid categories response structure', response);
                                // Still provide an 'All' category for UI consistency
                                const categories: StalkerCategoryItem[] = [
                                    {
                                        category_name: translateService.instant('PORTALS.ALL_CATEGORIES'),
                                        category_id: '*',
                                    },
                                ];
                                patchState(store, {
                                    [`${params.contentType}Categories`]: categories,
                                });
                                return categories;
                            }
                            const normalizedCategories = rawCategories
                                .map((item: any) => {
                                    const title = item?.title ?? item?.category_name ?? '';
                                    const id = item?.id ?? item?.category_id ?? '';
                                    return {
                                        category_name: String(title).trim(),
                                        category_id: String(id),
                                    } as StalkerCategoryItem;
                                })
                                .filter(
                                    (category) =>
                                        category.category_name !== '' &&
                                        category.category_id !== ''
                                );

                            const seenCategoryIds = new Set<string>();
                            const categories: StalkerCategoryItem[] = [];
                            normalizedCategories.forEach((category) => {
                                const normalizedId = String(category.category_id);
                                if (seenCategoryIds.has(normalizedId)) {
                                    return;
                                }

                                seenCategoryIds.add(normalizedId);
                                categories.push(category);
                            });

                            // Preserve the original API order.
                            // Only keep the synthetic/global "All categories" entry pinned to the top.
                            if (categories.length === 0) {
                                categories.push({
                                    category_name: translateService.instant(
                                        'PORTALS.ALL_CATEGORIES'
                                    ),
                                    category_id: '*',
                                });
                            } else if (
                                !categories.some(
                                    (category) =>
                                        String(category.category_id) === '*'
                                )
                            ) {
                                categories.unshift({
                                    category_name: translateService.instant(
                                        'PORTALS.ALL_CATEGORIES'
                                    ),
                                    category_id: '*',
                                });
                            }
                            patchState(store, {
                                [`${params.contentType}Categories`]: categories,
                            });
                            return categories;
                        },
                    }),
                    getContentResource: resource({
                        params: () => ({
                            contentType: storeContext.selectedContentType(),
                            category: storeContext.selectedCategoryId(),
                            action: StalkerPortalActions.GetOrderedList,
                            search: storeContext.searchPhrase(),
                            pageIndex: storeContext.page() + 1,
                            availableCategoryCount: (() => {
                                const contentType = storeContext.selectedContentType();
                                const categories =
                                    contentType === 'vod'
                                        ? store.vodCategories()
                                        : contentType === 'series'
                                            ? store.seriesCategories()
                                            : store.itvCategories();
                                return categories.filter(
                                    (category) => String(category.category_id) !== '*'
                                ).length;
                            })(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerContentItem[] | undefined> => {
                            if (
                                !params.category ||
                                params.category === null ||
                                params.category === ''
                            ) {
                                patchState(store, { totalCount: 0 });
                                return Promise.resolve(undefined);
                            }
                            if (
                                params.category === '*' &&
                                (params.contentType === 'vod' ||
                                    params.contentType === 'series') &&
                                params.availableCategoryCount === 0
                            ) {
                                patchState(store, { totalCount: 0 });
                                return Promise.resolve(undefined);
                            }

                            const currentPlaylist = storeContext.currentPlaylist;

                            // Guard: ensure currentPlaylist is available (may not be during deep link init)
                            if (
                                !currentPlaylist() ||
                                !currentPlaylist().portalUrl
                            ) {
                                patchState(store, { totalCount: 0 });
                                return Promise.resolve(undefined);
                            }
                            // Cast playlist once so we can safely access customPortalKey
                            const playlist = currentPlaylist() as PlaylistWithCustomKey;
                            // VOD uses 'genre' param, series uses 'category' param, itv uses both
                            // Use "*" for categories without an ID (e.g. "All") to fetch all items
                            const hasSearch = String(params.search ?? '').trim().length > 0;
                            const categoryParam =
                                hasSearch &&
                                    (params.contentType === 'vod' || params.contentType === 'series')
                                    ? '*'
                                    : params.category || '*';
                            const queryParams: Record<string, string | number> = {
                                action: StalkerContentTypes[params.contentType]
                                    .getContentAction,
                                type: params.contentType,
                                sortby: 'added',
                                ...(params.search !== ''
                                    ? { search: params.search }
                                    : {}),
                                p: params.pageIndex,
                                limit: storeContext.limit(),
                            };
                            // Include the custom portal key when present
                            if (playlist.customPortalKey) {
                                queryParams['customPortalKey'] = playlist.customPortalKey;
                            }
                            // Add the correct category/genre param based on content type
                            // Based on working app traces: VOD uses genre=0 and category={id}
                            if (params.contentType === 'vod') {
                                queryParams['genre'] = '0';
                                queryParams['category'] = categoryParam;
                            } else if (params.contentType === 'series') {
                                queryParams['category'] = categoryParam;
                            } else {
                                // itv - use both for compatibility
                                queryParams['category'] = categoryParam;
                                queryParams['genre'] = categoryParam;
                            }

                            let response: StalkerOrderedListResponse;
                            if (playlist.isFullStalkerPortal) {
                                // Full stalker portal - use authenticated request with retry
                                response = await stalkerSession.makeAuthenticatedRequest<StalkerOrderedListResponse>(
                                    playlist,
                                    queryParams
                                );
                            } else {
                                // Simple stalker portal - no auth needed
                                const payload: any = {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                };
                                if (playlist.customPortalKey) {
                                    payload.customPortalKey = playlist.customPortalKey;
                                }
                                response = await dataService.sendIpcEvent<StalkerOrderedListResponse>(
                                    STALKER_REQUEST,
                                    payload
                                );
                            }

                            // Guard: ensure response has expected structure
                            // Normalize ordered list / content response. Accept data at
                            // response.js.data (baseline) or response.js.items or response.data
                            const js = (response as any)?.js;
                            let items: unknown[] = [];
                            let totalItems: number | undefined;
                            if (js && Array.isArray(js.data)) {
                                items = js.data as unknown[];
                                totalItems = js.total_items;
                            } else if (js && Array.isArray(js.items)) {
                                items = js.items as unknown[];
                                totalItems = js.total_items;
                            } else if (Array.isArray(js)) {
                                items = js as unknown[];
                                totalItems = (js as any)?.length;
                            }
                            if (!Array.isArray(items)) {
                                logger.warn('Invalid ordered list response structure', response);
                                return [];
                            }
                            const portalUrl = playlist.portalUrl;
                            const mappedItems = items
                                .map((item: any) =>
                                    toStalkerContentItem(item as StalkerVodSource, portalUrl)
                                )
                                .filter((item) => {
                                    const title = String(
                                        item?.name ?? item?.o_name ?? item?.title ?? ''
                                    )
                                        .trim()
                                        .toLowerCase();

                                    if (title !== 'next') {
                                        return true;
                                    }

                                    logger.info(
                                        'Skipping synthetic custom portal pagination item',
                                        item
                                    );
                                    return false;
                                });

                            const normalizedSearch = String(params.search ?? '')
                                .trim()
                                .toLowerCase();
                            const visibleItems =
                                normalizedSearch.length > 0
                                    ? mappedItems.filter((item) => {
                                        const haystack = [
                                            item?.name,
                                            item?.o_name,
                                            item?.title,
                                        ]
                                            .map((value) => String(value ?? '').toLowerCase())
                                            .join(' ');

                                        return haystack.includes(normalizedSearch);
                                    })
                                    : mappedItems;

                            const filteredCountDelta = items.length - mappedItems.length;
                            const resolvedTotalCount = Math.max(
                                0,
                                (totalItems ?? items.length ?? 0) - filteredCountDelta
                            );
                            const effectiveTotalCount =
                                normalizedSearch.length > 0
                                    ? visibleItems.length
                                    : resolvedTotalCount;

                            patchState(store, {
                                totalCount: effectiveTotalCount,
                            });

                            if (storeContext.selectedContentType() === 'itv') {
                                const channels = visibleItems.map(toStalkerItvChannel);
                                // Check if we're loading the first page or loading more
                                if (params.pageIndex === 1) {
                                    patchState(store, { itvChannels: channels });
                                } else {
                                    patchState(store, {
                                        itvChannels: [
                                            ...store.itvChannels(),
                                            ...channels,
                                        ],
                                    });
                                }

                                // Update hasMoreItems based on total count and current items
                                const totalLoaded = store.itvChannels().length;
                                patchState(store, {
                                    hasMoreChannels: totalLoaded < effectiveTotalCount,
                                });
                            }

                            return visibleItems;
                        },
                    }),
                };
            }
        ),
        withComputed((store) => {
            const storeContext = store as unknown as StalkerContentStoreContext;
            return {
                getTotalPages: computed(() => {
                    return Math.ceil(store.totalCount() / storeContext.limit());
                }),
                getSelectedCategoryName: computed(() => {
                    const type = storeContext.selectedContentType();
                    const selectedCategoryId = storeContext.selectedCategoryId();
                    if (!selectedCategoryId) return '';
                    let categories: StalkerCategoryItem[] = [];
                    if (type === 'vod') {
                        categories = store.vodCategories();
                    } else if (type === 'series') {
                        categories = store.seriesCategories();
                    } else if (type === 'itv') {
                        categories = store.itvCategories();
                    }
                    const category = categories.find(
                        (cat) =>
                            String(cat.category_id) === String(selectedCategoryId)
                    );
                    return category ? category.category_name : '';
                }),
                /** category content */
                getPaginatedContent: computed(() =>
                    storeContext.getContentResource.value()
                ),
                isPaginatedContentLoading: computed(() =>
                    storeContext.getContentResource.isLoading()
                ),
                isPaginatedContentFailed: computed(() =>
                    storeContext.getContentResource.error()
                ),
                /** category resource */
                getCategoryResource: computed(() =>
                    storeContext.getCategoryResource.value()
                ),
                isCategoryResourceLoading: computed(() =>
                    storeContext.getCategoryResource.isLoading()
                ),
                isCategoryResourceFailed: computed(() =>
                    storeContext.getCategoryResource.error()
                ),
            };
        }),
        withMethods((store) => ({
            setCategories(
                type: 'vod' | 'series' | 'itv',
                categories: StalkerCategoryItem[]
            ) {
                if (type === 'vod') {
                    patchState(store, { vodCategories: categories });
                } else if (type === 'series') {
                    patchState(store, { seriesCategories: categories });
                } else if (type === 'itv') {
                    patchState(store, { itvCategories: categories });
                }
            },
            resetCategories() {
                patchState(store, {
                    vodCategories: [],
                    seriesCategories: [],
                    itvCategories: [],
                });
            },
            setItvChannels(channels: StalkerItvChannel[]) {
                patchState(store, { itvChannels: channels });
            },
        }))
    );
}