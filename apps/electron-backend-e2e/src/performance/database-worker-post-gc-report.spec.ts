/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    type CancellationBenchmarkManifest,
    type CancellationIterationResult,
    PERFORMANCE_ITERATION_KIND,
    PERFORMANCE_WORKER_KIND,
    type WorkerCaptureMetrics,
} from './m3u-refresh-cancellation-contract';
import { createCancellationBenchmarkSummary } from './m3u-refresh-cancellation-report';

function databaseWorker(
    postGcHeapUsedBytes: number | null,
    postGcHeapUnavailableReason: string | null
): WorkerCaptureMetrics {
    return {
        kind: PERFORMANCE_WORKER_KIND.DATABASE,
        peakExternalBytes: 0,
        peakHeapUsedBytes: 0,
        postGcHeapUnavailableReason,
        postGcHeapUsedBytes,
        requests: [],
    } as unknown as WorkerCaptureMetrics;
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
                    peakRssBytes: 2_048,
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
        },
        phases: {},
        renderer: {
            peakHeapUsedBytes: 0,
            postGcHeapUsedBytes: null,
            probe: {
                frameGapsMs: [],
                heartbeatDelaysMs: [],
                longTasksMs: [],
            },
        },
        runId: 'measured',
    } as unknown as CancellationIterationResult;
}

test('summary includes every database isolate instead of silently taking the first', () => {
    const unavailable = databaseWorker(null, 'post-gc-probe-invalid-response');
    const summary = createCancellationBenchmarkSummary(
        {} as CancellationBenchmarkManifest,
        [
            measuredIteration([
                databaseWorker(100, null),
                databaseWorker(300, null),
                unavailable,
            ]),
        ]
    );

    assert.deepEqual(summary.measured.databaseWorkerPostGcHeapBytes, {
        count: 2,
        max: 300,
        mean: 200,
        median: 200,
        min: 100,
        p95: 290,
        p99: 298,
    });
    assert.equal(
        (
            summary.iterations[0]?.main.workers[2] as WorkerCaptureMetrics & {
                readonly postGcHeapUnavailableReason: string | null;
            }
        )?.postGcHeapUnavailableReason,
        'post-gc-probe-invalid-response'
    );
});
