/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    type CancellationBenchmarkManifest,
    type CancellationIterationResult,
    PERFORMANCE_ITERATION_KIND,
    PERFORMANCE_WORKER_KIND,
    type WorkerCaptureMetrics,
    type WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import {
    type MainCaptureGenerationTransport,
    normalizeWorkerRequestPerformanceOutcome,
    selectMainCaptureGeneration,
} from './worker-request-performance';
import { createCancellationBenchmarkSummary } from './m3u-refresh-cancellation-report';

type RequestPerformanceFixture = WorkerRequestPerformanceMetrics;
function requestPerformance(
    requestId: string,
    p95Ms: number,
    threadCpuUserMicros: number
): RequestPerformanceFixture {
    return normalizeWorkerRequestPerformanceOutcome(
        requestTransport(
            {
                eventLoopDelay: {
                    maxMs: p95Ms + 1,
                    p95Ms,
                    p99Ms: p95Ms + 0.5,
                },
                eventLoopDelayUnavailableReason: null,
                eventLoopUtilization: p95Ms / 100,
                eventLoopUtilizationUnavailableReason: null,
                histogramFlushedEpochMs: 1_050,
                invalidReason: null,
                requestReceivedEpochMs: 1_000,
                responsePostedEpochMs: 1_055,
                threadCpuSystemMicros: threadCpuUserMicros / 2,
                threadCpuUnavailableReason: null,
                threadCpuUserMicros,
                workEndedEpochMs: 1_040,
                workStartedEpochMs: 1_010,
            },
            requestId
        )
    );
}
function requestTransport(
    performanceCapture: unknown,
    requestId = 'request-1'
) {
    return {
        ipcCallId: 7,
        operation: 'DB_GET_CONTENT',
        operationId: 'operation-42',
        operationIdUnavailableReason: null,
        performanceCapture,
        playlistId: 'playlist-1',
        requestId,
        responseEpochMs: 1_060,
        sourceEpochMs: 990,
        success: true,
    } as const;
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
}
function databaseWorker(
    requests: readonly RequestPerformanceFixture[]
): WorkerCaptureMetrics {
    return {
        kind: PERFORMANCE_WORKER_KIND.DATABASE,
        operationId: null,
        peakExternalBytes: 0,
        peakHeapUsedBytes: 0,
        playlistId: null,
        postGcHeapUsedBytes: null,
        requests,
        responseEpochMs: null,
        terminatedEpochMs: null,
    } as WorkerCaptureMetrics;
}
function playlistWorker(
    request: RequestPerformanceFixture,
    operationId: string,
    terminatedEpochMs: number
): WorkerCaptureMetrics {
    return {
        ...databaseWorker([request]),
        kind: PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
        operationId,
        playlistId: request.playlistId,
        responseEpochMs: request.responseEpochMs,
        terminatedEpochMs,
    };
}

function measuredIteration(
    workers: readonly WorkerCaptureMetrics[]
): CancellationIterationResult {
    return {
        cancellationEffectObserved: true,
        kind: PERFORMANCE_ITERATION_KIND.MEASURED,
        main: {
            eventLoopDelay: { maxMs: 0, p95Ms: 0, p99Ms: 0 },
            eventLoopUtilization: null,
            memory: {
                peakHeapUsedBytes: 0,
                peakRssBytes: 0,
                postGcHeapUsedBytes: null,
                postGcRssBytes: null,
            },
            rendererWindow: {
                responsiveEvents: 0,
                rss: {
                    identity: {
                        creationTime: 1_721_234_567_890,
                        pid: 42,
                    },
                    missingSampleCount: 0,
                    peakRssBytes: 0,
                    unavailableReason: null,
                    validSampleCount: 1,
                },
                unresponsiveEvents: 0,
                windowIdentity: {
                    browserWindowId: 7,
                    webContentsId: 11,
                },
            },
            workers,
        } as CancellationIterationResult['main'],
        phases: {} as CancellationIterationResult['phases'],
        renderer: {
            peakHeapUsedBytes: 0,
            postGcHeapUsedBytes: null,
            probe: {
                frameGapsMs: [],
                heartbeatDelaysMs: [],
                longTasksMs: [],
            },
        } as CancellationIterationResult['renderer'],
        runId: 'measured-1',
    };
}

test('summary distributions use every request capture instead of a worker-level percentile maximum', () => {
    const requests = [
        requestPerformance('request-1', 5, 100),
        requestPerformance('request-2', 15, 300),
    ];
    const summary = createCancellationBenchmarkSummary(
        {} as CancellationBenchmarkManifest,
        [measuredIteration([databaseWorker(requests)])]
    );
    const measured = summary.measured as unknown as Record<
        string,
        { count: number; max: number | null; min: number | null }
    >;

    assert.deepEqual(
        summary.measured.databaseWorkerRequestEventLoopDelayP95Ms,
        {
            count: 2,
            max: 15,
            mean: 10,
            median: 10,
            min: 5,
            p95: 14.5,
            p99: 14.9,
        }
    );
    assert.deepEqual(measured['databaseWorkerRequestThreadCpuUserMicros'], {
        count: 2,
        max: 300,
        mean: 200,
        median: 200,
        min: 100,
        p95: 290,
        p99: 298,
    });
    assert.equal(
        summary.iterations[0]?.main.workers[0]?.requests[0]?.operationId,
        'operation-42'
    );
    assert.equal(
        'databaseWorkerEventLoopDelayP95Ms' in summary.measured,
        false,
        'request-percentile distributions must not look like an operation-wide percentile'
    );
});

