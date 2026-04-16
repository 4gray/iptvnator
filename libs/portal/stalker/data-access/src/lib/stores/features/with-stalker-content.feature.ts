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
import { DataService } from 'services';
import {
    StalkerCategoryItem,
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    ResourceState,
    StalkerCategorySliceContract,
    StalkerContentFeatureStoreContract,
    StalkerContentType,
} from '../stalker-store.contracts';
import {
    executeStalkerRequest,
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
    hasMoreChannels: boolean;
    itvChannels: StalkerItvChannel[];
    paginatedContent: StalkerContentItem[];
    categoryError: unknown;
    contentError: unknown;
}

const initialContentState: StalkerContentState = {
    totalCount: 0,
    vodCategories: [],
    seriesCategories: [],
    itvCategories: [],
    hasMoreChannels: false,
    itvChannels: [],
    paginatedContent: [],
    categoryError: null,
    contentError: null,
};

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
    }
}

function prependAllCategory(
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
        categories.unshift({
            category_name: translateService.instant('PORTALS.ALL_CATEGORIES'),
            category_id: '*',
        });
    }

    return categories;
}

function buildEmptyContentPatch(
    contentType: StalkerContentType,
    error: unknown
): Partial<StalkerContentState> {
    const patch: Partial<StalkerContentState> = {
        totalCount: 0,
        paginatedContent: [],
        contentError: error,
    };

    if (contentType === 'itv') {
        patch.hasMoreChannels = false;
        patch.itvChannels = [];
    }

    return patch;
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
                const storeContext = store as typeof store &
                    StalkerContentResourceStoreContract;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                };

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
                                    patchState(store, {
                                        ...buildCategoryPatch(
                                            params.contentType,
                                            []
                                        ),
                                        categoryError: invalidResponseError,
                                    });
                                    return [];
                                }

                                const categories = prependAllCategory(
                                    response.js
                                        .map(
                                            (item): StalkerCategoryItem => ({
                                                category_name: item.title ?? '',
                                                category_id: String(item.id),
                                            })
                                        )
                                        .sort((left, right) =>
                                            left.category_name.localeCompare(
                                                right.category_name
                                            )
                                        ),
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
                            search: storeContext.searchPhrase(),
                            pageIndex: storeContext.page() + 1,
                            currentPlaylist: storeContext.currentPlaylist(),
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

                            try {
                                const response =
                                    await executeStalkerRequest<StalkerOrderedListResponse>(
                                        requestDeps,
                                        playlist,
                                        queryParams
                                    );

                                if (!Array.isArray(response?.js?.data)) {
                                    const invalidResponseError = new Error(
                                        'Invalid response structure'
                                    );
                                    logger.warn(
                                        'Invalid response structure',
                                        response
                                    );
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

                                if (params.contentType === 'itv') {
                                    const channels =
                                        newItems.map(toStalkerItvChannel);
                                    const nextChannels =
                                        params.pageIndex === 1
                                            ? channels
                                            : [
                                                  ...store.itvChannels(),
                                                  ...channels,
                                              ];

                                    patchState(store, {
                                        totalCount:
                                            response.js.total_items ?? 0,
                                        paginatedContent: newItems,
                                        contentError: null,
                                        itvChannels: nextChannels,
                                        hasMoreChannels:
                                            nextChannels.length <
                                            (response.js.total_items ?? 0),
                                    });
                                } else {
                                    patchState(store, {
                                        totalCount:
                                            response.js.total_items ?? 0,
                                        paginatedContent: newItems,
                                        contentError: null,
                                        hasMoreChannels: false,
                                    });
                                }

                                return newItems;
                            } catch (error) {
                                logger.warn('Error loading content', {
                                    contentType: params.contentType,
                                    category: params.category,
                                    error,
                                });
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

            return {
                getTotalPages: computed(() =>
                    Math.ceil(store.totalCount() / storeContext.limit())
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
        withMethods((store) => ({
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
                    categoryError: null,
                });
            },
            setItvChannels(channels: StalkerItvChannel[]) {
                patchState(store, { itvChannels: channels });
            },
        }))
    );
}
