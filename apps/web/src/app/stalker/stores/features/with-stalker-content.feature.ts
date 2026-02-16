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
import { DataService, StalkerSessionService } from 'services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';
import { createLogger } from '../../../shared/utils/logger';
import {
    StalkerCategoryItem,
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';
import { StalkerContentTypes } from '../../stalker-content-types';
import { toStalkerContentItem, toStalkerItvChannel } from '../utils';

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
            ) => ({
                getCategoryResource: resource({
                    params: () => ({
                        contentType: (store as any).selectedContentType(),
                        action: StalkerPortalActions.GetCategories,
                        currentPlaylist: (store as any).currentPlaylist(),
                    }),
                    loader: async ({
                        params,
                    }): Promise<StalkerCategoryItem[]> => {
                        if (params.currentPlaylist === undefined) return;

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

                        // Use makeAuthenticatedRequest for automatic retry on auth failure
                        const playlist = params.currentPlaylist as Playlist;
                        const queryParams = {
                            action: StalkerContentTypes[params.contentType]
                                .getCategoryAction,
                            type: params.contentType,
                        };

                        let response: any;
                        if (playlist.isFullStalkerPortal) {
                            // Full stalker portal - use authenticated request with retry
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            // Simple stalker portal - no auth needed
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: portalUrl,
                                    macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        // Guard: ensure response has expected structure
                        if (!response?.js || !Array.isArray(response.js)) {
                            logger.warn(
                                'Invalid categories response',
                                response
                            );
                            return [];
                        }

                        const categories = response.js
                            .map(
                                (item): StalkerCategoryItem => ({
                                    category_name: item.title,
                                    category_id: String(item.id),
                                })
                            )
                            .sort((a, b) =>
                                a.category_name.localeCompare(b.category_name)
                            );
                        if (
                            categories.length > 0 &&
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
                        contentType: (store as any).selectedContentType(),
                        category: (store as any).selectedCategoryId(),
                        action: StalkerPortalActions.GetOrderedList,
                        search: (store as any).searchPhrase(),
                        pageIndex: (store as any).page() + 1,
                        availableCategoryCount: (() => {
                            const contentType = (
                                store as any
                            ).selectedContentType();
                            const categories =
                                contentType === 'vod'
                                    ? store.vodCategories()
                                    : contentType === 'series'
                                      ? store.seriesCategories()
                                      : store.itvCategories();
                            return categories.filter(
                                (category) =>
                                    String(category.category_id) !== '*'
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

                        const currentPlaylist = (store as any).currentPlaylist;

                        // Guard: ensure currentPlaylist is available (may not be during deep link init)
                        if (
                            !currentPlaylist() ||
                            !currentPlaylist().portalUrl
                        ) {
                            patchState(store, { totalCount: 0 });
                            return Promise.resolve(undefined);
                        }
                        // VOD uses 'genre' param, series uses 'category' param, itv uses both
                        // Based on stalker-to-m3u implementation
                        // Use "*" for categories without an ID (e.g. "All") to fetch all items
                        const categoryParam = params.category || '*';
                        const queryParams: Record<string, string | number> = {
                            action: StalkerContentTypes[params.contentType]
                                .getContentAction,
                            type: params.contentType,
                            sortby: 'added',
                            ...(params.search !== ''
                                ? { search: params.search }
                                : {}),
                            p: params.pageIndex,
                        };

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

                        // Use makeAuthenticatedRequest for automatic retry on auth failure
                        const playlist = currentPlaylist() as Playlist;
                        let response: any;
                        if (playlist.isFullStalkerPortal) {
                            // Full stalker portal - use authenticated request with retry
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            // Simple stalker portal - no auth needed
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        // Guard: ensure response has expected structure
                        if (!response?.js?.data) {
                            logger.warn('Invalid response structure', response);
                            return [];
                        }

                        patchState(store, {
                            totalCount: response.js.total_items ?? 0,
                        });

                        const portalUrl = currentPlaylist().portalUrl;
                        const newItems = response.js.data.map(
                            (item: StalkerVodSource) =>
                                toStalkerContentItem(item, portalUrl)
                        );

                        if ((store as any).selectedContentType() === 'itv') {
                            const channels = newItems.map(toStalkerItvChannel);
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
                                hasMoreChannels:
                                    totalLoaded <
                                    (response.js.total_items ?? 0),
                            });
                        }

                        return newItems;
                    },
                }),
            })
        ),
        withComputed((store) => {
            const storeAny = store as any;
            return {
                getTotalPages: computed(() => {
                    return Math.ceil(store.totalCount() / storeAny.limit());
                }),
                getSelectedCategoryName: computed(() => {
                    const type = storeAny.selectedContentType();
                    const selectedCategoryId = storeAny.selectedCategoryId();
                    if (!selectedCategoryId) return '';
                    let categories = [];
                    if (type === 'vod') {
                        categories = store.vodCategories();
                    } else if (type === 'series') {
                        categories = store.seriesCategories();
                    } else if (type === 'itv') {
                        categories = store.itvCategories();
                    }
                    const category = categories.find(
                        (cat) =>
                            String(cat.category_id) ===
                            String(selectedCategoryId)
                    );
                    return category ? category.category_name : '';
                }),
                /** category content */
                getPaginatedContent: computed(() =>
                    storeAny.getContentResource.value()
                ),
                isPaginatedContentLoading: computed(() =>
                    storeAny.getContentResource.isLoading()
                ),
                isPaginatedContentFailed: computed(() =>
                    storeAny.getContentResource.error()
                ),
                /** category resource */
                getCategoryResource: computed(() =>
                    storeAny.getCategoryResource.value()
                ),
                isCategoryResourceLoading: computed(() =>
                    storeAny.getCategoryResource.isLoading()
                ),
                isCategoryResourceFailed: computed(() =>
                    storeAny.getCategoryResource.error()
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
