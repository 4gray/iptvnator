import { computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
    patchState,
    signalStore,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { Store } from '@ngrx/store';
import {
    catchError,
    combineLatestWith,
    EMPTY,
    from,
    lastValueFrom,
    pipe,
    switchMap,
    tap,
} from 'rxjs';
import { XtreamCodeActions } from '../../../shared/xtream-code-actions';
import { XtreamSerieDetails } from '../../../shared/xtream-serie-details.interface';
import { XtreamVodDetails } from '../../../shared/xtream-vod-details.interface';
import { DataService } from '../services/data.service';
import { DatabaseService } from '../services/database.service';
import { selectActivePlaylist } from '../state/selectors';
import { XtreamAccountInfo } from './account-info/account-info.interface';
import { withFavorites } from './with-favorites.feature';
import { withRecentItems } from './with-recent-items';
import { XtreamState } from './xtream-state';

const initialState: XtreamState = {
    isLoadingCategories: false,
    isLoadingContent: false,
    isImporting: false,
    itemsToImport: 0,
    liveCategories: [],
    vodCategories: [],
    serialCategories: [],
    liveStreams: [],
    vodStreams: [],
    serialStreams: [],
    page: 1,
    limit: Number(localStorage.getItem('xtream-page-size') ?? 25),
    selectedCategoryId: null,
    searchResults: [],
    selectedContentType: 'vod',
    selectedItem: null,
    importCount: 0,
    currentPlaylist: null,
    epgItems: [],
    hideExternalInfoDialog:
        localStorage.getItem('hideExternalInfoDialog') === 'true',
    portalStatus: 'unavailable',
    globalSearchResults: [],
};

/** to decode epg */
function b64DecodeUnicode(str: string) {
    return decodeURIComponent(
        Array.prototype.map
            .call(atob(str), function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            })
            .join('')
    );
}

