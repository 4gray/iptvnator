/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    type CancellationBenchmarkManifest,
    type CancellationIterationResult,
    PERFORMANCE_ITERATION_KIND,
} from './m3u-refresh-cancellation-contract';
import { createCancellationBenchmarkSummary } from './m3u-refresh-cancellation-report';
import type { RendererProcessRssCapture } from './renderer-process-rss-capture';

function measuredIteration(
    rss: RendererProcessRssCapture,
    responsiveEvents: number,
    unresponsiveEvents: number
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
            rendererPeakRssBytes: 999_999_999,
            rendererWindow: {
                responsiveEvents,
                rss,
                unresponsiveEvents,
                windowIdentity: {
                    browserWindowId: 7,
                    webContentsId: 11,
                },
            },
            responsiveEvents: 100,
            unresponsiveEvents: 100,
            workers: [],
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

test('summary uses only exact target-window RSS and scoped responsiveness events', () => {
    const summary = createCancellationBenchmarkSummary(
        {} as CancellationBenchmarkManifest,
        [
            measuredIteration(
                {
                    identity: {
                        creationTime: 1_721_234_567_890,
                        pid: 42,
                    },
                    missingSampleCount: 0,
                    peakRssBytes: 2_048,
                    unavailableReason: null,
                    validSampleCount: 3,
                },
                1,
                2
            ),
            measuredIteration(
                {
                    identity: null,
                    missingSampleCount: 1,
                    peakRssBytes: null,
                    unavailableReason:
                        'renderer-process-metric-missing-at-start',
                    validSampleCount: 0,
                },
                3,
                4
            ),
        ]
    );

    assert.deepEqual(summary.measured.rendererRssPeakBytes, {
        count: 1,
        max: 2_048,
        mean: 2_048,
        median: 2_048,
        min: 2_048,
        p95: 2_048,
        p99: 2_048,
    });
    assert.equal(summary.measured.responsiveEvents, 4);
    assert.equal(summary.measured.unresponsiveEvents, 6);
});
