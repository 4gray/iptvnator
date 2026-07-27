/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import { normalizeWorkerRequestPerformanceOutcome } from './worker-request-performance';

const validCapture = {
    eventLoopDelay: { maxMs: 6, p95Ms: 5, p99Ms: 5.5 },
    eventLoopDelayUnavailableReason: null,
    eventLoopUtilization: 0.5,
    eventLoopUtilizationUnavailableReason: null,
    histogramFlushedEpochMs: 1_050,
    invalidReason: null,
    requestReceivedEpochMs: 1_000,
    responsePostedEpochMs: 1_055,
    threadCpuSystemMicros: 50,
    threadCpuUnavailableReason: null,
    threadCpuUserMicros: 100,
    workEndedEpochMs: 1_040,
    workStartedEpochMs: 1_010,
} as const;

function normalizeForOperation(
    operation: string,
    performanceCapture: unknown
) {
    return normalizeWorkerRequestPerformanceOutcome({
        ipcCallId: 2,
        operation,
        operationId: 'operation-42',
        operationIdUnavailableReason: null,
        performanceCapture,
        playlistId: 'playlist-1',
        requestId: 'request-1',
        responseEpochMs: 1_060,
        sourceEpochMs: 990,
        success: true,
    });
}

function normalize(performanceCapture: unknown) {
    return normalizeForOperation('DB_GET_CONTENT', performanceCapture);
}

function assertClosedCapture(
    capture: WorkerRequestPerformanceMetrics,
    reason: string
): void {
    assert.equal(capture.performanceCaptureUnavailableReason, reason);
    assert.equal(capture.operationId, 'operation-42');
    for (const value of [
        capture.eventLoopDelay,
        capture.eventLoopDelayUnavailableReason,
        capture.eventLoopUtilization,
        capture.eventLoopUtilizationUnavailableReason,
        capture.histogramFlushedEpochMs,
        capture.invalidReason,
        capture.requestReceivedEpochMs,
        capture.responsePostedEpochMs,
        capture.threadCpuSystemMicros,
        capture.threadCpuUnavailableReason,
        capture.threadCpuUserMicros,
        capture.workEndedEpochMs,
        capture.workStartedEpochMs,
    ]) {
        assert.equal(value, null);
    }
    assert.deepEqual(capture.phaseEvents, []);
}

test('absent captures are missing while present non-record captures are invalid', () => {
    for (const missing of [undefined, null]) {
        assertClosedCapture(
            normalize(missing),
            'worker-performance-capture-missing'
        );
    }
    for (const malformed of [42, [], 'capture']) {
        assertClosedCapture(
            normalize(malformed),
            'worker-performance-capture-invalid'
        );
    }
});

test('malformed nested fields and cross-field invariants fail the whole capture closed', () => {
    const malformed = [
        { ...validCapture, eventLoopDelay: [] },
        {
            ...validCapture,
            eventLoopDelay: { maxMs: 6, p95Ms: 'bad', p99Ms: 5.5 },
        },
        {
            ...validCapture,
            eventLoopDelay: { maxMs: 5, p95Ms: 6, p99Ms: 5.5 },
        },
        { ...validCapture, eventLoopDelayUnavailableReason: 42 },
        {
            ...validCapture,
            eventLoopDelay: null,
            eventLoopDelayUnavailableReason: null,
            histogramFlushedEpochMs: null,
        },
        {
            ...validCapture,
            eventLoopDelay: null,
            eventLoopDelayUnavailableReason:
                'event-loop-delay-capture-unavailable',
        },
        { ...validCapture, eventLoopUtilization: 1.01 },
        {
            ...validCapture,
            eventLoopUtilization: null,
            eventLoopUtilizationUnavailableReason: null,
        },
        { ...validCapture, threadCpuSystemMicros: null },
        {
            ...validCapture,
            threadCpuSystemMicros: null,
            threadCpuUnavailableReason: null,
            threadCpuUserMicros: null,
        },
        { ...validCapture, threadCpuUnavailableReason: 'unavailable' },
        { ...validCapture, histogramFlushedEpochMs: null },
        {
            ...validCapture,
            eventLoopDelay: null,
            eventLoopDelayUnavailableReason: 'event-loop-delay-invalid',
            histogramFlushedEpochMs: null,
        },
        { ...validCapture, histogramFlushedEpochMs: 1_039 },
        { ...validCapture, responsePostedEpochMs: undefined },
        { ...validCapture, responsePostedEpochMs: 1_039 },
        { ...validCapture, responsePostedEpochMs: 1_061 },
        { ...validCapture, workStartedEpochMs: 999 },
        {
            ...validCapture,
            invalidReason: 'overlapping-database-worker-requests',
        },
        { ...validCapture, threadCpuUserMicros: undefined },
    ];
    for (const performanceCapture of malformed) {
        assertClosedCapture(
            normalize(performanceCapture),
            'worker-performance-capture-invalid'
        );
    }
});

