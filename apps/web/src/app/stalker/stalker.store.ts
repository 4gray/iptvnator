import { computed, inject, resource, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    patchState,
    signalStore,
    withComputed,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistMeta, STALKER_REQUEST } from 'shared-interfaces';
import { DataService } from '../../../../../libs/services/src/lib/data.service';
import { PlaylistsService } from '../../../../../libs/services/src/lib/playlists.service';
import { StalkerPortalActions } from '../../shared/stalker-portal-actions.enum';
import { PlayerService } from '../services/player.service';
import { ContentType } from '../xtream/content-type.enum';
import { StalkerSeason } from './models/stalker-season.interface';
import { StalkerContentTypes } from './stalker-content-types';

interface StalkerCategoryItem {
    category_id: string;
    category_name: string;
}

interface StalkerState {
    selectedContentType: 'vod' | 'itv' | 'series';
    selectedCategoryId: string;
    selectedVodId: string;
    selectedSerialId: string;
    selectedItvId: string;
    limit: number;
    page: number;
    searchPhrase: string;
    currentPlaylist: PlaylistMeta;
    totalCount: number;
    selectedItem: any;
    vodCategories: StalkerCategoryItem[];
    seriesCategories: StalkerCategoryItem[];
    itvCategories: StalkerCategoryItem[];
    hasMoreChannels: boolean;
    itvChannels: any[];
}

const initialState: StalkerState = {
    selectedContentType: 'vod',
    selectedCategoryId: undefined,
    selectedVodId: undefined,
    selectedSerialId: undefined,
    selectedItvId: undefined,
    limit: 14,
    page: 0,
    searchPhrase: '',
    currentPlaylist: undefined,
    totalCount: 0,
    selectedItem: undefined,
    vodCategories: [],
    seriesCategories: [],
    itvCategories: [],
    hasMoreChannels: false,
    itvChannels: [],
};

function extractNumericValue(str: string) {
    const matches = str.match(/\d+/);
    if (matches) {
        return parseInt(matches[0], 10);
    }
    return 0;
}

function sortByNumericValue(array: StalkerSeason[]): StalkerSeason[] {
    if (!array) return [];
    const key = 'name';
    return array.sort((a, b) => {
        const numericA = extractNumericValue(a[key]);
        const numericB = extractNumericValue(b[key]);
        return numericA - numericB;
    });
}

