import {
    isPlaylistRefreshCancelledResult,
    PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    PRELOAD_PERFORMANCE_METHOD,
    type PreloadPerformanceMarker,
    type PreloadPerformanceMethod,
    type PreloadPerformancePhase,
} from '@iptvnator/shared/interfaces';
import {
    advancePreloadPerformanceCorrelation,
    createPreloadPerformanceCorrelationState,
    normalizePreloadPerformanceIdentifier,
    type PreloadPerformanceCorrelationState,
} from './preload-performance-correlation';

export interface PreloadPerformanceCallContext {
    ipcCallId: number;
    method: PreloadPerformanceMethod;
    operationId: string | null;
    playlistId: string | null;
}

export interface PreloadPerformanceCapture {
    error: (call: PreloadPerformanceCallContext | null) => void;
    start: (
        methodName: string,
        args: readonly unknown[]
    ) => PreloadPerformanceCallContext | null;
    success: (
        call: PreloadPerformanceCallContext | null,
        result: unknown
    ) => void;
}

type MarkerSender = (
    channel: typeof PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    marker: PreloadPerformanceMarker
) => void;

function readProperty(value: unknown, property: string): unknown {
    if (
        (typeof value !== 'object' || value === null) &&
        typeof value !== 'function'
    ) {
        return undefined;
    }

    try {
        return Reflect.get(value, property);
    } catch {
        return undefined;
    }
}

export function toPreloadPerformanceTargetMethod(
    methodName: string
): PreloadPerformanceMethod | null {
    switch (methodName) {
        case PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST:
        case PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST:
        case PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST:
            return methodName;
        default:
            return null;
    }
}

function readHighResolutionEpochMs(): number {
    const timeOrigin = globalThis.performance?.timeOrigin;
    const monotonicNow = globalThis.performance?.now?.();
    const highResolutionEpoch =
        typeof timeOrigin === 'number' && typeof monotonicNow === 'number'
            ? timeOrigin + monotonicNow
            : Number.NaN;

    return Number.isFinite(highResolutionEpoch)
        ? highResolutionEpoch
        : Date.now();
}

function extractIdentifiers(
    method: PreloadPerformanceMethod,
    args: readonly unknown[]
): Pick<PreloadPerformanceCallContext, 'operationId' | 'playlistId'> {
    if (method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST) {
        const payload = args[0];
        return {
            operationId: normalizePreloadPerformanceIdentifier(
                readProperty(payload, 'operationId')
            ),
            playlistId: normalizePreloadPerformanceIdentifier(
                readProperty(payload, 'playlistId')
            ),
        };
    }

    if (method === PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST) {
        return {
            operationId: normalizePreloadPerformanceIdentifier(args[1]),
            playlistId: normalizePreloadPerformanceIdentifier(args[0]),
        };
    }

    return {
        operationId: normalizePreloadPerformanceIdentifier(args[1]),
        playlistId: normalizePreloadPerformanceIdentifier(
            readProperty(args[0], '_id')
        ),
    };
}

export function createPreloadPerformanceCapture(
    enabled: boolean,
    sendMarker: MarkerSender
): PreloadPerformanceCapture {
    let correlationState: PreloadPerformanceCorrelationState =
        createPreloadPerformanceCorrelationState();
    let markerDeliveryFailed = false;
    let lastSourceEpochMs = 0;
    let nextIpcCallId = 1;

    function emit(
        call: PreloadPerformanceCallContext,
        phase: PreloadPerformancePhase,
        refreshCancelled = false
    ): void {
        if (markerDeliveryFailed) {
            return;
        }

        try {
            const transition = advancePreloadPerformanceCorrelation(
                correlationState,
                {
                    ...call,
                    phase,
                    refreshCancelled,
                }
            );
            const sourceEpochMs = Math.max(
                readHighResolutionEpochMs(),
                lastSourceEpochMs
            );
            sendMarker(PRELOAD_PERFORMANCE_MARKER_CHANNEL, {
                ...transition.marker,
                sourceEpochMs,
            });
            correlationState = transition.state;
            lastSourceEpochMs = sourceEpochMs;
        } catch {
            markerDeliveryFailed = true;
            // Performance instrumentation must never affect the bridge call.
        }
    }

    return {
        error: (call) => {
            if (call) {
                emit(call, 'error');
            }
        },
        start: (methodName, args) => {
            if (!enabled) {
                return null;
            }

            const method = toPreloadPerformanceTargetMethod(methodName);
            if (!method) {
                return null;
            }

            const call: PreloadPerformanceCallContext = {
                ipcCallId: nextIpcCallId,
                method,
                ...extractIdentifiers(method, args),
            };
            nextIpcCallId += 1;
            emit(call, 'start');
            return call;
        },
        success: (call, result) => {
            if (!call) {
                return;
            }

            let refreshCancelled = false;
            if (call.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST) {
                try {
                    refreshCancelled = isPlaylistRefreshCancelledResult(result);
                } catch {
                    refreshCancelled = false;
                }
            }
            emit(call, 'success', refreshCancelled);
        },
    };
}