test('coherent metric-unavailable and invalid worker results remain valid raw captures', () => {
    const unavailable = {
        ...validCapture,
        eventLoopDelay: null,
        eventLoopDelayUnavailableReason: 'event-loop-delay-capture-unavailable',
        eventLoopUtilization: null,
        eventLoopUtilizationUnavailableReason:
            'event-loop-utilization-unavailable',
        histogramFlushedEpochMs: null,
        threadCpuSystemMicros: null,
        threadCpuUnavailableReason: 'thread-cpu-usage-unavailable',
        threadCpuUserMicros: null,
    };
    for (const capture of [
        unavailable,
        {
            ...validCapture,
            eventLoopDelay: null,
            eventLoopDelayUnavailableReason: 'event-loop-delay-invalid',
        },
    ]) {
        const accepted = normalize(capture);
        assert.equal(accepted.performanceCaptureUnavailableReason, null);
        assert.equal(accepted.requestReceivedEpochMs, 1_000);
    }

    const invalidReason = 'overlapping-database-worker-requests';
    const legitimateInvalid = normalize({
        ...unavailable,
        eventLoopDelayUnavailableReason: invalidReason,
        eventLoopUtilizationUnavailableReason: invalidReason,
        invalidReason,
        threadCpuUnavailableReason: invalidReason,
    });
    assert.equal(legitimateInvalid.performanceCaptureUnavailableReason, null);
    assert.equal(legitimateInvalid.invalidReason, invalidReason);
});

test('requires the exact operation-specific worker phase sequence', () => {
    const upsertPhaseEvents = [
        {
            boundary: 'start',
            durationMs: null,
            epochMs: 1_015,
            phase: 'serialize.playlist',
            requestId: 'request-1',
        },
        {
            boundary: 'end',
            durationMs: 5,
            epochMs: 1_020,
            metadata: { byteCount: 2048, itemCount: 10_000 },
            phase: 'serialize.playlist',
            requestId: 'request-1',
        },
        {
            boundary: 'start',
            durationMs: null,
            epochMs: 1_021,
            phase: 'sqlite.write',
            requestId: 'request-1',
        },
        {
            boundary: 'end',
            durationMs: 12,
            epochMs: 1_033,
            metadata: { byteCount: 2048, itemCount: 1 },
            phase: 'sqlite.write',
            requestId: 'request-1',
        },
    ] as const;
    const getPhaseEvents = [
        {
            boundary: 'start',
            durationMs: null,
            epochMs: 1_015,
            phase: 'sqlite.read',
            requestId: 'request-1',
        },
        {
            boundary: 'end',
            durationMs: 5,
            epochMs: 1_020,
            metadata: { itemCount: 1 },
            phase: 'sqlite.read',
            requestId: 'request-1',
        },
        {
            boundary: 'start',
            durationMs: null,
            epochMs: 1_021,
            phase: 'deserialize.playlist',
            requestId: 'request-1',
        },
        {
            boundary: 'end',
            durationMs: 12,
            epochMs: 1_033,
            metadata: { itemCount: 10_000 },
            phase: 'deserialize.playlist',
            requestId: 'request-1',
        },
    ] as const;

    assert.deepEqual(
        normalizeForOperation('DB_UPSERT_APP_PLAYLIST', {
            ...validCapture,
            phaseEvents: upsertPhaseEvents,
        }).phaseEvents,
        upsertPhaseEvents
    );
    assert.deepEqual(
        normalizeForOperation('DB_GET_APP_PLAYLIST', {
            ...validCapture,
            phaseEvents: getPhaseEvents,
        }).phaseEvents,
        getPhaseEvents
    );

    for (const invalidPhaseEvents of [
        getPhaseEvents.slice(0, 2),
        getPhaseEvents.slice(1),
        [...getPhaseEvents].reverse(),
        getPhaseEvents.map((event) => ({
            ...event,
            requestId: 'other-request',
        })),
        [
            getPhaseEvents[0],
            {
                ...getPhaseEvents[1],
                metadata: { itemCount: 1, secret: 'not allowed' },
            },
        ],
        [
            getPhaseEvents[0],
            {
                ...getPhaseEvents[1],
                phase: 'arbitrary.phase',
            },
        ],
    ]) {
        assertClosedCapture(
            normalizeForOperation('DB_GET_APP_PLAYLIST', {
                ...validCapture,
                phaseEvents: invalidPhaseEvents,
            }),
            'worker-performance-capture-invalid'
        );
    }

    for (const [operation, phaseEvents] of [
        ['DB_GET_APP_PLAYLIST', upsertPhaseEvents],
        ['DB_UPSERT_APP_PLAYLIST', getPhaseEvents],
        ['DB_GET_CONTENT', getPhaseEvents],
    ] as const) {
        assertClosedCapture(
            normalizeForOperation(operation, {
                ...validCapture,
                phaseEvents,
            }),
            'worker-performance-capture-invalid'
        );
    }

    for (const operation of [
        'DB_GET_APP_PLAYLIST',
        'DB_UPSERT_APP_PLAYLIST',
    ]) {
        assertClosedCapture(
            normalizeForOperation(operation, validCapture),
            'worker-performance-capture-invalid'
        );
    }

    assert.deepEqual(normalize(validCapture).phaseEvents, []);
});