export const StalkerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps((store, dataService = inject(DataService)) => ({
        getCategoryResource: resource({
            params: () => ({
                contentType: store.selectedContentType(),
                action: StalkerPortalActions.GetCategories,
                currentPlaylist: store.currentPlaylist(),
            }),
            loader: async ({ params }) => {
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

                const { portalUrl, macAddress } = params.currentPlaylist;

                const response = await dataService.sendIpcEvent(
                    STALKER_REQUEST,
                    {
                        url: portalUrl,
                        macAddress,
                        params: {
                            action: StalkerContentTypes[params.contentType]
                                .getCategoryAction,
                            type: params.contentType,
                        },
                    }
                );
                if (response) {
                    const categories = response.js
                        .map((item) => ({
                            category_name: item.title,
                            category_id: item.id,
                        }))
                        .sort((a, b) =>
                            a.category_name.localeCompare(b.category_name)
                        );
                    patchState(store, {
                        [`${params.contentType}Categories`]: categories,
                    });
                    return categories;
                } else {
                    throw new Error(
                        `Error: ${response.message} (Status: ${response.status})`
                    );
                }
            },
        }),
        getContentResource: resource({
            params: () => ({
                contentType: store.selectedContentType(),
                category: store.selectedCategoryId(),
                action: StalkerPortalActions.GetOrderedList,
                search: store.searchPhrase(),
                pageIndex: store.page() + 1,
            }),
            loader: async ({ params }) => {
                if (
                    !params.category ||
                    params.category === null ||
                    params.category === ''
                ) {
                    return Promise.resolve(undefined);
                }

                const currentPlaylist = store.currentPlaylist;
                const queryParams = {
                    action: StalkerContentTypes[params.contentType]
                        .getContentAction,
                    type: params.contentType,
                    category: params.category ?? '',
                    genre: params.category ?? '',
                    sortby: 'added',
                    ...(params.search !== '' ? { search: params.search } : {}),
                    p: params.pageIndex,
                };

                const response = await dataService.sendIpcEvent(
                    STALKER_REQUEST,
                    {
                        url: currentPlaylist().portalUrl,
                        macAddress: currentPlaylist().macAddress,
                        params: queryParams,
                    }
                );

                patchState(store, { totalCount: response.js.total_items });

                if (response) {
                    const newItems = response.js.data.map((item) => ({
                        ...item,
                        cover: item.screenshot_uri,
                    }));

                    if (store.selectedContentType() === 'itv') {
                        // Check if we're loading the first page or loading more
                        if (params.pageIndex === 1) {
                            patchState(store, { itvChannels: newItems });
                        } else {
                            patchState(store, {
                                itvChannels: [
                                    ...store.itvChannels(),
                                    ...newItems,
                                ],
                            });
                        }

                        // Update hasMoreItems based on total count and current items
                        const totalLoaded = store.itvChannels().length;
                        patchState(store, {
                            hasMoreChannels:
                                totalLoaded < response.js.total_items,
                        });
                    }

                    return newItems;
                } else {
                    throw new Error(
                        `Error: ${response.message} (Status: ${response.status})`
                    );
                }
            },
        }),
        serialSeasonsResource: resource({
            params: () => ({
                itemId: store.selectedSerialId(),
            }),
            loader: async ({ params }) => {
                const { portalUrl, macAddress } = store.currentPlaylist();
                const queryParams = {
                    action: StalkerContentTypes.series.getContentAction,
                    type: 'series',
                    movie_id: params.itemId,
                };
                const response = await dataService.sendIpcEvent(
                    STALKER_REQUEST,
                    {
                        url: portalUrl,
                        macAddress,
                        params: queryParams,
                    }
                );
                return sortByNumericValue(response.js.data);
            },
        }),
    })),
    withComputed((store) => ({
        getTotalPages: computed(() => {
            return Math.ceil(store.totalCount() / store.limit());
        }),
        /** category content */
        getPaginatedContent: computed(() => store.getContentResource.value()),
        isPaginatedContentLoading: computed(() =>
            store.getContentResource.isLoading()
        ),
        isPaginatedContentFailed: computed(() =>
            store.getContentResource.error()
        ),
        /** serials */
        getSerialSeasonsResource: computed(() =>
            store.serialSeasonsResource.value()
        ),
        /** category resource */
        getCategoryResource: computed(() => store.getCategoryResource.value()),
        isCategoryResourceLoading: computed(() =>
            store.getCategoryResource.isLoading()
        ),
        isCategoryResourceFailed: computed(() =>
            store.getCategoryResource.error()
        ),
        getSelectedCategoryName: computed(() => {
            const type = store.selectedContentType();
            const selectedCategoryId = store.selectedCategoryId();
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
                (cat) => String(cat.category_id) === String(selectedCategoryId)
            );
            return category ? category.category_name : '';
        }),
    })),
    withMethods(
        (
            store,
            dataService = inject(DataService),
            playerService = inject(PlayerService),
            playlistService = inject(PlaylistsService),
            snackBar = inject(MatSnackBar),
            translate = inject(TranslateService)
        ) => ({
            /** selectors */
            setSelectedContentType(type: 'vod' | 'itv' | 'series') {
                patchState(store, { selectedContentType: type });
            },
            setSelectedCategory(id: number) {
                patchState(store, {
                    selectedCategoryId: id !== null ? String(id) : null,
                    page: 0,
                });
            },
            setSelectedSerialId(id: string) {
                patchState(store, { selectedSerialId: id });
            },
            setSelectedVodId(id: string) {
                patchState(store, { selectedVodId: id });
            },
            setSelectedItvId(id: string) {
                patchState(store, { selectedItvId: id });
            },
            setLimit(limit: number) {
                patchState(store, { limit });
            },
            setPage(page: number) {
                patchState(store, { page });
            },
            setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
                patchState(store, { currentPlaylist: playlist });
            },
            setSelectedItem(selectedItem: any) {
                // TODO: check the item type and proper property either selectedVodId or serialsId etc
                patchState(store, {
                    selectedVodId: selectedItem?.id ?? undefined,
                    selectedSerialId: selectedItem?.id ?? undefined,
                    selectedItvId: selectedItem?.id ?? undefined,
                    selectedItem,
                });
            },
            setCategories(type: 'vod' | 'series' | 'itv', categories: any[]) {
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
            setItvChannels(channels: any[]) {
                patchState(store, { itvChannels: channels });
            },
            /** getters */
            getSelectedCategory() {
                return signal<string>(store.selectedCategoryId());
            },
            /** API */
            async fetchLinkToPlay(
                portalUrl: string,
                macAddress: string,
                cmd: string,
                series?: number
            ) {
                const type = series
                    ? ContentType.VODS
                    : store.selectedContentType();
                const params = {
                    action: StalkerContentTypes[store.selectedContentType()]
                        .getLink,
                    type,
                    cmd,
                    forced_storage: 'undefined',
                    disable_ad: '0',
                    JsHttpRequest: '1-xml',
                    ...(series ? { series } : {}),
                };
                const response = await dataService.sendIpcEvent(
                    STALKER_REQUEST,
                    {
                        url: portalUrl + '?' + cmd,
                        macAddress,
                        params,
                    }
                );
                let url = response.js.cmd as string;
                if (url?.startsWith('ffmpeg')) {
                    url = url.split(' ')[1];
                }
                return url;
            },
            async getExpireDate() {
                const params = {
                    type: 'account_info',
                    action: 'get_main_info',
                    JsHttpRequest: '1-xml',
                };

                try {
                    const response = await dataService.sendIpcEvent(
                        STALKER_REQUEST,
                        {
                            url: store.currentPlaylist().portalUrl,
                            macAddress: store.currentPlaylist().macAddress,
                            params,
                        }
                    );

                    if (response && response.js && response.js.account_info) {
                        // Extract the expire date from the response
                        const expireDate = response.js.account_info.expire_date;

                        // Convert timestamp to readable date if it's a unix timestamp
                        if (expireDate && !isNaN(expireDate)) {
                            const date = new Date(expireDate * 1000); // Convert seconds to milliseconds
                            return date.toLocaleDateString();
                        }

                        return expireDate || 'Unknown';
                    }

                    return 'Unknown';
                } catch (error) {
                    console.error('Failed to fetch expire date:', error);
                    return 'Error fetching data';
                }
            },
            addToFavorites(item: any) {
                playlistService
                    .addPortalFavorite(this.currentPlaylist()?._id, {
                        ...item,
                        category_id: store.selectedContentType(),
                        added_at: Date.now(),
                        id: item.stream_id ?? item.id,
                    })
                    .subscribe(() => {
                        snackBar.open(
                            translate.instant('PORTALS.ADDED_TO_FAVORITES'),
                            null,
                            {
                                duration: 1000,
                            }
                        );
                    });
            },
            removeFromFavorites(favoriteId: string) {
                playlistService
                    .removeFromPortalFavorites(
                        this.currentPlaylist()?._id,
                        favoriteId
                    )
                    .subscribe(() => {
                        snackBar.open(
                            translate.instant('PORTALS.REMOVED_FROM_FAVORITES'),
                            null,
                            {
                                duration: 1000,
                            }
                        );
                    });
            },
            async createLinkToPlayVod(
                cmd?: string,
                title?: string,
                thumbnail?: string,
                episode?: number
            ) {
                const url = await this.fetchLinkToPlay(
                    this.currentPlaylist().portalUrl,
                    this.currentPlaylist().macAddress,
                    cmd ?? this.selectedItem().cmd,
                    episode
                );
                const item = this.selectedItem();
                this.addToRecentlyViewed({
                    ...item,
                    id: item.id,
                    cmd: cmd,
                    cover: thumbnail,
                    title,
                });
                playerService.openPlayer(url, title, thumbnail);
            },
            addToRecentlyViewed(item: any) {
                console.log('Adding to recently viewed', item);
                playlistService
                    .addPortalRecentlyViewed(this.currentPlaylist()?._id, {
                        ...item,
                        category_id: store.selectedContentType(),
                        added_at: Date.now(),
                    })
                    .subscribe();
            },
            removeFromRecentlyViewed(itemId: number) {
                playlistService
                    .removeFromPortalRecentlyViewed(
                        this.currentPlaylist()?._id,
                        itemId
                    )
                    .subscribe();
            },
        })
    )
);
