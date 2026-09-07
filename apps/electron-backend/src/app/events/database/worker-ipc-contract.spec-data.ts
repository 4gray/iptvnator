import { DbWorkerOperation } from '../../workers/database-worker.types';

type WorkerIpcContractCase = {
    operation: DbWorkerOperation;
    args: unknown[];
    payload: unknown;
    forwardsEvents?: boolean;
};

export const playlistId = 'playlist-1';
export const operationId = 'operation-1';
const playlist = { id: playlistId, name: 'Playlist', type: 'xtream' };
const playlists = [playlist];
const playlistUpdates = { name: 'Updated playlist' };
const categories = [{ category_id: '10', category_name: 'Live' }];
export const streams = [{ stream_id: 42, name: 'Channel' }];
const favorites = [{ contentId: 1, playlistId }];
const recentlyViewed = [{ contentId: 2, playlistId }];
const categoryIds = [10, 11];
const reorderUpdates = [{ content_id: 12, position: 1 }];
const recentItemsBatch = [{ contentId: 13, playlistId }];
const contentMetadataPatch = {
    backdropUrl: 'https://image.example/backdrop.jpg',
    tmdbId: 603,
    releaseYear: 1999,
    originalTitle: 'The Matrix',
};
const playbackData = {
    contentXtreamId: 42,
    contentType: 'vod',
    positionSeconds: 120,
};
const playbackBatchItems = [
    {
        contentXtreamId: 42,
        contentType: 'episode',
        seriesXtreamId: 88,
        seasonNumber: 1,
        episodeNumber: 3,
        positionSeconds: 1200,
        durationSeconds: 1200,
    },
];
const playbackClearBatchItems = [
    { contentXtreamId: 42, contentType: 'episode' },
];
const tmdbCacheEntry = {
    mediaType: 'movie',
    lookupKey: 'id:603',
    language: 'en-US',
    tmdbId: 603,
    payload: '{"id":603}',
};
const vodSourceRequest = {
    title: 'The Matrix',
    year: 1999,
    excludePlaylistId: playlistId,
};
const vodSourceMatchKeys = ['tmdb:603', 'title:the matrix:1999'];
const vodSourcePin = {
    matchKey: 'tmdb:603',
    playlistId,
    contentId: 42,
    portalType: 'xtream',
};

