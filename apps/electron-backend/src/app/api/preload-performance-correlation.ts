import { PRELOAD_PERFORMANCE_METHOD } from '@iptvnator/shared/interfaces';
import { completePreloadPerformanceCall } from './preload-performance-correlation.complete';
import {
    normalizePreloadPerformanceIdentifier,
    type PreloadPerformanceCorrelationEvent,
    type PreloadPerformanceCorrelationResult,
    type PreloadPerformanceCorrelationState,
} from './preload-performance-correlation.model';
import { startPreloadPerformanceCall } from './preload-performance-correlation.start';

export type {
    PreloadPerformanceCorrelationEvent,
    PreloadPerformanceCorrelationResult,
    PreloadPerformanceCorrelationState,
} from './preload-performance-correlation.model';
export { normalizePreloadPerformanceIdentifier } from './preload-performance-correlation.model';

export function createPreloadPerformanceCorrelationState(): PreloadPerformanceCorrelationState {
    return {
        calls: new Map(),
        sequences: new Map(),
    };
}

export function advancePreloadPerformanceCorrelation(
    state: PreloadPerformanceCorrelationState,
    event: PreloadPerformanceCorrelationEvent
): PreloadPerformanceCorrelationResult {
    const calls = new Map(state.calls);
    const sequences = new Map(state.sequences);
    const playlistId = normalizePreloadPerformanceIdentifier(event.playlistId);
    const operationId =
        event.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST
            ? normalizePreloadPerformanceIdentifier(event.operationId)
            : null;
    const marker =
        event.phase === 'start'
            ? startPreloadPerformanceCall(
                  calls,
                  sequences,
                  event,
                  playlistId,
                  operationId
              )
            : completePreloadPerformanceCall(
                  calls,
                  sequences,
                  event,
                  playlistId,
                  operationId
              );

    return {
        marker,
        state: {
            calls,
            sequences,
        },
    };
}
