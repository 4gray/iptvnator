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
    type CorrelationEvent,
    type CorrelationHarness,
} from './preload-performance-correlation.test-helpers';

describe('preload performance marker correlation sequences', () => {
    let advance: CorrelationHarness['advance'];
    let reset: CorrelationHarness['reset'];

    beforeEach(() => {
        ({ advance, reset } = createCorrelationHarness());
    });

    it('correlates the successful refresh persistence sequence and propagates its operation ID', () => {
        const refreshStart = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const refreshSuccess = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        const getStart = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const getSuccess = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        const upsertStart = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const upsertSuccess = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        expect(refreshStart).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            invalidReason: null,
            operationId: OPERATION_ONE,
            playlistId: PLAYLIST_ONE,
        });
        expect(refreshSuccess).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            operationId: OPERATION_ONE,
        });
        expect(getStart.operationId).toBe(OPERATION_ONE);
        expect(getSuccess.operationId).toBe(OPERATION_ONE);
        expect(upsertStart.operationId).toBe(OPERATION_ONE);
        expect(upsertSuccess).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
            invalidReason: null,
            operationId: OPERATION_ONE,
        });
    });

    it('fails closed for wrong-order and duplicate targeted database calls', () => {
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

        const wrongOrder = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(wrongOrder).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
            operationId: OPERATION_ONE,
        });

        reset();
        advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 4,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const duplicate = advance({
            ipcCallId: 5,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const originalCompletion = advance({
            ipcCallId: 4,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        expect(duplicate.invalidReason).toBe(
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
        );
        expect(originalCompletion).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
        });
    });

    it('invalidates concurrent refreshes for the same playlist', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const concurrentStart = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const firstCompletion = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        const concurrentCompletion = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        const restart = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: 'operation-3',
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(concurrentStart).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.CONCURRENT_REFRESH,
            operationId: OPERATION_TWO,
        });
        expect(concurrentCompletion).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.CONCURRENT_REFRESH,
            operationId: OPERATION_TWO,
        });
        expect(restart.correlationState).toBe(
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED
        );
        expect(firstCompletion).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.CONCURRENT_REFRESH,
        });
    });

    it('keeps different playlists independent when one sequence invalidates', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_TWO,
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
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'success',
            playlistId: PLAYLIST_TWO,
        });
        advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const playlistTwoGet = advance({
            ipcCallId: 4,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_TWO,
        });

        expect(playlistTwoGet).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            invalidReason: null,
            operationId: OPERATION_TWO,
            playlistId: PLAYLIST_TWO,
        });
    });

    it('allows a new refresh after the prior sequence completes', () => {
        const events: CorrelationEvent[] = [
            {
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            },
            {
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            },
            {
                ipcCallId: 2,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            },
            {
                ipcCallId: 2,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            },
            {
                ipcCallId: 3,
                method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            },
            {
                ipcCallId: 3,
                method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            },
        ];
        events.forEach((event) => advance(event));

        const restart = advance({
            ipcCallId: 4,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(restart).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            invalidReason: null,
            operationId: OPERATION_TWO,
        });
    });
});
