type PreloadInvokeCase = {
    method: string;
    args: unknown[];
    channel: string;
    forwardedArgs: unknown[];
};

const playlistId = 'playlist-1';
export const operationId = 'operation-1';
const playlist = { id: playlistId, name: 'Playlist', type: 'xtream' };
const playlists = [playlist];
const playlistUpdates = { name: 'Updated playlist' };
const categories = [{ category_id: '10', category_name: 'Live' }];
const streams = [{ stream_id: 42, name: 'Channel' }];
const favorites = [{ contentId: 1, playlistId }];
const recentlyViewed = [{ contentId: 2, playlistId }];
const categoryIds = [10, 11];
const reorderUpdates = [{ content_id: 12, position: 1 }];
const recentItemsBatch = [{ contentId: 13, playlistId }];
const playbackData = {
    contentXtreamId: 42,
    contentType: 'vod',
    positionSeconds: 120,
};

export const dbPreloadCases: PreloadInvokeCase[] = [
    {
        method: 'dbCreatePlaylist',
        args: [playlist],
        channel: 'DB_CREATE_PLAYLIST',
        forwardedArgs: [playlist],
    },
    {
        method: 'dbGetPlaylist',
        args: [playlistId],
        channel: 'DB_GET_PLAYLIST',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbUpsertAppPlaylist',
        args: [playlist],
        channel: 'DB_UPSERT_APP_PLAYLIST',
        forwardedArgs: [playlist],
    },
    {
        method: 'dbUpsertAppPlaylists',
        args: [playlists],
        channel: 'DB_UPSERT_APP_PLAYLISTS',
        forwardedArgs: [playlists],
    },
    {
        method: 'dbGetAppPlaylists',
        args: [],
        channel: 'DB_GET_APP_PLAYLISTS',
        forwardedArgs: [],
    },
    {
        method: 'dbGetAppPlaylist',
        args: [playlistId],
        channel: 'DB_GET_APP_PLAYLIST',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbUpdatePlaylist',
        args: [playlistId, playlistUpdates],
        channel: 'DB_UPDATE_PLAYLIST',
        forwardedArgs: [playlistId, playlistUpdates],
    },
    {
        method: 'dbDeletePlaylist',
        args: [playlistId, operationId],
        channel: 'DB_DELETE_PLAYLIST',
        forwardedArgs: [playlistId, operationId],
    },
    {
        method: 'dbDeleteXtreamContent',
        args: [playlistId, operationId],
        channel: 'DB_DELETE_XTREAM_CONTENT',
        forwardedArgs: [playlistId, operationId],
    },
    {
        method: 'dbRestoreXtreamUserData',
        args: [playlistId, favorites, recentlyViewed, operationId],
        channel: 'DB_RESTORE_XTREAM_USER_DATA',
        forwardedArgs: [playlistId, favorites, recentlyViewed, operationId],
    },
    {
        method: 'dbHasCategories',
        args: [playlistId, 'live'],
        channel: 'DB_HAS_CATEGORIES',
        forwardedArgs: [playlistId, 'live'],
    },
    {
        method: 'dbGetCategories',
        args: [playlistId, 'live'],
        channel: 'DB_GET_CATEGORIES',
        forwardedArgs: [playlistId, 'live'],
    },
    {
        method: 'dbSaveCategories',
        args: [playlistId, categories, 'live', categoryIds],
        channel: 'DB_SAVE_CATEGORIES',
        forwardedArgs: [playlistId, categories, 'live', categoryIds],
    },
    {
        method: 'dbGetAllCategories',
        args: [playlistId, 'live'],
        channel: 'DB_GET_ALL_CATEGORIES',
        forwardedArgs: [playlistId, 'live'],
    },
    {
        method: 'dbUpdateCategoryVisibility',
        args: [categoryIds, true],
        channel: 'DB_UPDATE_CATEGORY_VISIBILITY',
        forwardedArgs: [categoryIds, true],
    },
    {
        method: 'dbHasContent',
        args: [playlistId, 'movie'],
        channel: 'DB_HAS_CONTENT',
        forwardedArgs: [playlistId, 'movie'],
    },
    {
        method: 'dbGetContent',
        args: [playlistId, 'movie'],
        channel: 'DB_GET_CONTENT',
        forwardedArgs: [playlistId, 'movie'],
    },
    {
        method: 'dbSaveContent',
        args: [playlistId, streams, 'movie', operationId],
        channel: 'DB_SAVE_CONTENT',
        forwardedArgs: [playlistId, streams, 'movie', operationId],
    },
    {
        method: 'dbClearXtreamImportCache',
        args: [playlistId, 'movie'],
        channel: 'DB_CLEAR_XTREAM_IMPORT_CACHE',
        forwardedArgs: [playlistId, 'movie'],
    },
    {
        method: 'dbSearchContent',
        args: [playlistId, 'matrix', ['movie'], true],
        channel: 'DB_SEARCH_CONTENT',
        forwardedArgs: [playlistId, 'matrix', ['movie'], true],
    },
    {
        method: 'dbGlobalSearch',
        args: ['matrix', ['movie'], true],
        channel: 'DB_GLOBAL_SEARCH',
        forwardedArgs: ['matrix', ['movie'], true],
    },
    {
        method: 'dbGetGlobalRecentlyAdded',
        args: ['vod', 50, 'xtream'],
        channel: 'DB_GET_GLOBAL_RECENTLY_ADDED',
        forwardedArgs: ['vod', 50, 'xtream'],
    },
    {
        method: 'dbGetRecentlyViewed',
        args: [],
        channel: 'DB_GET_RECENTLY_VIEWED',
        forwardedArgs: [],
    },
    {
        method: 'dbClearRecentlyViewed',
        args: [],
        channel: 'DB_CLEAR_RECENTLY_VIEWED',
        forwardedArgs: [],
    },
    {
        method: 'dbAddFavorite',
        args: [12, playlistId, 'https://image.example/backdrop.jpg'],
        channel: 'DB_ADD_FAVORITE',
        forwardedArgs: [12, playlistId, 'https://image.example/backdrop.jpg'],
    },
    {
        method: 'dbRemoveFavorite',
        args: [12, playlistId],
        channel: 'DB_REMOVE_FAVORITE',
        forwardedArgs: [12, playlistId],
    },
    {
        method: 'dbIsFavorite',
        args: [12, playlistId],
        channel: 'DB_IS_FAVORITE',
        forwardedArgs: [12, playlistId],
    },
    {
        method: 'dbGetFavorites',
        args: [playlistId],
        channel: 'DB_GET_FAVORITES',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbGetGlobalFavorites',
        args: [],
        channel: 'DB_GET_GLOBAL_FAVORITES',
        forwardedArgs: [],
    },
    {
        method: 'dbGetAllGlobalFavorites',
        args: [],
        channel: 'DB_GET_ALL_GLOBAL_FAVORITES',
        forwardedArgs: [],
    },
    {
        method: 'dbReorderGlobalFavorites',
        args: [reorderUpdates],
        channel: 'DB_REORDER_GLOBAL_FAVORITES',
        forwardedArgs: [reorderUpdates],
    },
    {
        method: 'dbGetRecentItems',
        args: [playlistId],
        channel: 'DB_GET_RECENT_ITEMS',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbAddRecentItem',
        args: [13, playlistId, 'https://image.example/recent.jpg'],
        channel: 'DB_ADD_RECENT_ITEM',
        forwardedArgs: [13, playlistId, 'https://image.example/recent.jpg'],
    },
    {
        method: 'dbClearPlaylistRecentItems',
        args: [playlistId],
        channel: 'DB_CLEAR_PLAYLIST_RECENT_ITEMS',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbRemoveRecentItem',
        args: [13, playlistId],
        channel: 'DB_REMOVE_RECENT_ITEM',
        forwardedArgs: [13, playlistId],
    },
    {
        method: 'dbRemoveRecentItemsBatch',
        args: [recentItemsBatch],
        channel: 'DB_REMOVE_RECENT_ITEMS_BATCH',
        forwardedArgs: [recentItemsBatch],
    },
    {
        method: 'dbGetContentByXtreamId',
        args: [42, playlistId, 'movie'],
        channel: 'DB_GET_CONTENT_BY_XTREAM_ID',
        forwardedArgs: [42, playlistId, 'movie'],
    },
    {
        method: 'dbSetContentBackdropIfMissing',
        args: [12, 'https://image.example/backdrop.jpg'],
        channel: 'DB_SET_CONTENT_BACKDROP_IF_MISSING',
        forwardedArgs: [12, 'https://image.example/backdrop.jpg'],
    },
    {
        method: 'dbDeleteAllPlaylists',
        args: [operationId],
        channel: 'DB_DELETE_ALL_PLAYLISTS',
        forwardedArgs: [operationId],
    },
    {
        method: 'dbCancelOperation',
        args: [operationId],
        channel: 'DB_CANCEL_OPERATION',
        forwardedArgs: [operationId],
    },
    {
        method: 'dbGetAppState',
        args: ['workspace:last-route'],
        channel: 'DB_GET_APP_STATE',
        forwardedArgs: ['workspace:last-route'],
    },
    {
        method: 'dbSetAppState',
        args: ['workspace:last-route', '/workspace'],
        channel: 'DB_SET_APP_STATE',
        forwardedArgs: ['workspace:last-route', '/workspace'],
    },
    {
        method: 'dbSavePlaybackPosition',
        args: [playlistId, playbackData],
        channel: 'DB_SAVE_PLAYBACK_POSITION',
        forwardedArgs: [playlistId, playbackData],
    },
    {
        method: 'dbGetPlaybackPosition',
        args: [playlistId, 42, 'vod'],
        channel: 'DB_GET_PLAYBACK_POSITION',
        forwardedArgs: [playlistId, 42, 'vod'],
    },
    {
        method: 'dbGetSeriesPlaybackPositions',
        args: [playlistId, 88],
        channel: 'DB_GET_SERIES_PLAYBACK_POSITIONS',
        forwardedArgs: [playlistId, 88],
    },
    {
        method: 'dbGetRecentPlaybackPositions',
        args: [playlistId, 20],
        channel: 'DB_GET_RECENT_PLAYBACK_POSITIONS',
        forwardedArgs: [playlistId, 20],
    },
    {
        method: 'dbGetAllPlaybackPositions',
        args: [playlistId],
        channel: 'DB_GET_ALL_PLAYBACK_POSITIONS',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbClearAllPlaybackPositions',
        args: [playlistId],
        channel: 'DB_CLEAR_ALL_PLAYBACK_POSITIONS',
        forwardedArgs: [playlistId],
    },
    {
        method: 'dbClearPlaybackPosition',
        args: [playlistId, 42, 'vod'],
        channel: 'DB_CLEAR_PLAYBACK_POSITION',
        forwardedArgs: [playlistId, 42, 'vod'],
    },
];
