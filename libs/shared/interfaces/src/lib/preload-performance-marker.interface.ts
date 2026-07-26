export const PRELOAD_PERFORMANCE_MARKER_CHANNEL =
    'IPTVNATOR_PERF_CAPTURE_MARKER';

export const PRELOAD_PERFORMANCE_METHOD = {
    DB_GET_APP_PLAYLIST: 'dbGetAppPlaylist',
    DB_UPSERT_APP_PLAYLIST: 'dbUpsertAppPlaylist',
    REFRESH_PLAYLIST: 'refreshPlaylist',
} as const;

export type PreloadPerformanceMethod =
    (typeof PRELOAD_PERFORMANCE_METHOD)[keyof typeof PRELOAD_PERFORMANCE_METHOD];

export const PRELOAD_PERFORMANCE_PHASE = {
    ERROR: 'error',
    START: 'start',
    SUCCESS: 'success',
} as const;

export type PreloadPerformancePhase =
    (typeof PRELOAD_PERFORMANCE_PHASE)[keyof typeof PRELOAD_PERFORMANCE_PHASE];

export const PRELOAD_PERFORMANCE_CORRELATION_STATE = {
    COMPLETE: 'complete',
    CORRELATED: 'correlated',
    INVALID: 'invalid',
    UNCORRELATED: 'uncorrelated',
} as const;

export type PreloadPerformanceCorrelationStateName =
    (typeof PRELOAD_PERFORMANCE_CORRELATION_STATE)[keyof typeof PRELOAD_PERFORMANCE_CORRELATION_STATE];

export const PRELOAD_PERFORMANCE_INVALID_REASON = {
    CONCURRENT_REFRESH: 'concurrent-refresh',
    IPC_ERROR: 'ipc-error',
    MALFORMED_IDENTIFIER: 'malformed-identifier',
    OUT_OF_ORDER: 'out-of-order',
    REFRESH_CANCELLED: 'refresh-cancelled',
} as const;

export type PreloadPerformanceInvalidReason =
    (typeof PRELOAD_PERFORMANCE_INVALID_REASON)[keyof typeof PRELOAD_PERFORMANCE_INVALID_REASON];

export interface PreloadPerformanceMarker {
    method: PreloadPerformanceMethod;
    phase: PreloadPerformancePhase;
    sourceEpochMs: number;
    ipcCallId: number;
    playlistId: string | null;
    operationId: string | null;
    correlationState: PreloadPerformanceCorrelationStateName;
    invalidReason: PreloadPerformanceInvalidReason | null;
}
