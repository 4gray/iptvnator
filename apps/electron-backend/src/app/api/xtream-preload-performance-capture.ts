import {
    XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    XTREAM_PRELOAD_PERFORMANCE_METHOD,
    XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION,
    type XtreamPreloadPerformanceBoundary,
    type XtreamPreloadPerformanceMarker,
    type XtreamPreloadPerformanceMethod,
    type XtreamPreloadPerformanceOutcome,
} from '@iptvnator/shared/interfaces';
import {
    extractXtreamPreloadPerformanceMetadata,
    type XtreamPreloadMarkerMetadata,
} from './xtream-preload-performance-metadata';

export interface XtreamPreloadPerformanceCallContext extends XtreamPreloadMarkerMetadata {
    ipcCallId: number;
    method: XtreamPreloadPerformanceMethod;
}

export interface XtreamPreloadPerformanceCapture {
    error: (
        call: XtreamPreloadPerformanceCallContext | null,
        ignoredError?: unknown
    ) => void;
    start: (
        methodName: string,
        args: readonly unknown[]
    ) => XtreamPreloadPerformanceCallContext | null;
    success: (
        call: XtreamPreloadPerformanceCallContext | null,
        ignoredResult?: unknown
    ) => void;
}

type MarkerSender = (
    channel: typeof XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    marker: XtreamPreloadPerformanceMarker
) => void;

type EpochReader = () => number;

export function toXtreamPreloadPerformanceTargetMethod(
    methodName: string
): XtreamPreloadPerformanceMethod | null {
    switch (methodName) {
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.XTREAM_REQUEST:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.XTREAM_CANCEL_SESSION:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_GET_CATEGORIES:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_SAVE_CATEGORIES:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_GET_CONTENT:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_SAVE_CONTENT:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_DELETE_XTREAM_CONTENT:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_DELETE_PLAYLIST:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_RESTORE_XTREAM_USER_DATA:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_SEARCH_CONTENT:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_GLOBAL_SEARCH:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_CANCEL_OPERATION:
            return methodName;
        default:
            return null;
    }
}

export function isXtreamPreloadPerformanceCaptureEnabled(): boolean {
    return process.env['IPTVNATOR_PERF_CAPTURE'] === '1';
}

function readHighResolutionEpochMs(): number {
    try {
        const timeOrigin = globalThis.performance?.timeOrigin;
        const monotonicNow = globalThis.performance?.now?.();
        const highResolutionEpoch =
            typeof timeOrigin === 'number' && typeof monotonicNow === 'number'
                ? timeOrigin + monotonicNow
                : Number.NaN;
        if (Number.isFinite(highResolutionEpoch)) {
            return highResolutionEpoch;
        }
    } catch {
        // Fall through to the wall clock.
    }

    try {
        return Date.now();
    } catch {
        return Number.NaN;
    }
}

function readPositiveWallClockEpochMs(): number {
    try {
        const wallClockEpochMs = Date.now();
        return Number.isFinite(wallClockEpochMs) && wallClockEpochMs > 0
            ? wallClockEpochMs
            : 1;
    } catch {
        return 1;
    }
}

function readMonotonicEpochMs(
    readEpochMs: EpochReader,
    lastSourceEpochMs: number
): number {
    let clockValue = Number.NaN;
    try {
        clockValue = readEpochMs();
    } catch {
        // Use the last valid sample or the wall clock below.
    }

    const fallbackEpochMs =
        lastSourceEpochMs > 0
            ? lastSourceEpochMs
            : readPositiveWallClockEpochMs();
    const sourceEpochMs =
        Number.isFinite(clockValue) && clockValue > 0
            ? clockValue
            : fallbackEpochMs;
    return Math.max(sourceEpochMs, lastSourceEpochMs);
}

export function createXtreamPreloadPerformanceCapture(
    enabled: boolean,
    sendMarker: MarkerSender,
    readEpochMs: EpochReader = readHighResolutionEpochMs
): XtreamPreloadPerformanceCapture {
    let lastSourceEpochMs = 0;
    let nextIpcCallId = 1;

    function emit(
        call: XtreamPreloadPerformanceCallContext,
        boundary: XtreamPreloadPerformanceBoundary,
        outcome: XtreamPreloadPerformanceOutcome
    ): void {
        const sourceEpochMs = readMonotonicEpochMs(
            readEpochMs,
            lastSourceEpochMs
        );
        lastSourceEpochMs = sourceEpochMs;
        try {
            sendMarker(XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL, {
                schemaVersion: XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION,
                sourceEpochMs,
                ipcCallId: call.ipcCallId,
                method: call.method,
                boundary,
                outcome,
                playlistId: call.playlistId,
                operationId: call.operationId,
                sessionId: call.sessionId,
                action: call.action,
                categoryType: call.categoryType,
                contentType: call.contentType,
                itemCount: call.itemCount,
            });
        } catch {
            // Performance instrumentation must never affect the bridge call.
        }
    }

    return {
        error: (call) => {
            if (call) {
                emit(call, 'end', 'error');
            }
        },
        start: (methodName, args) => {
            if (!enabled) {
                return null;
            }
            const method = toXtreamPreloadPerformanceTargetMethod(methodName);
            if (!method || nextIpcCallId > Number.MAX_SAFE_INTEGER) {
                return null;
            }
            const call = {
                ipcCallId: nextIpcCallId,
                method,
                ...extractXtreamPreloadPerformanceMetadata(method, args),
            };
            nextIpcCallId += 1;
            emit(call, 'start', null);
            return call;
        },
        success: (call) => {
            if (call) {
                emit(call, 'end', 'success');
            }
        },
    };
}
