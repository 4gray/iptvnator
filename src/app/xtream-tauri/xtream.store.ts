import { computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
    patchState,
    signalStore,
    watchState,
    withComputed,
    withHooks,
    withMethods,
    withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { Store } from '@ngrx/store';
import { from, lastValueFrom, pipe, switchMap, tap } from 'rxjs';
import { XtreamCategory } from '../../../shared/xtream-category.interface';
import { XtreamCodeActions } from '../../../shared/xtream-code-actions';
import { XtreamLiveStream } from '../../../shared/xtream-live-stream.interface';
import { XtreamSerieItem } from '../../../shared/xtream-serie-item.interface';
import { XtreamVodStream } from '../../../shared/xtream-vod-stream.interface';
import { DataService } from '../services/data.service';
import { DatabaseService } from '../services/database.service';
import { selectActivePlaylist } from '../state/selectors';
import { EpgItem } from '../xtream/epg-item.interface';
import { FavoritesService } from './services/favorites.service';
import { withRecentItems } from './with-recent-items';

type XtreamState = {
    isLoadingCategories: boolean;
    isLoadingContent: boolean;
    isImporting: boolean;
    liveCategories: XtreamCategory[];
    vodCategories: XtreamCategory[];
    serialCategories: XtreamCategory[];
    liveStreams: XtreamLiveStream[];
    vodStreams: XtreamVodStream[];
    serialStreams: XtreamSerieItem[];
    page: number;
    limit: number;
    selectedCategoryId: number | null;
    searchResults: any[];
    selectedContentType: 'live' | 'vod' | 'series';
    selectedItem: any | null;
    importCount: number;
    itemsToImport: number;
    currentPlaylist: any | null;
    isFavorite: boolean;
    epgItems: EpgItem[];
};

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
    limit: 20,
    selectedCategoryId: null,
    searchResults: [],
    selectedContentType: 'vod',
    selectedItem: null,
    importCount: 0,
    currentPlaylist: null,
    isFavorite: false,
    epgItems: [],
};

