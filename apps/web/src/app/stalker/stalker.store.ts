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
import { DataService, PlaylistsService, StalkerSessionService } from 'services';
import {
    Playlist,
    PlaylistMeta,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';
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
    /** For VOD items that are actually series (Ministra plugin is_series=1) */
    vodSeriesSeasons: any[];
    vodSeriesEpisodes: any[];
    selectedVodSeriesSeasonId: string;
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
    vodSeriesSeasons: [],
    vodSeriesEpisodes: [],
    selectedVodSeriesSeasonId: undefined,
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

/**
 * Sort episodes by series_number in ascending numeric order (1, 2, 3... not "1", "10", "2")
 */
function sortEpisodesByNumber(episodes: any[]): any[] {
    if (!episodes) return [];
    return episodes.sort((a, b) => {
        const numA = parseInt(a.series_number, 10) || 0;
        const numB = parseInt(b.series_number, 10) || 0;
        return numA - numB;
    });
}

/**
 * Convert relative URLs to absolute URLs using the portal base URL
 * Handles screenshot_uri and cmd paths that come as relative from the server
 */
function makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
    if (!relativePath) return '';
    // Already absolute URL
    if (
        relativePath.startsWith('http://') ||
        relativePath.startsWith('https://')
    ) {
        return relativePath;
    }
    // Parse the base URL to get origin
    try {
        const url = new URL(baseUrl);
        // Ensure the relative path starts with /
        const path = relativePath.startsWith('/')
            ? relativePath
            : `/${relativePath}`;
        return `${url.origin}${path}`;
    } catch {
        return relativePath;
    }
}

/**
 * Post-process stalker items to convert relative URLs to absolute
 */
function processItemUrls(item: any, portalUrl: string): any {
    const processed = { ...item };

    // Convert screenshot_uri to absolute URL
    if (processed.screenshot_uri) {
        processed.screenshot_uri = makeAbsoluteUrl(
            portalUrl,
            processed.screenshot_uri
        );
    }

    return processed;
}

