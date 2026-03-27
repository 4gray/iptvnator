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

interface CustomPortalRequest {
    cmd?: string;
    fid?: string | number;
    offset?: number;
    limit?: number;
    query?: string;
}

interface CustomPortalItem {
    type?: string;
    title?: string;
    request?: CustomPortalRequest;
    url?: string;
    fid?: string | number;
    id?: string | number;
    img?: string;
    imglr?: string;
    description?: string;
    year?: string | number;
}

interface CustomPortalResponse {
    type?: string;
    items?: CustomPortalItem[];
    count?: number;
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

const CUSTOM_PORTAL_EMPTY_MAC = '00:00:00:00:00:00';
const CUSTOM_PORTAL_DEFAULT_PAGE_SIZE = 25;

function encodeCustomPortalCategoryRequest(
    request: CustomPortalRequest
): string {
    return encodeURIComponent(JSON.stringify(request));
}

function decodeCustomPortalCategoryRequest(
    value: string | null | undefined
): CustomPortalRequest | null {
    if (!value) return null;

    try {
        return JSON.parse(decodeURIComponent(value)) as CustomPortalRequest;
    } catch {
        return null;
    }
}

function isCustomPortalCategoryItem(
    item: CustomPortalItem
): item is CustomPortalItem & { request: CustomPortalRequest } {
    return item?.type === 'category' && !!item.request;
}

function isCustomPortalPlayableItem(item: CustomPortalItem): boolean {
    return item?.type === 'stream' || item?.type === 'multistream';
}

function toCustomPortalContentItem(item: CustomPortalItem): StalkerContentItem {
    const stableId =
        item.fid ?? item.id ?? item.request?.fid ?? item.title ?? 'custom-item';

    return {
        id: stableId,
        cmd: item.url ?? '',
        title: item.title ?? '',
        name: item.title ?? '',
        o_name: item.title ?? '',
        cover: item.img ?? item.imglr ?? '',
        screenshot_uri: item.imglr ?? item.img ?? '',
        description: item.description ?? '',
        year: item.year ? String(item.year) : '',
        category_id: item.request?.fid ? String(item.request.fid) : '',
        has_files: 0,
        is_series: 0,
    };
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

                            const playlist = params.currentPlaylist as Playlist;
                            const { portalUrl, macAddress } = playlist;

                            if (playlist.isCustomPortal) {
                                if (params.contentType !== 'vod') {
                                    return [];
                                }

                                const response =
                                    await dataService.sendIpcEvent<CustomPortalResponse>(
                                        STALKER_REQUEST,
                                        {
                                            url: portalUrl,
                                            macAddress:
                                                macAddress ||
                                                CUSTOM_PORTAL_EMPTY_MAC,
                                            customPortalKey:
                                                playlist.customPortalKey,
                                            params: {},
                                        }
                                    );

                                if (!Array.isArray(response?.items)) {
                                    logger.warn(
                                        'Invalid custom portal categories response',
                                        response
                                    );
                                    return [];
                                }

                                const categories = response.items
                                    .filter(isCustomPortalCategoryItem)
                                    .map(
                                        (item): StalkerCategoryItem => ({
                                            category_name: item.title ?? '',
                                            category_id:
                                                encodeCustomPortalCategoryRequest(
                                                    item.request
                                                ),
                                        })
                                    )
                                    .filter(
                                        (item) =>
                                            item.category_name.trim() !== ''
                                    );

                                patchState(store, {
                                    vodCategories: categories,
                                    seriesCategories: [],
                                    itvCategories: [],
                                });

                                return categories;
                            }

                            const queryParams = {
                                action: StalkerContentTypes[params.contentType]
                                    .getCategoryAction,
                                type: params.contentType,
                            };

                            let response: StalkerCategoryResponse;
                            if (playlist.isFullStalkerPortal) {
                                response =
                                    await stalkerSession.makeAuthenticatedRequest<StalkerCategoryResponse>(
                                        playlist,
                                        queryParams
                                    );
                            } else {
                                response =
                                    await dataService.sendIpcEvent<StalkerCategoryResponse>(
                                        STALKER_REQUEST,
                                        {
                                            url: portalUrl,
                                            macAddress,
                                            params: queryParams,
                                        }
                                    );
                            }

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
                                    a.category_name.localeCompare(
                                        b.category_name
                                    )
                                );

                            const allIdx = categories.findIndex(
                                (c) =>
                                    c.category_name.trim().toLowerCase() ===
                                    'all'
                            );

