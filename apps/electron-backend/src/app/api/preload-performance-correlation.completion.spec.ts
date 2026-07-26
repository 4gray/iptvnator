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
    PLAYLIST_TWO,
    type CorrelationHarness,
} from './preload-performance-correlation.test-helpers';

describe('preload performance marker correlation completions', () => {
    let advance: CorrelationHarness['advance'];
    let reset: CorrelationHarness['reset'];

    beforeEach(() => {
        ({ advance, reset } = createCorrelationHarness());
    });

    it.each(['success', 'error'] as const)(
        'rejects a %s completion with the wrong call ID',
        (phase) => {
            advance({
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            });

            const mismatchedCompletion = advance({
                ipcCallId: 99,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase,
                playlistId: PLAYLIST_ONE,
            });
            const originalCompletion = advance({
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            });

            expect(mismatchedCompletion).toMatchObject({
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
            });
            expect(originalCompletion).toMatchObject({
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
            });
        }
    );

    it('rejects a refresh completion whose playlist or operation ID changed', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const changedOperation = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        expect(changedOperation).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
        });

        reset();
        advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const changedPlaylist = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_TWO,
        });

        expect(changedPlaylist).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
        });
    });

    it('rejects a completion whose method differs from the started call', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const wrongMethod = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        const restart = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(wrongMethod).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
        });
        expect(restart.correlationState).toBe(
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED
        );
    });

    it('rejects a duplicate completion instead of advancing the chain twice', () => {
        const refresh = {
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            playlistId: PLAYLIST_ONE,
        } as const;
        advance({ ...refresh, phase: 'start' });
        advance({ ...refresh, phase: 'success' });

        const duplicate = advance({ ...refresh, phase: 'success' });
        const laterGet = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(duplicate).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
        });
        expect(laterGet).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
        });
    });

    it('rejects a database completion for a different playlist', () => {
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
            operationId: null,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const changedPlaylist = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'success',
            playlistId: PLAYLIST_TWO,
        });
        const laterUpsert = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: null,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(changedPlaylist).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
        });
        expect(laterUpsert).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
        });
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
            operationId: null,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const error = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'error',
            playlistId: PLAYLIST_ONE,
        });
        const laterUpsert = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: null,
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
            operationId: null,
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
            operationId: null,
        });
    });
});
