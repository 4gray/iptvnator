import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_INVALID_REASON,
    PRELOAD_PERFORMANCE_METHOD,
} from '@iptvnator/shared/interfaces';
import {
    PRELOAD_PERFORMANCE_SEQUENCE_STAGE,
    closeInvalidPreloadPerformanceSequenceWhenSettled,
    createPreloadPerformanceMarkerMetadata,
    invalidatePreloadPerformanceSequence,
    type PreloadPerformanceCall,
    type PreloadPerformanceCorrelationEvent,
    type PreloadPerformanceMarkerMetadata,
    type PreloadPerformanceSequence,
} from './preload-performance-correlation.model';

function invalidCompletion(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    call: PreloadPerformanceCall
): PreloadPerformanceMarkerMetadata {
    const invalidSequence =
        call.playlistId === null
            ? undefined
            : invalidatePreloadPerformanceSequence(
                  calls,
                  sequences,
                  call.playlistId,
                  PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
              );
    calls.delete(event.ipcCallId);
    closeInvalidPreloadPerformanceSequenceWhenSettled(
        calls,
        sequences,
        call.playlistId
    );
    return createPreloadPerformanceMarkerMetadata(
        event,
        call.playlistId,
        invalidSequence?.operationId ?? call.operationId,
        PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
        invalidSequence?.invalidReason ??
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
    );
}

function completeCorrelatedCall(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    call: PreloadPerformanceCall & { playlistId: string }
): PreloadPerformanceMarkerMetadata {
    const sequence = sequences.get(call.playlistId);
    const expectedStage =
        event.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST
            ? PRELOAD_PERFORMANCE_SEQUENCE_STAGE.REFRESH_STARTED
            : event.method === PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST
              ? PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_GET_STARTED
              : PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_UPSERT_STARTED;
    if (
        !sequence ||
        sequence.stage !== expectedStage ||
        sequence.activeCallId !== event.ipcCallId ||
        sequence.operationId !== call.operationId
    ) {
        return invalidCompletion(calls, sequences, event, call);
    }

    if (event.phase === 'error') {
        const invalidSequence = invalidatePreloadPerformanceSequence(
            calls,
            sequences,
            call.playlistId,
            PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR
        );
        calls.delete(event.ipcCallId);
        closeInvalidPreloadPerformanceSequenceWhenSettled(
            calls,
            sequences,
            call.playlistId
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            sequence.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidSequence?.invalidReason ??
                PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR
        );
    }

    if (
        event.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST &&
        event.refreshCancelled === true
    ) {
        sequences.delete(call.playlistId);
        calls.delete(event.ipcCallId);
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            sequence.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            PRELOAD_PERFORMANCE_INVALID_REASON.REFRESH_CANCELLED
        );
    }

    calls.delete(event.ipcCallId);
    if (event.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST) {
        sequences.set(call.playlistId, {
            ...sequence,
            activeCallId: null,
            stage: PRELOAD_PERFORMANCE_SEQUENCE_STAGE.REFRESH_SUCCEEDED,
        });
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            sequence.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            null
        );
    }

    if (event.method === PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST) {
        sequences.set(call.playlistId, {
            ...sequence,
            activeCallId: null,
            stage: PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_GET_SUCCEEDED,
        });
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            sequence.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            null
        );
    }

    sequences.delete(call.playlistId);
    return createPreloadPerformanceMarkerMetadata(
        event,
        call.playlistId,
        sequence.operationId,
        PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
        null
    );
}

export function completePreloadPerformanceCall(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    playlistId: string | null,
    operationId: string | null
): PreloadPerformanceMarkerMetadata {
    const call = calls.get(event.ipcCallId);
    if (!call) {
        const sequence = playlistId ? sequences.get(playlistId) : undefined;
        const invalidSequence = playlistId
            ? invalidatePreloadPerformanceSequence(
                  calls,
                  sequences,
                  playlistId,
                  PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
              )
            : undefined;
        const invalidReason =
            invalidSequence?.invalidReason ??
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER;
        closeInvalidPreloadPerformanceSequenceWhenSettled(
            calls,
            sequences,
            playlistId
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            invalidSequence?.operationId ?? sequence?.operationId ?? null,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason
        );
    }

    const identityMatches =
        call.method === event.method &&
        call.playlistId === playlistId &&
        (event.method !== PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST ||
            call.expectedOperationId === operationId);
    if (!identityMatches) {
        return invalidCompletion(calls, sequences, event, call);
    }

    if (
        call.correlationState ===
        PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED
    ) {
        calls.delete(event.ipcCallId);
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            null,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            null
        );
    }

    if (
        call.correlationState === PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID
    ) {
        calls.delete(event.ipcCallId);
        closeInvalidPreloadPerformanceSequenceWhenSettled(
            calls,
            sequences,
            call.playlistId
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            call.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            call.invalidReason ??
                PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
        );
    }

    if (call.playlistId === null) {
        return invalidCompletion(calls, sequences, event, call);
    }
    return completeCorrelatedCall(
        calls,
        sequences,
        event,
        call as PreloadPerformanceCall & { playlistId: string }
    );
}