export const StalkerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps(
        (
            store,
            dataService = inject(DataService),
            stalkerSession = inject(StalkerSessionService)
        ) => ({
            /**
             * Helper to make stalker requests with automatic token handling
             */
            async makeStalkerRequest(
                playlist: PlaylistMeta,
                params: Record<string, any>
            ) {
                // Get token if it's a full stalker portal
                let token: string | undefined;
                let serialNumber: string | undefined;
                if ((playlist as Playlist).isFullStalkerPortal) {
                    try {
                        const result = await stalkerSession.ensureToken(
                            playlist as Playlist
                        );
                        token = result.token ?? undefined;
                        serialNumber = (playlist as Playlist)
                            .stalkerSerialNumber;
                    } catch (error) {
                        console.error('Failed to get stalker token:', error);
                    }
                }

                return dataService.sendIpcEvent(STALKER_REQUEST, {
                    url: playlist.portalUrl,
                    macAddress: playlist.macAddress,
                    params,
                    token,
                    serialNumber,
                });
            },
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
                        console.warn(
                            '[StalkerStore] Invalid categories response:',
                            response
                        );
                        return [];
                    }

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

                    // Guard: ensure currentPlaylist is available (may not be during deep link init)
                    if (!currentPlaylist() || !currentPlaylist().portalUrl) {
                        return Promise.resolve(undefined);
                    }
                    // VOD uses 'genre' param, series uses 'category' param, itv uses both
                    // Based on stalker-to-m3u implementation
                    const categoryParam = params.category ?? '';
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
                        console.warn(
                            '[StalkerStore] Invalid response structure:',
                            response
                        );
                        return [];
                    }

                    patchState(store, {
                        totalCount: response.js.total_items ?? 0,
                    });

                    const portalUrl = currentPlaylist().portalUrl;
                    const newItems = response.js.data.map((item) => {
                        // Post-process to convert relative URLs to absolute
                        const processed = processItemUrls(item, portalUrl);
                        return {
                            ...processed,
                            cover: processed.screenshot_uri,
                        };
                    });

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
                                totalLoaded < (response.js.total_items ?? 0),
                        });
                    }

                    return newItems;
                },
            }),
            serialSeasonsResource: resource({
                params: () => ({
                    itemId: store.selectedSerialId(),
                }),
                loader: async ({ params }) => {
                    // Guard: ensure currentPlaylist and itemId are available
                    if (!store.currentPlaylist() || !params.itemId) {
                        return [];
                    }
                    const playlist = store.currentPlaylist() as Playlist;
                    const queryParams = {
                        action: StalkerContentTypes.series.getContentAction,
                        type: 'series',
                        movie_id: params.itemId,
                    };

                    // Use makeAuthenticatedRequest for automatic retry on auth failure
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
                        console.warn(
                            '[StalkerStore] Invalid seasons response:',
                            response
                        );
                        return [];
                    }
                    return sortByNumericValue(response.js.data);
                },
            }),
            /**
             * Resource to fetch seasons for VOD items that are actually series (is_series=1)
             * Used for Ministra plugin where VOD items can contain series/seasons
             */
            vodSeriesSeasonsResource: resource({
                params: () => ({
                    selectedItem: store.selectedItem(),
                }),
                loader: async ({ params }) => {
                    const item = params.selectedItem;
                    // Only fetch if item is a VOD series (has is_series flag)
                    if (!store.currentPlaylist() || !item || !item.is_series) {
                        return [];
                    }

                    const playlist = store.currentPlaylist() as Playlist;
                    const queryParams = {
                        action: StalkerPortalActions.GetOrderedList,
                        type: 'vod',
                        movie_id: item.id,
                        p: '1',
                    };

                    let response: any;
                    if (playlist.isFullStalkerPortal) {
                        response =
                            await stalkerSession.makeAuthenticatedRequest(
                                playlist,
                                queryParams
                            );
                    } else {
                        response = await dataService.sendIpcEvent(
                            STALKER_REQUEST,
                            {
                                url: playlist.portalUrl,
                                macAddress: playlist.macAddress,
                                params: queryParams,
                            }
                        );
                    }

                    if (!response?.js?.data) {
                        return [];
                    }

                    // Filter for season items (is_season: true)
                    const seasons = response.js.data.filter(
                        (item: any) => item.is_season === true
                    );
                    return sortByNumericValue(seasons);
                },
            }),
        })
    ),
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
        isSerialSeasonsLoading: computed(() =>
            store.serialSeasonsResource.isLoading()
        ),
        /** VOD series (Ministra plugin is_series=1) */
        getVodSeriesSeasonsResource: computed(() =>
            store.vodSeriesSeasonsResource.value()
        ),
        isVodSeriesSeasonsLoading: computed(() =>
            store.vodSeriesSeasonsResource.isLoading()
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
            stalkerSession = inject(StalkerSessionService),
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
            clearSelectedItem() {
                patchState(store, {
                    selectedVodId: undefined,
                    selectedSerialId: undefined,
                    selectedItvId: undefined,
                    selectedItem: undefined,
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
            /**
             * Fetch episodes for a VOD series season (Ministra plugin)
             * @param videoId The video_id from the season item
             * @param seasonId The season id
             * @returns Array of episode items
             */
            async fetchVodSeriesEpisodes(
                videoId: string,
                seasonId: string
            ): Promise<any[]> {
                const playlist = store.currentPlaylist() as Playlist;
                if (!playlist) return [];

                const queryParams = {
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'vod',
                    movie_id: videoId,
                    season_id: seasonId,
                    p: '1',
                };

                let response: any;
                if (playlist.isFullStalkerPortal) {
                    response = await stalkerSession.makeAuthenticatedRequest(
                        playlist,
                        queryParams
                    );
                } else {
                    response = await dataService.sendIpcEvent(STALKER_REQUEST, {
                        url: playlist.portalUrl,
                        macAddress: playlist.macAddress,
                        params: queryParams,
                    });
                }

                if (!response?.js?.data) {
                    return [];
                }

                // Filter for episode items (is_episode: true) and sort by series_number
                const episodes = sortEpisodesByNumber(
                    response.js.data.filter(
                        (item: any) => item.is_episode === true
                    )
                );

                // Store episodes and selected season
                patchState(store, {
                    vodSeriesEpisodes: episodes,
                    selectedVodSeriesSeasonId: seasonId,
                });

                return episodes;
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

                // Always use create_link to get the tokenized streaming URL
                // The server adds the required token for playback authorization
                // Note: cmd is already transformed during item processing (has_files items)
                const params = {
                    action: StalkerContentTypes[store.selectedContentType()]
                        .getLink,
                    cmd: cmd,
                    type,
                    disable_ad: '0',
                    download: '0',
                    JsHttpRequest: '1-xml',
                    ...(series ? { series: String(series) } : {}),
                };

                // Use makeAuthenticatedRequest for automatic retry on auth failure
                const playlist = store.currentPlaylist() as Playlist;
                let response: any;
                if (playlist?.isFullStalkerPortal) {
                    // Full stalker portal - use authenticated request with retry
                    response = await stalkerSession.makeAuthenticatedRequest(
                        playlist,
                        params
                    );
                } else {
                    // Simple stalker portal - no auth needed
                    response = await dataService.sendIpcEvent(STALKER_REQUEST, {
                        url: portalUrl,
                        macAddress,
                        params,
                    });
                }

                // Check for server-side errors
                if (response.js?.error) {
                    const errorMsg = response.js.error;
                    console.error('[StalkerStore] Server error:', errorMsg);
                    throw new Error(errorMsg);
                }

                let url = response.js.cmd as string;

                // If cmd is empty, the content is not available
                if (!url) {
                    throw new Error('nothing_to_play');
                }

                if (url.startsWith('ffmpeg')) {
                    url = url.split(' ')[1];
                }
                // Handle incomplete URLs - some portals return just query params or relative paths
                if (
                    url &&
                    !url.startsWith('http://') &&
                    !url.startsWith('https://')
                ) {
                    // Extract base URL from portal URL
                    try {
                        const portalUrlObj = new URL(portalUrl);
                        // Get the stalker portal base path (e.g., /stalker_portal from /stalker_portal/server/load.php)
                        const pathParts = portalUrlObj.pathname.split('/');
                        // Find the stalker_portal or c directory and use that as base
                        let basePath = '';
                        for (let i = 0; i < pathParts.length; i++) {
                            if (
                                pathParts[i] === 'stalker_portal' ||
                                pathParts[i] === 'c' ||
                                pathParts[i] === 'portal'
                            ) {
                                basePath =
                                    '/' + pathParts.slice(1, i + 1).join('/');
                                break;
                            }
                        }

                        // If url starts with ?, it's just query params
                        // Combine with the original cmd path to form the complete streaming URL
                        if (url.startsWith('?')) {
                            // The streaming URL is: portal origin + base path + original cmd path + token query
                            // e.g., http://portal.com + /stalker_portal + /media/12345.mpg + ?token=xxx
                            url = `${portalUrlObj.origin}${basePath}${cmd}${url}`;
                        } else if (url.startsWith('/')) {
                            // Relative path - prepend origin and base path
                            url = `${portalUrlObj.origin}${basePath}${url}`;
                        }
                    } catch {
                        // URL parsing failed, return as-is
                    }
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
                    // Use makeAuthenticatedRequest for automatic retry on auth failure
                    const playlist = store.currentPlaylist() as Playlist;
                    let response: any;
                    if (playlist?.isFullStalkerPortal) {
                        // Full stalker portal - use authenticated request with retry
                        response =
                            await stalkerSession.makeAuthenticatedRequest(
                                playlist,
                                params
                            );
                    } else {
                        // Simple stalker portal - no auth needed
                        response = await dataService.sendIpcEvent(
                            STALKER_REQUEST,
                            {
                                url: playlist.portalUrl,
                                macAddress: playlist.macAddress,
                                params,
                            }
                        );
                    }

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
            /**
             * Fetch movie files using get_ordered_list with movie_id parameter.
             * This is needed for items with has_files property to get the correct video_id
             * for the create_link request.
             */
            async fetchMovieFileId(movieId: string): Promise<string | null> {
                const playlist = store.currentPlaylist() as Playlist;
                if (!playlist) return null;

                const queryParams = {
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'vod',
                    movie_id: movieId,
                    p: '1',
                };

                let response: any;
                if (playlist.isFullStalkerPortal) {
                    response = await stalkerSession.makeAuthenticatedRequest(
                        playlist,
                        queryParams
                    );
                } else {
                    response = await dataService.sendIpcEvent(STALKER_REQUEST, {
                        url: playlist.portalUrl,
                        macAddress: playlist.macAddress,
                        params: queryParams,
                    });
                }

                // Extract id from the first data item
                if (response?.js?.data?.[0]?.id) {
                    const fileId = response.js.data[0].id;
                    return String(fileId);
                }

                return null;
            },
            /**
             * Play VOD or episode content
             * @param cmd The media command/path
             * @param title Display title
             * @param thumbnail Thumbnail URL
             * @param episodeNum Episode number (for series param in API)
             * @param episodeId Optional episode ID for playback tracking (defaults to item.id)
             * @param startTime Optional start time in seconds for resume playback
             */
            async createLinkToPlayVod(
                cmd?: string,
                title?: string,
                thumbnail?: string,
                episodeNum?: number,
                episodeId?: number,
                startTime?: number
            ) {
                try {
                    const item = this.selectedItem();
                    let cmdToUse = cmd ?? item?.cmd;

                    // For items with has_files and relative path, we need to fetch the file id first
                    if (
                        item?.has_files !== undefined &&
                        cmdToUse &&
                        !cmdToUse.includes('://') &&
                        cmdToUse.includes('/media/') &&
                        !cmdToUse.includes('/media/file_')
                    ) {
                        const fileId = await this.fetchMovieFileId(item.id);
                        if (fileId) {
                            cmdToUse = `/media/file_${fileId}.mpg`;
                        }
                    }

                    const url = await this.fetchLinkToPlay(
                        this.currentPlaylist().portalUrl,
                        this.currentPlaylist().macAddress,
                        cmdToUse,
                        episodeNum
                    );
                    this.addToRecentlyViewed({
                        ...item,
                        id: item.id,
                        cmd: cmd,
                        cover: thumbnail,
                        title,
                    });
                    const playlist = this.currentPlaylist();
                    const isEpisode = episodeNum !== undefined || episodeId !== undefined;
                    const contentInfo = {
                        playlistId: playlist._id,
                        // For episodes, use episodeId if provided, otherwise fall back to item.id
                        contentXtreamId: isEpisode && episodeId ? episodeId : Number(item.id),
                        contentType: isEpisode ? 'episode' : 'vod',
                        seriesXtreamId: isEpisode ? Number(item.id) : undefined,
                    };

                    playerService.openPlayer(
                        url,
                        title,
                        thumbnail,
                        true,
                        false,
                        playlist?.userAgent,
                        playlist?.referrer,
                        playlist?.origin,
                        contentInfo,
                        startTime
                    );
                } catch (error) {
                    console.error(
                        '[StalkerStore] Failed to get playback URL:',
                        error
                    );
                    const errorMessage =
                        error?.message === 'nothing_to_play'
                            ? translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                            : translate.instant('PORTALS.PLAYBACK_ERROR');
                    snackBar.open(errorMessage, null, { duration: 3000 });
                }
            },
            addToRecentlyViewed(item: any) {
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
