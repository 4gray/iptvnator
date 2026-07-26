import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_INVALID_REASON,
    PRELOAD_PERFORMANCE_METHOD,
} from '@iptvnator/shared/interfaces';
import {
    PRELOAD_PERFORMANCE_SEQUENCE_STAGE,
    createInvalidPreloadPerformanceCall,
    createPreloadPerformanceMarkerMetadata,
    invalidatePreloadPerformanceSequence,
    type PreloadPerformanceCall,
    type PreloadPerformanceCorrelationEvent,
    type PreloadPerformanceMarkerMetadata,
    type PreloadPerformanceSequence,
} from './preload-performance-correlation.model';

function startRefresh(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    playlistId: string,
    operationId: string
): PreloadPerformanceMarkerMetadata {
    const sequence = sequences.get(playlistId);
    if (sequence) {
        const invalidSequence = invalidatePreloadPerformanceSequence(
            calls,
            sequences,
            playlistId,
            sequence.stage === PRELOAD_PERFORMANCE_SEQUENCE_STAGE.INVALID
                ? (sequence.invalidReason ??
                      PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER)
                : PRELOAD_PERFORMANCE_INVALID_REASON.CONCURRENT_REFRESH
        );
        const invalidReason =
            invalidSequence?.invalidReason ??
            PRELOAD_PERFORMANCE_INVALID_REASON.CONCURRENT_REFRESH;
        calls.set(
            event.ipcCallId,
            createInvalidPreloadPerformanceCall(
                event,
                playlistId,
                operationId,
                invalidReason,
                operationId
            )
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason
        );
    }

    sequences.set(playlistId, {
        activeCallId: event.ipcCallId,
        invalidReason: null,
        operationId,
        stage: PRELOAD_PERFORMANCE_SEQUENCE_STAGE.REFRESH_STARTED,
    });
    calls.set(event.ipcCallId, {
        correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
        expectedOperationId: operationId,
        invalidReason: null,
        method: event.method,
        operationId,
        playlistId,
    });
    return createPreloadPerformanceMarkerMetadata(
        event,
        playlistId,
        operationId,
        PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
        null
    );
}

function startDatabaseCall(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    playlistId: string
): PreloadPerformanceMarkerMetadata {
    const sequence = sequences.get(playlistId);
    if (!sequence) {
        calls.set(event.ipcCallId, {
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            expectedOperationId: null,
            invalidReason: null,
            method: event.method,
            operationId: null,
            playlistId,
        });
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            null,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            null
        );
    }

    if (sequence.stage === PRELOAD_PERFORMANCE_SEQUENCE_STAGE.INVALID) {
        const invalidReason =
            sequence.invalidReason ??
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER;
        calls.set(
            event.ipcCallId,
            createInvalidPreloadPerformanceCall(
                event,
                playlistId,
                sequence.operationId,
                invalidReason,
                null
            )
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            sequence.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason
        );
    }

    const isGet =
        event.method === PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST;
    const expectedStage = isGet
        ? PRELOAD_PERFORMANCE_SEQUENCE_STAGE.REFRESH_SUCCEEDED
        : PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_GET_SUCCEEDED;
    const startedStage = isGet
        ? PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_GET_STARTED
        : PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_UPSERT_STARTED;
    if (sequence.stage !== expectedStage) {
        const invalidSequence = invalidatePreloadPerformanceSequence(
            calls,
            sequences,
            playlistId,
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
        );
        const invalidReason =
            invalidSequence?.invalidReason ??
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER;
        calls.set(
            event.ipcCallId,
            createInvalidPreloadPerformanceCall(
                event,
                playlistId,
                sequence.operationId,
                invalidReason,
                null
            )
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            sequence.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason
        );
    }

    sequences.set(playlistId, {
        ...sequence,
        activeCallId: event.ipcCallId,
        stage: startedStage,
    });
    calls.set(event.ipcCallId, {
        correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
        expectedOperationId: null,
        invalidReason: null,
        method: event.method,
        operationId: sequence.operationId,
        playlistId,
    });
    return createPreloadPerformanceMarkerMetadata(
        event,
        playlistId,
        sequence.operationId,
        PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
        null
    );
}

export function startPreloadPerformanceCall(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    playlistId: string | null,
    operationId: string | null
): PreloadPerformanceMarkerMetadata {
    if (
        playlistId === null ||
        (event.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST &&
            operationId === null)
    ) {
        if (playlistId !== null) {
            invalidatePreloadPerformanceSequence(
                calls,
                sequences,
                playlistId,
                PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER
            );
        }
        calls.set(
            event.ipcCallId,
            createInvalidPreloadPerformanceCall(
                event,
                playlistId,
                null,
                PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
                operationId
            )
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            null,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER
        );
    }

    const existingCall = calls.get(event.ipcCallId);
    if (existingCall) {
        const sequence =
            existingCall.playlistId === null
                ? undefined
                : invalidatePreloadPerformanceSequence(
                      calls,
                      sequences,
                      existingCall.playlistId,
                      PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
                  );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            sequence?.operationId ?? null,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            sequence?.invalidReason ??
                PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
        );
    }

    return event.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST
        ? startRefresh(calls, sequences, event, playlistId, operationId)
        : startDatabaseCall(calls, sequences, event, playlistId);
}
