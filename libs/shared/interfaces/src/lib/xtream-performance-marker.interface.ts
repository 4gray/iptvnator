import { XtreamCodeActions } from './xtream-code-actions';

export const XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL =
    'IPTVNATOR_XTREAM_MAIN_PERFORMANCE_PHASE_EVENT';

export const XTREAM_MAIN_PERFORMANCE_PHASE = {
    CANCEL_SESSION: 'xtream.cancel-session',
    JSON_TRANSFORM: 'xtream.json.transform',
    NETWORK_TOTAL: 'xtream.network.total',
    RESPONSE_READY: 'xtream.response.ready',
} as const;

export type XtreamMainPerformancePhase =
    (typeof XTREAM_MAIN_PERFORMANCE_PHASE)[keyof typeof XTREAM_MAIN_PERFORMANCE_PHASE];

export const XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL =
    'IPTVNATOR_XTREAM_PERF_CAPTURE_MARKER';

export const XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION = 1 as const;

export const XTREAM_PRELOAD_PERFORMANCE_METHOD = {
    DB_CANCEL_OPERATION: 'dbCancelOperation',
    DB_DELETE_PLAYLIST: 'dbDeletePlaylist',
    DB_DELETE_XTREAM_CONTENT: 'dbDeleteXtreamContent',
    DB_GET_CATEGORIES: 'dbGetCategories',
    DB_GET_CONTENT: 'dbGetContent',
    DB_GLOBAL_SEARCH: 'dbGlobalSearch',
    DB_RESTORE_XTREAM_USER_DATA: 'dbRestoreXtreamUserData',
    DB_SAVE_CATEGORIES: 'dbSaveCategories',
    DB_SAVE_CONTENT: 'dbSaveContent',
    DB_SEARCH_CONTENT: 'dbSearchContent',
    XTREAM_CANCEL_SESSION: 'xtreamCancelSession',
    XTREAM_REQUEST: 'xtreamRequest',
} as const;

export type XtreamPreloadPerformanceMethod =
    (typeof XTREAM_PRELOAD_PERFORMANCE_METHOD)[keyof typeof XTREAM_PRELOAD_PERFORMANCE_METHOD];

export type XtreamPreloadPerformanceBoundary = 'start' | 'end';
export type XtreamPreloadPerformanceOutcome = 'success' | 'error' | null;
export type XtreamPreloadPerformanceCategoryType = 'live' | 'movies' | 'series';
export type XtreamPreloadPerformanceContentType = 'live' | 'movie' | 'series';

export interface XtreamPreloadPerformanceMarker {
    schemaVersion: typeof XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION;
    sourceEpochMs: number;
    ipcCallId: number;
    method: XtreamPreloadPerformanceMethod;
    boundary: XtreamPreloadPerformanceBoundary;
    outcome: XtreamPreloadPerformanceOutcome;
    playlistId: string | null;
    operationId: string | null;
    sessionId: string | null;
    action: XtreamCodeActions | null;
    categoryType: XtreamPreloadPerformanceCategoryType | null;
    contentType: XtreamPreloadPerformanceContentType | null;
    itemCount: number | null;
}