                            if (allIdx > 0) {
                                categories.unshift(
                                    categories.splice(allIdx, 1)[0]
                                );
                            } else if (
                                allIdx === -1 &&
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
                            contentType: storeContext.selectedContentType(),
                            category: storeContext.selectedCategoryId(),
                            action: StalkerPortalActions.GetOrderedList,
                            search: storeContext.searchPhrase(),
                            pageIndex: storeContext.page() + 1,
                            availableCategoryCount: (() => {
                                const contentType =
                                    storeContext.selectedContentType();
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

                            const currentPlaylist = storeContext.currentPlaylist;

                            if (
                                !currentPlaylist() ||
                                !currentPlaylist().portalUrl
                            ) {
                                patchState(store, { totalCount: 0 });
                                return Promise.resolve(undefined);
                            }

                            const playlist = currentPlaylist() as Playlist;

                            if (playlist.isCustomPortal) {
                                if (params.contentType !== 'vod') {
                                    patchState(store, { totalCount: 0 });
                                    return [];
                                }

                                const pageSize =
                                    Number(storeContext.limit()) ||
                                    CUSTOM_PORTAL_DEFAULT_PAGE_SIZE;

                                let customRequest: CustomPortalRequest | null =
                                    null;

                                if (params.search !== '') {
                                    customRequest = {
                                        cmd: 'search',
                                        query: params.search,
                                    };
                                } else {
                                    customRequest =
                                        decodeCustomPortalCategoryRequest(
                                            String(params.category)
                                        );
                                }

                                if (!customRequest) {
                                    patchState(store, { totalCount: 0 });
                                    return [];
                                }

                                const response =
                                    await dataService.sendIpcEvent<CustomPortalResponse>(
                                        STALKER_REQUEST,
                                        {
                                            url: playlist.portalUrl,
                                            macAddress:
                                                playlist.macAddress ||
                                                CUSTOM_PORTAL_EMPTY_MAC,
                                            customPortalKey:
                                                playlist.customPortalKey,
                                            params: {
                                                ...customRequest,
                                                offset:
                                                    (params.pageIndex - 1) *
                                                    pageSize,
                                                limit: pageSize,
                                            },
                                        }
                                    );

                                const responseItems = Array.isArray(
                                    response?.items
                                )
                                    ? response.items
                                    : [];

                                const playableItems = responseItems.filter(
                                    isCustomPortalPlayableItem
                                );

                                patchState(store, {
                                    totalCount: Number(
                                        response?.count ??
                                        playableItems.length
                                    ),
                                });

                                return playableItems.map(
                                    toCustomPortalContentItem
                                );
                            }

                            const categoryParam = params.category || '*';
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
                            } else {
                                queryParams['category'] = categoryParam;
                                queryParams['genre'] = categoryParam;
                            }

                            let response: StalkerOrderedListResponse;
                            if (playlist.isFullStalkerPortal) {
                                response =
                                    await stalkerSession.makeAuthenticatedRequest<StalkerOrderedListResponse>(
                                        playlist,
                                        queryParams
                                    );
                            } else {
                                response =
                                    await dataService.sendIpcEvent<StalkerOrderedListResponse>(
                                        STALKER_REQUEST,
                                        {
                                            url: playlist.portalUrl,
                                            macAddress: playlist.macAddress,
                                            params: queryParams,
                                        }
                                    );
                            }

                            if (!response?.js?.data) {
                                logger.warn(
                                    'Invalid response structure',
                                    response
                                );
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

                            if (
                                storeContext.selectedContentType() === 'itv'
                            ) {
                                const channels =
                                    newItems.map(toStalkerItvChannel);

                                if (params.pageIndex === 1) {
                                    patchState(store, {
                                        itvChannels: channels,
                                    });
                                } else {
                                    patchState(store, {
                                        itvChannels: [
                                            ...store.itvChannels(),
                                            ...channels,
                                        ],
                                    });
                                }

                                const totalLoaded =
                                    store.itvChannels().length;
                                patchState(store, {
                                    hasMoreChannels:
                                        totalLoaded <
                                        (response.js.total_items ?? 0),
                                });
                            }

                            return newItems;
                        },
                    }),
                };
            }
        ),
        withComputed((store) => {
            const storeContext = store as unknown as StalkerContentStoreContext;

            return {
                getTotalPages: computed(() => {
                    return Math.ceil(
                        store.totalCount() / storeContext.limit()
                    );
                }),
                getSelectedCategoryName: computed(() => {
                    const type = storeContext.selectedContentType();
                    const selectedCategoryId =
                        storeContext.selectedCategoryId();

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
                            String(cat.category_id) ===
                            String(selectedCategoryId)
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