import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    type PreloadPerformanceCorrelationStateName,
    type PreloadPerformanceInvalidReason,
    type PreloadPerformanceMarker,
    type PreloadPerformanceMethod,
    type PreloadPerformancePhase,
} from '@iptvnator/shared/interfaces';

const MAX_IDENTIFIER_LENGTH = 128;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const PRELOAD_PERFORMANCE_SEQUENCE_STAGE = {
    DB_GET_STARTED: 'db-get-started',
    DB_GET_SUCCEEDED: 'db-get-succeeded',
    DB_UPSERT_STARTED: 'db-upsert-started',
    INVALID: 'invalid',
    REFRESH_STARTED: 'refresh-started',
    REFRESH_SUCCEEDED: 'refresh-succeeded',
} as const;

export type PreloadPerformanceSequenceStage =
    (typeof PRELOAD_PERFORMANCE_SEQUENCE_STAGE)[keyof typeof PRELOAD_PERFORMANCE_SEQUENCE_STAGE];

export interface PreloadPerformanceSequence {
    activeCallId: number | null;
    invalidReason: PreloadPerformanceInvalidReason | null;
    operationId: string;
    stage: PreloadPerformanceSequenceStage;
}

export interface PreloadPerformanceCall {
    correlationState: PreloadPerformanceCorrelationStateName;
    expectedOperationId: string | null;
    invalidReason: PreloadPerformanceInvalidReason | null;
    method: PreloadPerformanceMethod;
    operationId: string | null;
    playlistId: string | null;
}

export interface PreloadPerformanceCorrelationEvent {
    ipcCallId: number;
    method: PreloadPerformanceMethod;
    operationId: unknown;
    phase: PreloadPerformancePhase;
    playlistId: unknown;
    refreshCancelled?: boolean;
}

export interface PreloadPerformanceCorrelationState {
    readonly calls: ReadonlyMap<number, PreloadPerformanceCall>;
    readonly sequences: ReadonlyMap<string, PreloadPerformanceSequence>;
}

export interface PreloadPerformanceCorrelationResult {
    marker: PreloadPerformanceMarkerMetadata;
    state: PreloadPerformanceCorrelationState;
}

export type PreloadPerformanceMarkerMetadata = Omit<
    PreloadPerformanceMarker,
    'sourceEpochMs'
>;

export function normalizePreloadPerformanceIdentifier(
    value: unknown
): string | null {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_IDENTIFIER_LENGTH ||
        value !== value.trim() ||
        !SAFE_IDENTIFIER_PATTERN.test(value)
    ) {
        return null;
    }

    return value;
}

export function createPreloadPerformanceMarkerMetadata(
    event: PreloadPerformanceCorrelationEvent,
    playlistId: string | null,
    operationId: string | null,
    correlationState: PreloadPerformanceCorrelationStateName,
    invalidReason: PreloadPerformanceInvalidReason | null
): PreloadPerformanceMarkerMetadata {
    return {
        correlationState,
        invalidReason,
        ipcCallId: event.ipcCallId,
        method: event.method,
        operationId,
        phase: event.phase,
        playlistId,
    };
}

export function createInvalidPreloadPerformanceCall(
    event: PreloadPerformanceCorrelationEvent,
    playlistId: string | null,
    operationId: string | null,
    invalidReason: PreloadPerformanceInvalidReason,
    expectedOperationId = operationId
): PreloadPerformanceCall {
    return {
        correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
        expectedOperationId,
        invalidReason,
        method: event.method,
        operationId,
        playlistId,
    };
}

export function invalidatePreloadPerformanceSequence(
    calls: Map<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    playlistId: string,
    reason: PreloadPerformanceInvalidReason
): PreloadPerformanceSequence | undefined {
    const sequence = sequences.get(playlistId);
    if (!sequence) {
        return undefined;
    }

    const invalidReason =
        sequence.stage === PRELOAD_PERFORMANCE_SEQUENCE_STAGE.INVALID
            ? (sequence.invalidReason ?? reason)
            : reason;
    const invalidSequence: PreloadPerformanceSequence = {
        ...sequence,
        activeCallId: null,
        invalidReason,
        stage: PRELOAD_PERFORMANCE_SEQUENCE_STAGE.INVALID,
    };
    sequences.set(playlistId, invalidSequence);

    for (const [callId, call] of calls) {
        if (
            call.playlistId === playlistId &&
            call.correlationState ===
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED
        ) {
            calls.set(callId, {
                ...call,
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason,
            });
        }
    }

    return invalidSequence;
}

export function closeInvalidPreloadPerformanceSequenceWhenSettled(
    calls: ReadonlyMap<number, PreloadPerformanceCall>,
    sequences: Map<string, PreloadPerformanceSequence>,
    playlistId: string | null
): void {
    if (
        playlistId === null ||
        sequences.get(playlistId)?.stage !==
            PRELOAD_PERFORMANCE_SEQUENCE_STAGE.INVALID
    ) {
        return;
    }

    const hasInvalidCall = Array.from(calls.values()).some(
        (call) =>
            call.playlistId === playlistId &&
            call.correlationState ===
                PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID
    );
    if (!hasInvalidCall) {
        sequences.delete(playlistId);
    }
}
