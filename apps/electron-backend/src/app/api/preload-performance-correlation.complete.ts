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

function eventForRememberedCall(
    event: PreloadPerformanceCorrelationEvent,
    call: PreloadPerformanceCall
): PreloadPerformanceCorrelationEvent {
    return {
        ...event,
        method: call.method,
        operationId: call.operationId,
        playlistId: call.playlistId,
    };
}

function invalidCompletion(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    call: PreloadPerformanceCall
): PreloadPerformanceMarkerMetadata {
    const rememberedEvent = eventForRememberedCall(event, call);
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
        rememberedEvent,
        call.playlistId,
        invalidSequence?.operationId ?? call.operationId,
        PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
        invalidSequence?.invalidReason ??
            call.invalidReason ??
            PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
    );
}

function completeCorrelatedCall(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    event: PreloadPerformanceCorrelationEvent,
    call: PreloadPerformanceCall & {
        operationId: string;
        playlistId: string;
    }
): PreloadPerformanceMarkerMetadata {
    const sequence = sequences.get(call.playlistId);
    const expectedStage =
        call.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST
            ? PRELOAD_PERFORMANCE_SEQUENCE_STAGE.REFRESH_STARTED
            : call.method === PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST
              ? PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_GET_STARTED
              : PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_UPSERT_STARTED;
    if (
        !sequence ||
        sequence.operationId !== call.operationId ||
        sequence.stage !== expectedStage
    ) {
        return invalidCompletion(calls, sequences, event, call);
    }

    if (event.phase === 'error') {
        invalidatePreloadPerformanceSequence(
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
            call.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR
        );
    }

    if (
        call.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST &&
        event.refreshCancelled === true
    ) {
        calls.delete(event.ipcCallId);
        sequences.delete(call.playlistId);
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            call.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            PRELOAD_PERFORMANCE_INVALID_REASON.REFRESH_CANCELLED
        );
    }

    calls.delete(event.ipcCallId);
    if (call.method === PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST) {
        sequences.set(call.playlistId, {
            ...sequence,
            stage: PRELOAD_PERFORMANCE_SEQUENCE_STAGE.REFRESH_SUCCEEDED,
        });
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            call.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            null
        );
    }

    if (call.method === PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST) {
        sequences.set(call.playlistId, {
            ...sequence,
            stage: PRELOAD_PERFORMANCE_SEQUENCE_STAGE.DB_GET_SUCCEEDED,
        });
        return createPreloadPerformanceMarkerMetadata(
            event,
            call.playlistId,
            call.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
            null
        );
    }

    sequences.delete(call.playlistId);
    return createPreloadPerformanceMarkerMetadata(
        event,
        call.playlistId,
        call.operationId,
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
        const invalidSequence =
            playlistId === null
                ? undefined
                : invalidatePreloadPerformanceSequence(
                      calls,
                      sequences,
                      playlistId,
                      PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
                  );
        closeInvalidPreloadPerformanceSequenceWhenSettled(
            calls,
            sequences,
            playlistId
        );
        return createPreloadPerformanceMarkerMetadata(
            event,
            playlistId,
            invalidSequence?.operationId ?? operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidSequence?.invalidReason ??
                PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
        );
    }

    const identityMatches =
        call.method === event.method &&
        call.operationId === operationId &&
        call.playlistId === playlistId;
    if (!identityMatches) {
        return invalidCompletion(calls, sequences, event, call);
    }

    const rememberedEvent = eventForRememberedCall(event, call);
    if (
        call.correlationState ===
        PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED
    ) {
        calls.delete(event.ipcCallId);
        return createPreloadPerformanceMarkerMetadata(
            rememberedEvent,
            call.playlistId,
            call.operationId,
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
            rememberedEvent,
            call.playlistId,
            call.operationId,
            PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            call.invalidReason ??
                PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER
        );
    }

    return completeCorrelatedCall(
        calls,
        sequences,
        rememberedEvent,
        call as PreloadPerformanceCall & {
            operationId: string;
            playlistId: string;
        }
    );
}
