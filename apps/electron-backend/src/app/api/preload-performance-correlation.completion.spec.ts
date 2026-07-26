import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_INVALID_REASON,
    PRELOAD_PERFORMANCE_METHOD,
} from '@iptvnator/shared/interfaces';
import {
    createCorrelationHarness,
    OPERATION_ONE,
    OPERATION_TWO,
    PLAYLIST_ONE,
    type CorrelationHarness,
} from './preload-performance-correlation.test-helpers';

describe('preload performance marker correlation completions', () => {
    let advance: CorrelationHarness['advance'];

    beforeEach(() => {
        ({ advance } = createCorrelationHarness());
    });

    it('invalidates a correlated sequence when a target call errors', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const error = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'error',
            playlistId: PLAYLIST_ONE,
        });
        const laterUpsert = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const restart = advance({
            ipcCallId: 4,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(error).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR,
            operationId: OPERATION_ONE,
        });
        expect(laterUpsert).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
            operationId: OPERATION_ONE,
        });
        expect(restart.correlationState).toBe(
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED
        );
    });

    it('closes a cancelled refresh without awaiting database persistence', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const cancelled = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
            refreshCancelled: true,
        });
        const laterGet = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(cancelled).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.REFRESH_CANCELLED,
            operationId: OPERATION_ONE,
        });
        expect(laterGet).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
            operationId: OPERATION_ONE,
        });
    });
});
