import {
    advancePreloadPerformanceCorrelation,
    createPreloadPerformanceCorrelationState,
    type PreloadPerformanceCorrelationEvent,
} from './preload-performance-correlation';

export const PLAYLIST_ONE = 'playlist-1';
export const PLAYLIST_TWO = 'playlist-2';
export const OPERATION_ONE = 'operation-1';
export const OPERATION_TWO = 'operation-2';

export type CorrelationEvent = PreloadPerformanceCorrelationEvent;

export function createCorrelationHarness() {
    let state = createPreloadPerformanceCorrelationState();

    return {
        advance: (event: PreloadPerformanceCorrelationEvent) => {
            const result = advancePreloadPerformanceCorrelation(state, event);
            state = result.state;
            return result.marker;
        },
        reset: () => {
            state = createPreloadPerformanceCorrelationState();
        },
    };
}

export type CorrelationHarness = ReturnType<typeof createCorrelationHarness>;
