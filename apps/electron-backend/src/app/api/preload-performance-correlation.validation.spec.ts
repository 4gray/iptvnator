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

describe('preload performance marker correlation validation', () => {
    let advance: CorrelationHarness['advance'];

    beforeEach(() => {
        ({ advance } = createCorrelationHarness());
    });

    it('uses null identifiers and a fixed reason for malformed inputs', () => {
        const malformedPlaylist = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: 'https://secret.example/private.m3u',
        });
        const malformedOperation = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: { secret: OPERATION_TWO },
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const malformedDbId = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: null,
            phase: 'start',
            playlistId: undefined,
        });
        const malformedPlaylistCompletion = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: 'https://secret.example/private.m3u',
        });

        expect(malformedPlaylist).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
            operationId: null,
            playlistId: null,
        });
        expect(malformedOperation).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
            operationId: null,
            playlistId: PLAYLIST_ONE,
        });
        expect(malformedDbId).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
            operationId: null,
            playlistId: null,
        });
        expect(malformedPlaylistCompletion).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason:
                PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
            operationId: null,
            playlistId: null,
        });
    });

    it('keeps targeted database calls outside a sequence visible and uncorrelated', () => {
        const getStart = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const getSuccess = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        expect(getStart).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
            operationId: null,
        });
        expect(getSuccess).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
            operationId: null,
        });
    });
});