export const XtreamStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withRecentItems(),
    withFavorites(),
    withComputed((store) => ({
        getCategoriesBySelectedType: computed(() => {
            const type = store.selectedContentType();
            return type === 'live'
                ? store.liveCategories()
                : type === 'vod'
                  ? store.vodCategories()
                  : store.serialCategories();
        }),
        getSelectedCategory: computed(() => {
            const categoryId = store.selectedCategoryId();
            return [
                ...store.vodCategories(),
                ...store.liveCategories(),
                ...store.serialCategories(),
            ].find((c) => c.id === categoryId);
        }),
        getImportCount: computed(() => store.importCount()),
        getSelectedItemById: computed(() => {
            const categoryType = store.selectedContentType();
            const content =
                categoryType === 'live'
                    ? store.liveStreams()
                    : categoryType === 'vod'
                      ? store.vodStreams()
                      : store.serialStreams();

            if (!store.selectedItem()) return null;

            return content.find(
                (item) =>
                    (item as any).stream_id ===
                        store.selectedItem().stream_id ||
                    (item as any).id === store.selectedItem().id
            );
        }),
        getPaginatedContent: computed(() => {
            const startIndex = (store.page() - 1) * store.limit();
            const endIndex = startIndex + store.limit();
            const categoryId = store.selectedCategoryId();

            if (!categoryId) {
                return [];
            }

            const categoryType = store.selectedContentType();
            const content =
                categoryType === 'live'
                    ? store.liveStreams()
                    : categoryType === 'vod'
                      ? store.vodStreams()
                      : store.serialStreams();

            return content
                .filter((item) => item.category_id === categoryId)
                .slice(startIndex, endIndex);
        }),
        getTotalPages: computed(() => {
            const categoryId = store.selectedCategoryId();
            if (!categoryId) return 0;

            const categoryType = store.selectedContentType();
            const totalItems =
                categoryType === 'live'
                    ? store
                          .liveStreams()
                          .filter((i) => Number((i as any).id) === categoryId)
                          .length
                    : categoryType === 'vod'
                      ? store
                            .vodStreams()
                            .filter((i) => Number(i.category_id) === categoryId)
                            .length
                      : store
                            .serialStreams()
                            .filter((i) => i.category_id === categoryId).length;

            return Math.ceil(totalItems / store.limit());
        }),
        selectItemsFromSelectedCategory: computed(() => {
            const categoryId = store.selectedCategoryId();
            const categoryType = store.selectedContentType();
            const content =
                categoryType === 'live'
                    ? store.liveStreams()
                    : categoryType === 'vod'
                      ? store.vodStreams()
                      : store.serialStreams();

            return content.filter((item) => item.category_id === categoryId);
        }),
        globalRecentItems: computed(() => {
            return store.recentItems(); // Remove the filter since we're getting global items directly from DB
        }),
    })),
    withMethods(
        (
            store,
            route = inject(ActivatedRoute),
            dataService = inject(DataService),
            dbService = inject(DatabaseService),
            oldStore = inject(Store)
        ) => {
            const fetchCategories = (
                action: XtreamCodeActions,
                stateKey: keyof Pick<
                    XtreamState,
                    'liveCategories' | 'vodCategories' | 'serialCategories'
                >,
                type: 'live' | 'movies' | 'series'
            ) => {
                console.log(`Fetching ${type} categories...`);
                patchState(store, { isLoadingCategories: true });
                const queryParams = {
                    action,
                    username: store.currentPlaylist().username,
                    password: store.currentPlaylist().password,
                };

                return from(
                    dbService.hasXtreamCategories(
                        route.snapshot.params.id,
                        type
                    )
                ).pipe(
                    switchMap(async (exists) => {
                        try {
                            if (exists) {
                                const localData =
                                    await dbService.getXtreamCategories(
                                        route.snapshot.params.id,
                                        type
                                    );
                                patchState(store, {
                                    [stateKey]: localData,
                                    isLoadingCategories: false,
                                });
                                return localData;
                            }

                            const remoteData = await dataService.fetchData(
                                `${store.currentPlaylist().serverUrl}/player_api.php`,
                                queryParams
                            );

                            if (remoteData && Array.isArray(remoteData)) {
                                await dbService.saveXtreamCategories(
                                    route.snapshot.params.id,
                                    remoteData,
                                    type
                                );
                            }

                            const localData =
                                await dbService.getXtreamCategories(
                                    route.snapshot.params.id,
                                    type
                                );
                            patchState(store, {
                                [stateKey]: localData,
                                isLoadingCategories: false,
                            });

                            return localData;
                        } catch (err) {
                            console.error(
                                `Error in fetchCategories for ${type}:`,
                                err
                            );
                            patchState(store, { isLoadingCategories: false });
                            throw err;
                        }
                    })
                );
            };

            const fetchStreams = (
                action: XtreamCodeActions,
                stateKey: keyof Pick<
                    XtreamState,
                    'liveStreams' | 'vodStreams' | 'serialStreams'
                >,
                type: 'live' | 'movie' | 'series'
            ) => {
                console.log(`Fetching ${type} streams...`);
                patchState(store, { isLoadingContent: true });
                const queryParams = {
                    action,
                    username: store.currentPlaylist().username,
                    password: store.currentPlaylist().password,
                };

                return from(
                    dbService.hasXtreamContent(route.snapshot.params.id, type)
                ).pipe(
                    switchMap(async (exists) => {
                        try {
                            if (exists) {
                                const localData =
                                    await dbService.getXtreamContent(
                                        route.snapshot.params.id,
                                        type
                                    );
                                patchState(store, {
                                    [stateKey]: localData,
                                    isLoadingContent: false,
                                });
                                return localData;
                            }

                            const remoteData = await dataService.fetchData(
                                `${store.currentPlaylist().serverUrl}/player_api.php`,
                                queryParams
                            );

                            if (remoteData && Array.isArray(remoteData)) {
                                patchState(store, {
                                    itemsToImport:
                                        store.itemsToImport() +
                                        remoteData.length,
                                });
                                const insertedCount =
                                    await dbService.saveXtreamContent(
                                        route.snapshot.params.id,
                                        remoteData,
                                        type,
                                        (count) =>
                                            patchState(store, {
                                                importCount: count,
                                            })
                                    );
                                console.log(`Inserted ${insertedCount} items`);
                            }

                            const localData = await dbService.getXtreamContent(
                                route.snapshot.params.id,
                                type
                            );
                            patchState(store, {
                                [stateKey]: localData,
                                isLoadingContent: false,
                            });

                            return localData;
                        } catch (err) {
                            console.error('Error in fetchStreams:', err);
                            patchState(store, { isLoadingContent: false });
                            throw err;
                        }
                    })
                );
            };

            const searchContent = async (
                searchTerm: string,
                types: string[],
                route = inject(ActivatedRoute),
                dbService = inject(DatabaseService)
            ) => {
                if (!route.snapshot.params.id) return;

                const results = await dbService.searchXtreamContent(
                    route.snapshot.params.id,
                    searchTerm,
                    types
                );
                return results;
            };

            const fetchXtreamPlaylist = rxMethod<void>(
                pipe(() => {
                    const playlistId = route.snapshot.params.id;
                    if (!playlistId) return EMPTY;
                    return from(dbService.getPlaylistById(playlistId)).pipe(
                        switchMap(async (playlist) => {
                            if (playlist) {
                                patchState(store, {
                                    currentPlaylist: playlist,
                                });
                            } else {
                                const playlist =
                                    oldStore.selectSignal(
                                        selectActivePlaylist
                                    )();
                                if (playlist) {
                                    await dbService.createPlaylist(playlist);
                                    patchState(store, {
                                        currentPlaylist: {
                                            ...playlist,
                                            serverUrl: playlist.serverUrl,
                                            id: playlist._id,
                                            name: playlist.title,
                                        },
                                    });
                                }
                            }
                        }),
                        tap((res) => {
                            console.log('Fetched playlist:', res);
                        })
                    );
                })
            );

            const fetchLiveCategories = rxMethod<void>(
                pipe(
                    switchMap(() =>
                        fetchCategories(
                            XtreamCodeActions.GetLiveCategories,
                            'liveCategories',
                            'live'
                        )
                    )
                )
            );

            const fetchVodCategories = rxMethod<void>(
                pipe(
                    switchMap(() =>
                        fetchCategories(
                            XtreamCodeActions.GetVodCategories,
                            'vodCategories',
                            'movies'
                        )
                    )
                )
            );

            const fetchSerialCategories = rxMethod<void>(
                pipe(
                    switchMap(() =>
                        fetchCategories(
                            XtreamCodeActions.GetSeriesCategories,
                            'serialCategories',
                            'series'
                        )
                    )
                )
            );

            const fetchLiveStreams = rxMethod<void>(
                pipe(
                    switchMap(() =>
                        fetchStreams(
                            XtreamCodeActions.GetLiveStreams,
                            'liveStreams',
                            'live'
                        )
                    )
                )
            );

            const fetchVodStreams = rxMethod<void>(
                pipe(
                    switchMap(() =>
                        fetchStreams(
                            XtreamCodeActions.GetVodStreams,
                            'vodStreams',
                            'movie'
                        )
                    )
                )
            );

            const fetchSerialStreams = rxMethod<void>(
                pipe(
                    switchMap(() =>
                        fetchStreams(
                            XtreamCodeActions.GetSeries,
                            'serialStreams',
                            'series'
                        )
                    )
                )
            );

            const setPage = (page: number) => patchState(store, { page });
            const setLimit = (limit: number) => patchState(store, { limit });
            const setSelectedCategory = (categoryId: number) => {
                patchState(store, {
                    selectedCategoryId: Number(categoryId),
                    page: 1,
                });
            };
            const setSelectedContentType = (type: 'live' | 'vod' | 'series') =>
                patchState(store, {
                    selectedContentType: type,
                    selectedCategoryId: null,
                });
            const setSelectedItem = (item: any) =>
                patchState(store, { selectedItem: item });
            const searchContentMethod = rxMethod<{
                term: string;
                types: string[];
            }>(
                pipe(
                    switchMap(({ term, types }) =>
                        from(searchContent(term, types, route, dbService)).pipe(
                            tap((results) => {
                                patchState(store, {
                                    searchResults: results || [],
                                });
                            })
                        )
                    )
                )
            );
            const fetchVodDetailsWithMetadata = rxMethod<{
                vodId: string;
                categoryId: number;
            }>(
                pipe(
                    combineLatestWith(oldStore.select(selectActivePlaylist)),
                    switchMap(([{ vodId, categoryId }, playlist]) => {
                        if (!playlist) return EMPTY;

                        return from(
                            dataService.fetchData(
                                `${playlist.serverUrl}/player_api.php`,
                                {
                                    action: XtreamCodeActions.GetVodInfo,
                                    username: playlist.username,
                                    password: playlist.password,
                                    vod_id: vodId,
                                }
                            )
                        ).pipe(
                            tap((currentVod: XtreamVodDetails) => {
                                patchState(store, {
                                    selectedCategoryId: Number(categoryId),
                                });
                                patchState(store, {
                                    selectedItem: {
                                        ...currentVod,
                                        stream_id: vodId,
                                    },
                                });
                            })
                        );
                    })
                )
            );

            const fetchSerialDetailsWithMetadata = rxMethod<{
                serialId: string;
                categoryId: number;
            }>(
                pipe(
                    combineLatestWith(oldStore.select(selectActivePlaylist)),
                    switchMap(([{ serialId, categoryId }, playlist]) => {
                        if (!playlist) return EMPTY;

                        return from(
                            dataService.fetchData(
                                `${playlist.serverUrl}/player_api.php`,
                                {
                                    action: XtreamCodeActions.GetSeriesInfo,
                                    username: playlist.username,
                                    password: playlist.password,
                                    series_id: serialId,
                                }
                            )
                        ).pipe(
                            tap((currentSerial: XtreamSerieDetails) => {
                                patchState(store, {
                                    selectedCategoryId: Number(categoryId),
                                });
                                patchState(store, {
                                    selectedItem: {
                                        ...currentSerial,
                                        series_id: serialId,
                                    },
                                });
                            })
                        );
                    })
                )
            );

            const initializeContent = async () => {
                patchState(store, { isImporting: true });
                try {
                    console.log('Starting content initialization...');

                    console.log('Fetching live categories...');
                    await lastValueFrom(
                        fetchCategories(
                            XtreamCodeActions.GetLiveCategories,
                            'liveCategories',
                            'live'
                        )
                    );
                    await lastValueFrom(
                        fetchCategories(
                            XtreamCodeActions.GetVodCategories,
                            'vodCategories',
                            'movies'
                        )
                    );
                    await lastValueFrom(
                        fetchCategories(
                            XtreamCodeActions.GetSeriesCategories,
                            'serialCategories',
                            'series'
                        )
                    );

                    console.log('Fetching content...');
                    await lastValueFrom(
                        fetchStreams(
                            XtreamCodeActions.GetLiveStreams,
                            'liveStreams',
                            'live'
                        )
                    );
                    await lastValueFrom(
                        fetchStreams(
                            XtreamCodeActions.GetVodStreams,
                            'vodStreams',
                            'movie'
                        )
                    );
                    await lastValueFrom(
                        fetchStreams(
                            XtreamCodeActions.GetSeries,
                            'serialStreams',
                            'series'
                        )
                    );
                    console.log('Content initialization completed');
                } catch (error) {
                    console.error(
                        'Error during content initialization:',
                        error
                    );
                } finally {
                    patchState(store, { isImporting: false });
                }
            };

            const checkPortalStatus = rxMethod<void>(
                pipe(
                    combineLatestWith(oldStore.select(selectActivePlaylist)),
                    switchMap(([_, playlist]) => {
                        if (!playlist) return EMPTY;

                        return from(
                            dataService.fetchData(
                                `${playlist.serverUrl}/player_api.php`,
                                {
                                    username: playlist.username,
                                    password: playlist.password,
                                    action: 'get_account_info',
                                }
                            )
                        ).pipe(
                            tap((response: XtreamAccountInfo) => {
                                console.log(
                                    'Portal status response:',
                                    response
                                );

                                if (!response?.user_info?.status) {
                                    patchState(store, {
                                        portalStatus: 'unavailable',
                                    });
                                    return;
                                }

                                if (response.user_info.status === 'Active') {
                                    const expDate = new Date(
                                        parseInt(response.user_info.exp_date) *
                                            1000
                                    );
                                    if (expDate < new Date()) {
                                        patchState(store, {
                                            portalStatus: 'expired',
                                        });
                                    } else {
                                        patchState(store, {
                                            portalStatus: 'active',
                                        });
                                    }
                                } else {
                                    patchState(store, {
                                        portalStatus: 'inactive',
                                    });
                                }
                            }),
                            catchError((error) => {
                                console.error(
                                    'Error checking portal status:',
                                    error
                                );
                                patchState(store, {
                                    portalStatus: 'unavailable',
                                });
                                return EMPTY;
                            })
                        );
                    })
                )
            );

            return {
                fetchXtreamPlaylist,
                fetchLiveCategories,
                fetchVodCategories,
                fetchSerialCategories,
                fetchLiveStreams,
                fetchVodStreams,
                fetchSerialStreams,
                setPage,
                setLimit,
                setSelectedCategory,
                setSelectedContentType,
                setSelectedItem,
                searchContent: searchContentMethod,
                fetchVodDetailsWithMetadata,
                fetchSerialDetailsWithMetadata,
                initializeContent,
                updatePlaylist(playlist: any) {
                    patchState(store, {
                        currentPlaylist: {
                            ...store.currentPlaylist(),
                            playlist,
                        },
                    });
                },
                resetSearchResults() {
                    patchState(store, {
                        searchResults: [],
                        globalSearchResults: [],
                    });
                },
                async loadEpg() {
                    console.log('Loading EPG...');
                    const remoteData = await dataService.fetchData(
                        `${store.currentPlaylist().serverUrl}/player_api.php`,
                        {
                            action: 'get_short_epg',
                            username: store.currentPlaylist().username,
                            password: store.currentPlaylist().password,
                            stream_id: store.selectedItem().xtream_id,
                            limit: 10,
                        }
                    );

                    if (
                        remoteData?.epg_listings &&
                        Array.isArray(remoteData.epg_listings)
                    ) {
                        console.log(`Got epg data categories:`, remoteData);
                        patchState(store, {
                            epgItems: remoteData.epg_listings.map((i) => ({
                                ...i,
                                title: b64DecodeUnicode(i.title).trim(),
                                description: b64DecodeUnicode(
                                    i.description
                                ).trim(),
                            })),
                        });
                    } else {
                        console.error(
                            'Invalid remote data received:',
                            remoteData
                        );
                        patchState(store, {
                            epgItems: [],
                        });
                        return [];
                    }
                },
                async loadChannelEpg(streamId: number) {
                    try {
                        const response = await dataService.fetchData(
                            `${store.currentPlaylist().serverUrl}/player_api.php`,
                            {
                                action: 'get_short_epg',
                                username: store.currentPlaylist().username,
                                password: store.currentPlaylist().password,
                                stream_id: streamId,
                                limit: 1,
                            }
                        );

                        if (
                            response?.epg_listings &&
                            Array.isArray(response.epg_listings)
                        ) {
                            return response.epg_listings.map((item) => ({
                                ...item,
                                title: b64DecodeUnicode(item.title).trim(),
                                description: b64DecodeUnicode(
                                    item.description
                                ).trim(),
                            }));
                        }
                        return [];
                    } catch (error) {
                        console.error('Error loading channel EPG:', error);
                        return [];
                    }
                },
                setHideExternalInfoDialog(hideExternalInfoDialog: boolean) {
                    localStorage.setItem(
                        'hideExternalInfoDialog',
                        store.hideExternalInfoDialog.toString()
                    );
                    patchState(store, { hideExternalInfoDialog });
                },
                checkPortalStatus,
                setGlobalSearchResults(results: any[]) {
                    patchState(store, {
                        searchResults: results,
                        globalSearchResults: results,
                    });
                },
            };
        }
    )
);
