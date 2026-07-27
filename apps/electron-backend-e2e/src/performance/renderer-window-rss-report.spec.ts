/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    unresponsiveEvents: number,
    runId: string
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
        runId,
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
                2,
                'run-01'
            ),
            measuredIteration(
                {
                    identity: {
                        creationTime: 1_721_234_567_890,
                        pid: 43,
                    },
                    missingSampleCount: 1,
                    peakRssBytes: null,
                    unavailableReason:
                        'renderer-process-metric-missing-during-capture',
                    validSampleCount: 2,
                },
                3,
                4,
                'run-02'
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
    assert.deepEqual(
        (
            summary as unknown as {
                readonly validity: {
                    readonly rendererRss: unknown;
                };
            }
        ).validity.rendererRss,
        {
            invalidMeasuredRuns: [
                {
                    missingSampleCount: 1,
                    reason: 'renderer-process-metric-missing-during-capture',
                    runId: 'run-02',
                    validSampleCount: 2,
                },
            ],
            measuredRunCount: 2,
            validForBenchmark: false,
            validForComparison: false,
            validMeasuredRunCount: 1,
        }
    );
});

test('benchmark preserves raw artifacts before rejecting incomplete renderer RSS', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const summaryWrite = source.indexOf(
        "writeJson(join(config.outputDirectory, 'summary.json'), summary)"
    );
    const validityGuard = source.indexOf(
        'summary.validity.rendererRss.validForBenchmark'
    );

    assert.ok(summaryWrite >= 0, 'summary artifact write must exist');
    assert.ok(validityGuard >= 0, 'renderer RSS validity guard must exist');
    assert.ok(
        summaryWrite < validityGuard,
        'raw summary must be durable before the renderer RSS guard fails'
    );
    assert.match(source, /Renderer RSS capture is invalid/);
});
