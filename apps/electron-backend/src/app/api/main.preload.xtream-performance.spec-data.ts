import {
    XtreamCodeActions,
    type XtreamPreloadPerformanceMarker,
} from '@iptvnator/shared/interfaces';
import type { ExposedElectronApi } from './main.preload.performance.test-helpers';

type ExpectedMetadata = Pick<
    XtreamPreloadPerformanceMarker,
    | 'action'
    | 'categoryType'
    | 'contentType'
    | 'itemCount'
    | 'operationId'
    | 'playlistId'
    | 'sessionId'
>;

const EMPTY_METADATA: ExpectedMetadata = {
    action: null,
    categoryType: null,
    contentType: null,
    itemCount: null,
    operationId: null,
    playlistId: null,
    sessionId: null,
};

export const XTREAM_PRELOAD_REQUEST_PAYLOAD = {
    params: {
        action: XtreamCodeActions.GetLiveStreams,
        password: 'provider-password-secret',
        username: 'provider-user-secret',
    },
    requestId: 'request-secret',
    sessionId: 'session-1',
    suppressErrorLog: true,
    url: 'http://provider-url-secret',
};

const categoryItems = [
    {
        category_id: '1',
        category_name: 'secret-title',
        parent_id: 0,
    },
];
const streamItems = [{ name: 'secret-stream-title', stream_id: 1 }];
const favorites = [{ title: 'secret-favorite-title' }];
const recent = [{ title: 'secret-recent-title' }, {}];
const globalSources = [{ playlistId: 'secret-source' }];
const globalOptions = { limit: 25 };

interface TargetCase {
    expectedInvoke: readonly unknown[];
    expectedMetadata: ExpectedMetadata;
    invoke: (api: ExposedElectronApi) => unknown;
    method: string;
}

export const XTREAM_PRELOAD_TARGET_CASES: TargetCase[] = [
    {
        expectedInvoke: ['XTREAM_REQUEST', XTREAM_PRELOAD_REQUEST_PAYLOAD],
        expectedMetadata: {
            ...EMPTY_METADATA,
            action: XtreamCodeActions.GetLiveStreams,
            sessionId: 'session-1',
        },
        invoke: (api) => api.xtreamRequest(XTREAM_PRELOAD_REQUEST_PAYLOAD),
        method: 'xtreamRequest',
    },
    {
        expectedInvoke: ['XTREAM_CANCEL_SESSION', 'session-2'],
        expectedMetadata: { ...EMPTY_METADATA, sessionId: 'session-2' },
        invoke: (api) => api.xtreamCancelSession('session-2'),
        method: 'xtreamCancelSession',
    },
    {
        expectedInvoke: ['DB_GET_CATEGORIES', 'playlist-1', 'movies'],
        expectedMetadata: {
            ...EMPTY_METADATA,
            categoryType: 'movies',
            playlistId: 'playlist-1',
        },
        invoke: (api) => api.dbGetCategories('playlist-1', 'movies'),
        method: 'dbGetCategories',
    },
    {
        expectedInvoke: [
            'DB_SAVE_CATEGORIES',
            'playlist-2',
            categoryItems,
            'live',
            [91],
        ],
        expectedMetadata: {
            ...EMPTY_METADATA,
            categoryType: 'live',
            itemCount: 1,
            playlistId: 'playlist-2',
        },
        invoke: (api) =>
            api.dbSaveCategories('playlist-2', categoryItems, 'live', [91]),
        method: 'dbSaveCategories',
    },
    {
        expectedInvoke: ['DB_GET_CONTENT', 'playlist-3', 'series'],
        expectedMetadata: {
            ...EMPTY_METADATA,
            contentType: 'series',
            playlistId: 'playlist-3',
        },
        invoke: (api) => api.dbGetContent('playlist-3', 'series'),
        method: 'dbGetContent',
    },
    {
        expectedInvoke: [
            'DB_SAVE_CONTENT',
            'playlist-4',
            streamItems,
            'movie',
            'operation-4',
        ],
        expectedMetadata: {
            ...EMPTY_METADATA,
            contentType: 'movie',
            itemCount: 1,
            operationId: 'operation-4',
            playlistId: 'playlist-4',
        },
        invoke: (api) =>
            api.dbSaveContent(
                'playlist-4',
                streamItems as never,
                'movie',
                'operation-4'
            ),
        method: 'dbSaveContent',
    },
    {
        expectedInvoke: [
            'DB_DELETE_XTREAM_CONTENT',
            'playlist-5',
            'operation-5',
        ],
        expectedMetadata: {
            ...EMPTY_METADATA,
            operationId: 'operation-5',
            playlistId: 'playlist-5',
        },
        invoke: (api) => api.dbDeleteXtreamContent('playlist-5', 'operation-5'),
        method: 'dbDeleteXtreamContent',
    },
    {
        expectedInvoke: ['DB_DELETE_PLAYLIST', 'playlist-6', 'operation-6'],
        expectedMetadata: {
            ...EMPTY_METADATA,
            operationId: 'operation-6',
            playlistId: 'playlist-6',
        },
        invoke: (api) => api.dbDeletePlaylist('playlist-6', 'operation-6'),
        method: 'dbDeletePlaylist',
    },
    {
        expectedInvoke: [
            'DB_RESTORE_XTREAM_USER_DATA',
            'playlist-7',
            favorites,
            recent,
            'operation-7',
        ],
        expectedMetadata: {
            ...EMPTY_METADATA,
            itemCount: 3,
            operationId: 'operation-7',
            playlistId: 'playlist-7',
        },
        invoke: (api) =>
            api.dbRestoreXtreamUserData(
                'playlist-7',
                favorites as never,
                recent as never,
                'operation-7'
            ),
        method: 'dbRestoreXtreamUserData',
    },
    {
        expectedInvoke: [
            'DB_SEARCH_CONTENT',
            'playlist-8',
            'provider-search-secret',
            ['live'],
            true,
        ],
        expectedMetadata: { ...EMPTY_METADATA, playlistId: 'playlist-8' },
        invoke: (api) =>
            api.dbSearchContent(
                'playlist-8',
                'provider-search-secret',
                ['live'],
                true
            ),
        method: 'dbSearchContent',
    },
    {
        expectedInvoke: [
            'DB_GLOBAL_SEARCH',
            'global-search-secret',
            ['live'],
            true,
            globalSources,
            globalOptions,
        ],
        expectedMetadata: EMPTY_METADATA,
        invoke: (api) =>
            api.dbGlobalSearch(
                'global-search-secret',
                ['live'],
                true,
                globalSources as never,
                globalOptions
            ),
        method: 'dbGlobalSearch',
    },
    {
        expectedInvoke: ['DB_CANCEL_OPERATION', 'operation-9'],
        expectedMetadata: { ...EMPTY_METADATA, operationId: 'operation-9' },
        invoke: (api) => api.dbCancelOperation('operation-9'),
        method: 'dbCancelOperation',
    },
];