interface XCategoryFromDb {
    id: number;
    name: string;
    playlist_id: string; // uuid
    type: 'movies' | 'live' | 'series';
    xtream_id: number;
}

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
    withState(initialState),
    withRecentItems(),
    withComputed((store) => {
        return {
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
                              .filter(
                                  (i) => Number((i as any).id) === categoryId
                              ).length
                        : categoryType === 'vod'
                          ? store
                                .vodStreams()
                                .filter(
                                    (i) => Number(i.category_id) === categoryId
                                ).length
                          : store
                                .serialStreams()
                                .filter((i) => i.category_id === categoryId)
                                .length;

                return Math.ceil(totalItems / store.limit());
            }),
        };
    }),
    withMethods(
        (
            store,
            route = inject(ActivatedRoute),
            dataService = inject(DataService),
            dbService = inject(DatabaseService),
            oldStore = inject(Store),
            favoritesService = inject(FavoritesService)
        ) => {
            const checkLocalData = async (
                type: 'live' | 'movies' | 'series'
            ) => {
                const playlistId = route.snapshot.params.id;
                console.log('Checking local data...', playlistId, type);
                const db = await dbService.getConnection();
                const result = await db.select<XCategoryFromDb[]>(
                    'SELECT * FROM categories WHERE playlist_id = ? AND type = ?',
                    [playlistId, type]
                );
                console.log(`Local data for ${type}:`, result);
                return result.length > 0;
            };

            const saveCategoriesToDb = async (
                categories: XtreamCategory[],
                type: 'live' | 'movies' | 'series'
            ) => {
                const playlistId = route.snapshot.params.id;
                const db = await dbService.getConnection();
                for (const category of categories) {
                    await db.execute(
                        'INSERT INTO categories (playlist_id, name, type, xtream_id) VALUES (?, ?, ?, ?)',
                        [
                            playlistId,
                            category.category_name,
                            type,
                            category.category_id,
                        ]
                    );
                }
            };

            const getLocalCategories = async (
                type: 'live' | 'movies' | 'series'
            ) => {
                const playlistId = route.snapshot.params.id;

                const db = await dbService.getConnection();
                return await db.select(
                    'SELECT * FROM categories WHERE playlist_id = ? AND type = ?',
                    [playlistId, type]
                );
            };

            const checkLocalContent = async (
                type: 'live' | 'movie' | 'series'
            ) => {
                const playlistId = route.snapshot.params.id;
                console.log('Checking local content...');
                const db = await dbService.getConnection();
                const result = await db.select(
                    `SELECT c.* FROM content c 
                     JOIN categories cat ON c.category_id = cat.id 
                     WHERE cat.playlist_id = ? AND c.type = ?
                     ORDER BY c.added`,
                    [playlistId, type]
                );
                return (result as any[]).length > 0;
            };

            const saveContentToDb = async (
                streams: any[],
                type: 'live' | 'movie' | 'series'
            ) => {
                const playlistId = route.snapshot.params.id;

                console.log('Saving content to db...', {
                    playlistId,
                    streamCount: streams.length,
                    type,
                    sampleStream: streams[0],
                });

                patchState(store, {
                    itemsToImport: store.itemsToImport() + streams.length,
                });

                try {
                    const db = await dbService.getConnection();
                    const dbType =
                        type === 'series'
                            ? 'series'
                            : type === 'movie'
                              ? 'movies'
                              : 'live';

                    const categories: any[] = await db.select(
                        'SELECT id, xtream_id FROM categories WHERE playlist_id = ? AND type = ?',
                        [playlistId, dbType]
                    );

                    console.log('Found categories in DB:', {
                        type: dbType,
                        count: categories.length,
                        categories: categories,
                    });

                    const categoryMap = new Map(
                        categories.map((c) => [parseInt(c.xtream_id), c.id])
                    );

                    // Prepare bulk insert data
                    const bulkInsertData = streams
                        .map((stream) => {
                            const streamCategoryId =
                                type === 'series'
                                    ? parseInt(stream.category_id || '0')
                                    : parseInt(stream.category_id);

                            const categoryId =
                                categoryMap.get(streamCategoryId);
                            if (!categoryId) return null;

                            const title =
                                type === 'series'
                                    ? stream.title ||
                                      stream.name ||
                                      `Unknown Series ${stream.series_id}`
                                    : stream.name ||
                                      stream.title ||
                                      `Unknown Stream ${stream.stream_id}`;

                            return [
                                categoryId,
                                title,
                                stream.rating || '',
                                type === 'series'
                                    ? stream.last_modified || ''
                                    : stream.added || '',
                                stream.stream_icon ||
                                    stream.poster ||
                                    stream.cover ||
                                    '',
                                type === 'series'
                                    ? parseInt(stream.series_id || '0')
                                    : parseInt(stream.stream_id || '0'),
                                type,
                            ];
                        })
                        .filter((data) => data !== null);

                    if (bulkInsertData.length > 0) {
                        // Process in chunks to avoid SQLite variable limit
                        // Each row has 7 variables, so we'll insert 100 rows at a time (700 variables)
                        const CHUNK_SIZE = 100;
                        const chunks = [];

                        for (
                            let i = 0;
                            i < bulkInsertData.length;
                            i += CHUNK_SIZE
                        ) {
                            chunks.push(
                                bulkInsertData.slice(i, i + CHUNK_SIZE)
                            );
                        }

                        let totalInserted = 0;

                        for (const chunk of chunks) {
                            try {
                                // Construct the bulk insert query for this chunk
                                const placeholders = chunk
                                    .map(() => '(?, ?, ?, ?, ?, ?, ?)')
                                    .join(', ');

                                const query = `
                                    INSERT INTO content (
                                        category_id, title, rating, added,
                                        poster_url, xtream_id, type
                                    ) VALUES ${placeholders}
                                `;

                                // Flatten the chunk array for the bulk insert
                                const flattenedValues = chunk.flat();

                                await db.execute(query, flattenedValues);
                                totalInserted += chunk.length;

                                console.log(
                                    `Successfully inserted chunk of ${chunk.length} streams. Total: ${totalInserted}/${bulkInsertData.length}`
                                );
                            } catch (err) {
                                console.error(
                                    'Error in bulk insert chunk:',
                                    err
                                );
                            }
                        }

                        patchState(store, {
                            importCount: store.importCount() + totalInserted,
                        });

                        console.log(
                            `Completed bulk insert: ${totalInserted} of ${bulkInsertData.length} streams inserted`
                        );
                    }
                } catch (err) {
                    console.error('Error in saveContentToDb:', err);
                }
            };

            const getLocalContent = async (
                type: 'live' | 'movie' | 'series'
            ) => {
                const playlistId = route.snapshot.params.id;

                console.log('Getting local content...');
                const db = await dbService.getConnection();
                return await db.select(
                    `SELECT c.* FROM content c 
                     JOIN categories cat ON c.category_id = cat.id 
                     WHERE cat.playlist_id = ? AND c.type = ?`,
                    [playlistId, type]
                );
            };

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

                return from(checkLocalData(type)).pipe(
                    switchMap(async (exists) => {
                        try {
                            if (exists) {
                                const localData =
                                    await getLocalCategories(type);
                                patchState(store, {
                                    [stateKey]: localData,
                                    isLoadingCategories: false,
                                });
                                return localData;
                            }
                            console.log(
                                'Fetching remote categories:',
                                store.currentPlaylist()
                            );
                            const remoteData = await dataService.fetchData(
                                `${store.currentPlaylist().api_url}/player_api.php`,
                                queryParams
                            );

                            if (remoteData && Array.isArray(remoteData)) {
                                console.log(
                                    `Got remote ${type} categories:`,
                                    remoteData.length
                                );
                                await saveCategoriesToDb(remoteData, type);
                            } else {
                                console.error(
                                    'Invalid remote data received:',
                                    remoteData
                                );
                                patchState(store, {
                                    isLoadingCategories: false,
                                });
                                return [];
                            }

                            const localData: any =
                                await getLocalCategories(type);
                            console.log(
                                `Loaded ${type} categories from DB:`,
                                localData.length
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

                return from(checkLocalContent(type)).pipe(
                    switchMap(async (exists) => {
                        try {
                            if (exists) {
                                const localData = await getLocalContent(type);
                                patchState(store, {
                                    [stateKey]: localData,
                                    isLoadingContent: false,
                                });
                                return localData;
                            }

                            const remoteData = await dataService.fetchData(
                                `${store.currentPlaylist().api_url}/player_api.php`,
                                queryParams
                            );

                            if (remoteData && Array.isArray(remoteData)) {
                                await saveContentToDb(remoteData, type);
                            }

                            const localData = await getLocalContent(type);

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
                types: string[]
            ) => {
                const db = await dbService.getConnection();
                const placeholders = types.map(() => '?').join(',');
                const playlistId = route.snapshot.params.id;
                const results: any[] = await db.select(
                    `SELECT c.* FROM content c 
                     JOIN categories cat ON c.category_id = cat.id 
                     WHERE (c.title LIKE ?)
                     AND cat.playlist_id = ?
                     AND c.type IN (${placeholders})
                     LIMIT 50`,
                    [`%${searchTerm}%`, playlistId, ...types]
                );

                patchState(store, { searchResults: results });
            };

            /* const fetchXtreamPlaylist = rxMethod<void>(
                pipe(() => {
                    const playlistId = route.snapshot.params.id;
                    return from(dbService.getConnection()).pipe(
                        switchMap((db) =>
                            from(
                                db.select(
                                    'SELECT * FROM playlists WHERE id = ?',
                                    [playlistId]
                                )
                            )
                        ),
                        tap((res) => {
                            console.log('Fetched playlist:', res);
                            if (res[0])
                                patchState(store, { currentPlaylist: res[0] });
                        })
                    );
                })
            ); */
            const fetchXtreamPlaylist = rxMethod<void>(
                pipe(() => {
                    const playlistId = route.snapshot.params.id;
                    return from(dbService.getConnection()).pipe(
                        switchMap((db) =>
                            from(
                                db.select(
                                    'SELECT * FROM playlists WHERE id = ?',
                                    [playlistId]
                                )
                            )
                        ),
                        switchMap(async (res) => {
                            if (res[0]) {
                                patchState(store, { currentPlaylist: res[0] });
                            } else {
                                const playlist =
                                    oldStore.selectSignal(
                                        selectActivePlaylist
                                    )();
                                console.log(
                                    'Fetched playlist from default store:',
                                    playlist
                                );
                                if (playlist) {
                                    const db = await dbService.getConnection();
                                    // Insert into DB
                                    await db.execute(
                                        'INSERT INTO playlists (id, name, api_url, username, password, type) VALUES (?, ?, ?, ?, ?, ?)',
                                        [
                                            playlist._id,
                                            playlist.title,
                                            playlist.serverUrl,
                                            playlist.username,
                                            playlist.password,
                                            'xtream',
                                        ]
                                    );
                                    patchState(store, {
                                        currentPlaylist: {
                                            ...playlist,
                                            api_url: playlist.serverUrl,
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
            const setSelectedCategory = (categoryId: number) =>
                patchState(store, {
                    selectedCategoryId: Number(categoryId),
                    page: 1,
                });
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
                        from(searchContent(term, types))
                    )
                )
            );
            const getVodDetails = async (vodId: string) => {
                const currentPlaylist = store.currentPlaylist();

                const password = currentPlaylist?.password;
                const url = `${currentPlaylist?.api_url}/player_api.php`;
                const username = currentPlaylist?.username;
                console.log('Fetching VOD details...', password, url, username);

                const queryParams = {
                    action: XtreamCodeActions.GetVodInfo,
                    username,
                    password,
                    vod_id: vodId,
                };

                const remoteData = await dataService.fetchData(
                    url,
                    queryParams
                );

                return remoteData;
            };

            const getSerialDetails = async (serialId: string) => {
                const currentPlaylist = store.currentPlaylist();

                const password = currentPlaylist?.password;
                const url = `${currentPlaylist?.api_url}/player_api.php`;
                const username = currentPlaylist?.username;
                console.log(
                    'Fetching Series details...',
                    password,
                    url,
                    username
                );

                const queryParams = {
                    action: XtreamCodeActions.GetSeriesInfo,
                    username,
                    password,
                    series_id: serialId,
                };

                const remoteData = await dataService.fetchData(
                    url,
                    queryParams
                );

                return remoteData;
            };

            const initializeContent = async () => {
                patchState(store, { isImporting: true });
                try {
                    console.log('Starting content initialization...');

                    // Categories
                    console.log('Fetching live categories...');
                    const liveCategories: any = await lastValueFrom(
                        fetchCategories(
                            XtreamCodeActions.GetLiveCategories,
                            'liveCategories',
                            'live'
                        )
                    );
                    console.log(
                        'Live categories loaded:',
                        liveCategories?.length
                    );

                    console.log('Fetching VOD categories...');
                    const vodCategories: any = await lastValueFrom(
                        fetchCategories(
                            XtreamCodeActions.GetVodCategories,
                            'vodCategories',
                            'movies'
                        )
                    );
                    console.log(
                        'VOD categories loaded:',
                        vodCategories?.length
                    );

                    console.log('Fetching serial categories...');
                    const serialCategories: any = await lastValueFrom(
                        fetchCategories(
                            XtreamCodeActions.GetSeriesCategories,
                            'serialCategories',
                            'series'
                        )
                    );
                    console.log(
                        'Serial categories loaded:',
                        serialCategories?.length
                    );

                    // Streams
                    console.log('Fetching live streams...');
                    const liveStreams: any = await lastValueFrom(
                        fetchStreams(
                            XtreamCodeActions.GetLiveStreams,
                            'liveStreams',
                            'live'
                        )
                    );
                    console.log('Live streams loaded:', liveStreams?.length);

                    console.log('Fetching VOD streams...');
                    const vodStreams: any = await lastValueFrom(
                        fetchStreams(
                            XtreamCodeActions.GetVodStreams,
                            'vodStreams',
                            'movie'
                        )
                    );
                    console.log('VOD streams loaded:', vodStreams?.length);

                    console.log('Fetching serial streams...');
                    const serialStreams: any = await lastValueFrom(
                        fetchStreams(
                            XtreamCodeActions.GetSeries,
                            'serialStreams',
                            'series'
                        )
                    );
                    console.log(
                        'Serial streams loaded:',
                        serialStreams?.length
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
                getVodDetails,
                getSerialDetails,
                initializeContent,
                resetSearchResults() {
                    patchState(store, { searchResults: [] });
                },
                async loadEpg() {
                    console.log('Loading EPG...');
                    const remoteData = await dataService.fetchData(
                        `${store.currentPlaylist().api_url}/player_api.php`,
                        {
                            action: 'get_short_epg',
                            username: store.currentPlaylist().username,
                            password: store.currentPlaylist().password,
                            stream_id: store.selectedItem().xtream_id,
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
                async toggleFavorite() {
                    const item = store.selectedItem();
                    const playlist = store.currentPlaylist();

                    if (!item || !playlist) return;

                    const contentId =
                        item.movie_data?.stream_id || item.series_id;
                    const isFavorite = await favoritesService.isFavorite(
                        contentId,
                        playlist.id
                    );

                    if (isFavorite) {
                        await favoritesService.removeFromFavorites(
                            contentId,
                            playlist.id
                        );
                    } else {
                        await favoritesService.addToFavorites({
                            content_id: contentId,
                            playlist_id: playlist.id,
                            type: store.selectedContentType(),
                            title: item.name || item.title,
                            stream_icon: item.stream_icon || item.cover,
                        });
                    }

                    patchState(store, { isFavorite: !isFavorite });
                },

                async checkFavoriteStatus() {
                    const item = store.selectedItem();
                    const playlist = store.currentPlaylist();

                    if (!item || !playlist) {
                        patchState(store, { isFavorite: false });
                        return;
                    }

                    const isFavorite = await favoritesService.isFavorite(
                        item.xtream_id || item.xtream_id,
                        playlist.id
                    );

                    patchState(store, { isFavorite });
                },
            };
        }
    ),
    withHooks((store) => ({
        onInit() {
            watchState(store, (state) => {
                console.log('[watchState] xtream state', state);
            });
        },
    }))
);