test('main capture retains raw request identity, timestamps, metrics, and reasons', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );

    assert.match(source, /requestPerformance: \[\]/);
    assert.match(source, /record\.requestPerformance\.map/);
    assert.match(source, /operationId: request\.identity\.operationId/);
    assert.match(source, /ipcCallId: request\.identity\.ipcCallId/);
    assert.match(source, /identity: request\.identity/);
    assert.match(source, /performanceCapture:\s+message\['performance'\]/);
    assert.match(source, /sourceEpochMs: request\.identity\.sourceEpochMs/);
    assert.match(source, /captureGeneration: state\.captureGeneration/);
    assert.doesNotMatch(
        source,
        /record\.eventLoopDelay = record\.eventLoopDelay/
    );
});

test('normalized raw request metrics retain the exact preload IPC call identity', () => {
    const capture = requestPerformance('request-1', 5, 100);

    assert.equal(capture.ipcCallId, 7);
    assert.equal(capture.sourceEpochMs, 990);
});

test('benchmark resolves one exact BrowserWindow and main capture never scans all windows', () => {
    const benchmarkSource = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const mainCaptureSource = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );

    assert.match(
        benchmarkSource,
        /electronApp\.browserWindow\(\s*app\.mainWindow\s*\)/
    );
    assert.match(benchmarkSource, /rendererWindowIdentity/);
    assert.doesNotMatch(mainCaptureSource, /BrowserWindow\.getAllWindows/);
    assert.doesNotMatch(mainCaptureSource, /type\.includes\('renderer'\)/);
    assert.doesNotMatch(mainCaptureSource, /type\.includes\('tab'\)/);
});

test('capture-generation selection excludes a pre-start seed worker', () => {
    const seed = playlistWorker(
        requestPerformance('seed-request', 999, 999),
        'seed-operation',
        1_100
    );
    const measured = playlistWorker(
        {
            ...requestPerformance('measured-request', 8, 80),
            success: false,
        },
        'measured-cancel-operation',
        2_100
    );

    const mainMetrics = measuredIteration([]).main;
    const toTransportWorker = (
        captureGeneration: number | null,
        worker: WorkerCaptureMetrics
    ) => ({
        captureGeneration,
        metrics: worker,
        requests: worker.requests.map((request) => ({
            ...requestTransport(request, request.requestId ?? undefined),
            success: request.success,
        })),
    });
    const selected = selectMainCaptureGeneration({
        captureGeneration: 2,
        metrics: mainMetrics,
        workers: [
            toTransportWorker(null, seed),
            toTransportWorker(2, measured),
        ],
    });

    assert.equal(selected.workers.length, 1);
    assert.equal(
        selected.workers[0]?.requests[0]?.requestId,
        'measured-request'
    );
    assert.equal(selected.workers[0]?.operationId, 'measured-cancel-operation');
    assert.equal(selected.workers[0]?.terminatedEpochMs, 2_100);
});

test('fails closed for incoherent worker post-GC metrics at the Electron boundary', () => {
    const invalidOutcomes = [
        {
            postGcHeapUnavailableReason: 'gc-unavailable',
            postGcHeapUsedBytes: 100,
        },
        {
            postGcHeapUnavailableReason: null,
            postGcHeapUsedBytes: null,
        },
        {
            postGcHeapUnavailableReason: null,
            postGcHeapUsedBytes: -1,
        },
        {
            postGcHeapUnavailableReason: 'unknown-reason',
            postGcHeapUsedBytes: null,
        },
    ] as const;

    for (const outcome of invalidOutcomes) {
        const selected = selectMainCaptureGeneration({
            captureGeneration: 3,
            metrics: measuredIteration([]).main,
            workers: [
                {
                    captureGeneration: 3,
                    metrics: {
                        ...databaseWorker([]),
                        ...outcome,
                    },
                    requests: [],
                },
            ],
        } as unknown as MainCaptureGenerationTransport);
        const worker = selected.workers[0] as WorkerCaptureMetrics & {
            readonly postGcHeapUnavailableReason: string | null;
        };

        assert.equal(worker.postGcHeapUsedBytes, null);
        assert.equal(
            worker.postGcHeapUnavailableReason,
            'post-gc-capture-invalid'
        );
    }
});

test('raw outcomes retain missing and malformed captures while summaries exclude their null metrics', () => {
    const valid = normalizeWorkerRequestPerformanceOutcome(
        requestTransport(requestPerformance('request-1', 5, 100))
    );
    const missing = normalizeWorkerRequestPerformanceOutcome(
        requestTransport(null, 'request-2')
    );
    const malformed = normalizeWorkerRequestPerformanceOutcome(
        requestTransport(
            {
                requestReceivedEpochMs: 'invalid',
                workEndedEpochMs: 1_080,
                workStartedEpochMs: 1_075,
            },
            'request-3'
        )
    );
    const worker = databaseWorker([valid, missing, malformed]);
    const summary = createCancellationBenchmarkSummary(
        {} as CancellationBenchmarkManifest,
        [measuredIteration([worker])]
    );

    assert.equal(worker.requests.length, 3);
    assertClosedCapture(
        worker.requests[1] as WorkerRequestPerformanceMetrics,
        'worker-performance-capture-missing'
    );
    assertClosedCapture(
        worker.requests[2] as WorkerRequestPerformanceMetrics,
        'worker-performance-capture-invalid'
    );
    assert.equal(
        summary.measured.databaseWorkerRequestEventLoopDelayP95Ms.count,
        1
    );
    assert.equal(
        summary.measured.databaseWorkerRequestThreadCpuUserMicros.count,
        1
    );
});
