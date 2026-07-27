export const PERFORMANCE_PHASE_BOUNDARY = {
    END: 'end',
    START: 'start',
} as const;

export type PerformancePhaseBoundary =
    (typeof PERFORMANCE_PHASE_BOUNDARY)[keyof typeof PERFORMANCE_PHASE_BOUNDARY];

export const M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL =
    'IPTVNATOR_M3U_IMPORT_PERFORMANCE_PHASE_EVENT';

export const M3U_IMPORT_PERFORMANCE_PHASE = {
    DATA_ACQUIRE: 'data.acquire',
    NORMALIZE: 'normalize',
    PARSE_M3U: 'parse.m3u',
} as const;

export type M3uImportPerformancePhase =
    (typeof M3U_IMPORT_PERFORMANCE_PHASE)[keyof typeof M3U_IMPORT_PERFORMANCE_PHASE];

export const APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE = {
    SERIALIZE_PLAYLIST: 'serialize.playlist',
    SQLITE_WRITE: 'sqlite.write',
} as const;

export type AppPlaylistUpsertPerformancePhase =
    (typeof APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE)[keyof typeof APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE];

export const APP_PLAYLIST_GET_PERFORMANCE_PHASE = {
    DESERIALIZE_PLAYLIST: 'deserialize.playlist',
    SQLITE_READ: 'sqlite.read',
} as const;

export type AppPlaylistGetPerformancePhase =
    (typeof APP_PLAYLIST_GET_PERFORMANCE_PHASE)[keyof typeof APP_PLAYLIST_GET_PERFORMANCE_PHASE];

export type AppPlaylistPerformancePhase =
    AppPlaylistGetPerformancePhase | AppPlaylistUpsertPerformancePhase;

export const XTREAM_DATABASE_PERFORMANCE_PHASE = {
    NORMALIZE_CATEGORIES: 'normalize.categories',
    NORMALIZE_CONTENT: 'normalize.content',
    NORMALIZE_SEARCH_RANK: 'normalize.search-rank',
    SQLITE_CATEGORIES_READ: 'sqlite.categories.read',
    SQLITE_CATEGORIES_WRITE_TRANSACTIONS:
        'sqlite.categories.write-transactions',
    SQLITE_CONTENT_CATEGORY_MAP_READ: 'sqlite.content.category-map-read',
    SQLITE_CONTENT_READ: 'sqlite.content.read',
    SQLITE_CONTENT_WRITE_TRANSACTIONS: 'sqlite.content.write-transactions',
    SQLITE_SEARCH_QUERY: 'sqlite.search.query',
    SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS:
        'sqlite.xtream-cache-clear.write-transactions',
} as const;

export type XtreamDatabasePerformancePhase =
    (typeof XTREAM_DATABASE_PERFORMANCE_PHASE)[keyof typeof XTREAM_DATABASE_PERFORMANCE_PHASE];

export type DatabaseWorkerPerformancePhase =
    AppPlaylistPerformancePhase | XtreamDatabasePerformancePhase;

export interface PerformancePhaseMetadata {
    readonly byteCount?: number;
    readonly itemCount?: number;
}

export interface PerformancePhaseEvent<TPhase extends string = string> {
    readonly boundary: PerformancePhaseBoundary;
    readonly durationMs: number | null;
    readonly epochMs: number;
    readonly metadata?: PerformancePhaseMetadata;
    readonly phase: TPhase;
    readonly requestId: string;
}