export const workerIpcContractCases: WorkerIpcContractCase[] = [
    {
        operation: 'DB_CREATE_PLAYLIST',
        args: [playlist],
        payload: playlist,
    },
    {
        operation: 'DB_UPSERT_APP_PLAYLIST',
        args: [playlist],
        payload: playlist,
    },
    {
        operation: 'DB_MIGRATE_APP_PLAYLISTS',
        args: [playlists],
        payload: { playlists },
    },
    {
        operation: 'DB_UPSERT_APP_PLAYLISTS',
        args: [playlists],
        payload: playlists,
    },
    {
        operation: 'DB_GET_APP_PLAYLISTS',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_GET_APP_PLAYLIST_METAS',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_GET_APP_PLAYLIST',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_GET_PLAYLIST',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_UPDATE_PLAYLIST',
        args: [playlistId, playlistUpdates],
        payload: { playlistId, updates: playlistUpdates },
    },
    {
        operation: 'DB_SET_PLAYLIST_SERVER_TIMEZONE',
        args: [
            playlistId,
            { serverUrl: 'http://panel.example', username: 'u', password: 'p' },
            'Europe/London',
        ],
        payload: {
            playlistId,
            connection: {
                serverUrl: 'http://panel.example',
                username: 'u',
                password: 'p',
            },
            serverTimezone: 'Europe/London',
        },
    },
    {
        operation: 'DB_GET_APP_STATE',
        args: ['workspace:last-route'],
        payload: { key: 'workspace:last-route' },
    },
    {
        operation: 'DB_SET_APP_STATE',
        args: ['workspace:last-route', '/workspace'],
        payload: { key: 'workspace:last-route', value: '/workspace' },
    },
    {
        operation: 'DB_HAS_CATEGORIES',
        args: [playlistId, 'live'],
        payload: { playlistId, type: 'live' },
    },
    {
        operation: 'DB_GET_CATEGORIES',
        args: [playlistId, 'live'],
        payload: { playlistId, type: 'live' },
    },
    {
        operation: 'DB_SAVE_CATEGORIES',
        args: [playlistId, categories, 'live', categoryIds],
        payload: {
            playlistId,
            categories,
            type: 'live',
            hiddenCategoryXtreamIds: categoryIds,
        },
    },
    {
        operation: 'DB_GET_ALL_CATEGORIES',
        args: [playlistId, 'live'],
        payload: { playlistId, type: 'live' },
    },
    {
        operation: 'DB_UPDATE_CATEGORY_VISIBILITY',
        args: [categoryIds, true],
        payload: { categoryIds, hidden: true },
    },
    {
        operation: 'DB_HAS_CONTENT',
        args: [playlistId, 'movie'],
        payload: { playlistId, type: 'movie' },
    },
    {
        operation: 'DB_GET_CONTENT',
        args: [playlistId, 'movie'],
        payload: { playlistId, type: 'movie' },
    },
    {
        operation: 'DB_GET_GLOBAL_RECENTLY_ADDED',
        args: ['vod', 50, 'xtream'],
        payload: { kind: 'vod', limit: 50, playlistType: 'xtream' },
    },
    {
        operation: 'DB_SAVE_CONTENT',
        args: [playlistId, streams, 'movie', operationId],
        payload: { playlistId, streams, type: 'movie', operationId },
        forwardsEvents: true,
    },
    {
        operation: 'DB_CLEAR_XTREAM_IMPORT_CACHE',
        args: [playlistId, 'movie'],
        payload: { playlistId, type: 'movie' },
    },
    {
        operation: 'DB_GET_CONTENT_BY_XTREAM_ID',
        args: [42, playlistId, 'movie'],
        payload: { xtreamId: 42, playlistId, contentType: 'movie' },
    },
    {
        operation: 'DB_SET_CONTENT_METADATA_IF_MISSING',
        // Same object on both sides: the patch must cross the boundary
        // unreshaped, or the worker reads fields the caller never sent.
        args: [12, contentMetadataPatch],
        payload: { contentId: 12, patch: contentMetadataPatch },
    },
    {
        operation: 'DB_SEARCH_CONTENT',
        args: [playlistId, 'matrix', ['movie'], true],
        payload: {
            playlistId,
            searchTerm: 'matrix',
            types: ['movie'],
            excludeHidden: true,
        },
    },
    {
        operation: 'DB_GLOBAL_SEARCH',
        args: ['matrix', ['movie'], true],
        payload: {
            searchTerm: 'matrix',
            types: ['movie'],
            excludeHidden: true,
        },
    },
    {
        operation: 'DB_DELETE_PLAYLIST',
        args: [playlistId, operationId],
        payload: { playlistId, operationId },
        forwardsEvents: true,
    },
    {
        operation: 'DB_DELETE_ALL_PLAYLISTS',
        args: [operationId],
        payload: { operationId },
        forwardsEvents: true,
    },
    {
        operation: 'DB_DELETE_XTREAM_CONTENT',
        args: [playlistId, operationId],
        payload: { playlistId, operationId },
        forwardsEvents: true,
    },
    {
        operation: 'DB_RESTORE_XTREAM_USER_DATA',
        args: [playlistId, favorites, recentlyViewed, operationId],
        payload: { playlistId, favorites, recentlyViewed, operationId },
        forwardsEvents: true,
    },
    {
        operation: 'DB_ADD_FAVORITE',
        args: [12, playlistId, 'https://image.example/backdrop.jpg'],
        payload: {
            contentId: 12,
            playlistId,
            backdropUrl: 'https://image.example/backdrop.jpg',
        },
    },
    {
        operation: 'DB_REMOVE_FAVORITE',
        args: [12, playlistId],
        payload: { contentId: 12, playlistId },
    },
    {
        operation: 'DB_IS_FAVORITE',
        args: [12, playlistId],
        payload: { contentId: 12, playlistId },
    },
    {
        operation: 'DB_GET_FAVORITES',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_GET_GLOBAL_FAVORITES',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_GET_ALL_GLOBAL_FAVORITES',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_REORDER_GLOBAL_FAVORITES',
        args: [reorderUpdates],
        payload: { updates: reorderUpdates },
    },
    {
        operation: 'DB_GET_RECENTLY_VIEWED',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_CLEAR_RECENTLY_VIEWED',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_GET_RECENT_ITEMS',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_ADD_RECENT_ITEM',
        args: [13, playlistId, 'https://image.example/recent.jpg'],
        payload: {
            contentId: 13,
            playlistId,
            backdropUrl: 'https://image.example/recent.jpg',
        },
    },
    {
        operation: 'DB_CLEAR_PLAYLIST_RECENT_ITEMS',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_REMOVE_RECENT_ITEM',
        args: [13, playlistId],
        payload: { contentId: 13, playlistId },
    },
    {
        operation: 'DB_REMOVE_RECENT_ITEMS_BATCH',
        args: [recentItemsBatch],
        payload: { items: recentItemsBatch },
    },
    {
        operation: 'DB_SAVE_PLAYBACK_POSITION',
        args: [playlistId, playbackData],
        payload: { playlistId, data: playbackData },
    },
    {
        operation: 'DB_GET_PLAYBACK_POSITION',
        args: [playlistId, 42, 'vod'],
        payload: { playlistId, contentXtreamId: 42, contentType: 'vod' },
    },
    {
        operation: 'DB_GET_SERIES_PLAYBACK_POSITIONS',
        args: [playlistId, 88],
        payload: { playlistId, seriesXtreamId: 88 },
    },
    {
        operation: 'DB_GET_RECENT_PLAYBACK_POSITIONS',
        args: [playlistId, 20],
        payload: { playlistId, limit: 20 },
    },
    {
        operation: 'DB_GET_ALL_PLAYBACK_POSITIONS',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_CLEAR_ALL_PLAYBACK_POSITIONS',
        args: [playlistId],
        payload: { playlistId },
    },
    {
        operation: 'DB_CLEAR_PLAYBACK_POSITION',
        args: [playlistId, 42, 'vod'],
        payload: { playlistId, contentXtreamId: 42, contentType: 'vod' },
    },
    {
        operation: 'DB_SAVE_PLAYBACK_POSITIONS_BATCH',
        args: [playlistId, playbackBatchItems],
        payload: { playlistId, items: playbackBatchItems },
    },
    {
        operation: 'DB_CLEAR_PLAYBACK_POSITIONS_BATCH',
        args: [playlistId, playbackClearBatchItems],
        payload: { playlistId, items: playbackClearBatchItems },
    },
    {
        operation: 'DB_GET_TMDB_METADATA',
        args: ['movie', 'id:603', 'en-US'],
        payload: { mediaType: 'movie', lookupKey: 'id:603', language: 'en-US' },
    },
    {
        operation: 'DB_SET_TMDB_METADATA',
        args: [tmdbCacheEntry],
        payload: { entry: tmdbCacheEntry },
    },
    {
        operation: 'DB_GET_TMDB_CACHE_STATS',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_CLEAR_TMDB_METADATA',
        args: [],
        payload: {},
    },
    {
        operation: 'DB_MATCH_TITLES',
        args: [['The Matrix', 'Inception']],
        payload: { titles: ['The Matrix', 'Inception'] },
    },
    {
        operation: 'DB_FIND_TITLE_SOURCES',
        args: [vodSourceRequest],
        payload: { request: vodSourceRequest },
    },
    {
        operation: 'DB_GET_VOD_SOURCE_PIN',
        args: [vodSourceMatchKeys],
        payload: { matchKeys: vodSourceMatchKeys },
    },
    {
        operation: 'DB_LIST_VOD_SOURCE_PINS',
        args: ['playlist-1'],
        payload: { playlistId: 'playlist-1' },
    },
    {
        operation: 'DB_CLEAR_VOD_SOURCE_PINS_FOR_PLAYLIST',
        args: ['playlist-1'],
        payload: { playlistId: 'playlist-1' },
    },
    {
        operation: 'DB_SET_VOD_SOURCE_PIN',
        args: [vodSourcePin, ['title:dune:'], ['title:dune:2021']],
        payload: {
            pin: vodSourcePin,
            retireKeys: ['title:dune:'],
            aliasKeys: ['title:dune:2021'],
        },
    },
    {
        operation: 'DB_REPLACE_VOD_SOURCE_PINS',
        args: ['playlist-1', [vodSourcePin]],
        payload: { playlistId: 'playlist-1', pins: [vodSourcePin] },
    },
    {
        operation: 'DB_CLEAR_VOD_SOURCE_PIN',
        args: [vodSourceMatchKeys],
        payload: { matchKeys: vodSourceMatchKeys },
    },
];
