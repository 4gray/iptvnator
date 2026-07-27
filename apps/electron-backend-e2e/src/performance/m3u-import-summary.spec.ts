import assert from 'node:assert/strict';
import { it } from 'node:test';

import { PERFORMANCE_ITERATION_KIND } from './m3u-refresh-cancellation-contract';
import {
    createM3uImportBenchmarkSummary,
    createM3uImportIterationResult,
    type M3uImportBenchmarkSummary,
} from './m3u-import-summary';
import { assertM3uImportComparisonValidity } from './m3u-import.benchmark';
import {
    createCompleteTestMainCapture,
    createCompleteTestRendererCapture,
    createTestM3uImportManifest,
    TEST_M3U_CHANNEL_COUNT,
    TEST_M3U_FIXTURE_BYTES,
} from './m3u-import-report.test-helpers';

it('summarizes measured runs only while preserving per-process memory boundaries', () => {
    const warmup = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.WARMUP,
        main: createCompleteTestMainCapture(),
        renderer: createCompleteTestRendererCapture(),
        runId: 'warmup-01',
        scenarioId: 'm3u-import-10k',
    });
    const measured = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.MEASURED,
        main: createCompleteTestMainCapture(),
        renderer: createCompleteTestRendererCapture(),
        runId: 'run-01',
        scenarioId: 'm3u-import-10k',
    });
    const diagnostic = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
        main: createCompleteTestMainCapture({
            mainRss: 9_999,
            rendererRss: 8_888,
        }),
        renderer: createCompleteTestRendererCapture({
            rendererHeap: 7_777,
        }),
        runId: 'diagnostic',
        scenarioId: 'm3u-import-10k',
    });
    const summary = createM3uImportBenchmarkSummary(
        createTestM3uImportManifest(),
        [warmup, measured, diagnostic]
    );

    assert.equal(summary.measured.totalMs.count, 1);
    assert.equal(summary.measured.totalMs.mean, 215);
    assert.equal(summary.measured.ipcStructuredCloneProxyMs.mean, 44);
    assert.equal(summary.measured.mainToDatabaseWorkerCloneProxyMs.mean, 2);
    assert.equal(summary.measured.databaseWorkerToMainCloneProxyMs.mean, 12);
    assert.equal(summary.measured.mainToRendererCloneProxyMs.mean, 28);
    assert.equal(summary.measured.rendererToMainCloneProxyMs.mean, 2);
    assert.equal(summary.measured.sqliteReadMs.mean, 5);
    assert.equal(summary.measured.playlistDeserializationMs.mean, 12);
    assert.equal(summary.measured.databaseWorkerThreadCpuSystemMicros.mean, 100);
    assert.equal(summary.measured.databaseWorkerThreadCpuUserMicros.mean, 120);
    assert.equal(
        summary.measured.databaseWorkerUpsertEventLoopDelayP95Ms.mean,
        4
    );
    assert.equal(
        summary.measured.databaseWorkerGetEventLoopDelayP95Ms.mean,
        7
    );
    assert.equal(summary.measured.mainRssPeakBytes.mean, 5_000);
    assert.equal(summary.measured.mainHeapPeakBytes.mean, 2_000);
    assert.equal(summary.measured.rendererRssPeakBytes.mean, 4_000);
    assert.equal(summary.measured.rendererHeapPeakBytes.mean, 3_000);
    assert.equal(summary.measured.databaseWorkerHeapPeakBytes.mean, 1_500);
    assert.equal(summary.measured.databaseWorkerPostGcHeapBytes.mean, 900);
    assert.equal(summary.measured.rendererLongTaskCount, 1);
    assert.equal(summary.measured.unresponsiveEvents, 0);
    assert.deepEqual(summary.notApplicable, {
        cancelAcknowledgementLatencyMs: 'scenario-has-no-cancellation',
        databaseWorkerRss: 'unavailable-per-worker-thread',
        indexAndCommitMs:
            'indexes-not-created-during-import;sqlite-autocommit-included-in-sqlite-write',
        nativeAndSqliteMemory:
            'included-in-main-rss-not-separately-attributable',
        playlistRefreshWorker: 'not-used-by-initial-import',
    });
    assert.equal(summary.validity.rendererRss.validForComparison, true);
    assert.equal(
        summary.validity.databaseWorkerPeakMemory.validForComparison,
        true
    );
    assert.equal(
        summary.validity.databaseWorkerPostGc.validForComparison,
        true
    );
    assert.doesNotThrow(() => assertM3uImportComparisonValidity(summary));

    const databaseWorker = measured.main.workers[0];
    assert.ok(databaseWorker);
    const invalidMeasured = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.MEASURED,
        main: {
            ...measured.main,
            workers: [
                {
                    ...databaseWorker,
                    externalMemorySampleCount: 0,
                    heapUsedSampleCount: 0,
                    peakExternalBytes: null,
                    peakExternalUnavailableReason:
                        'worker-external-memory-samples-missing',
                    peakHeapUsedBytes: null,
                    peakHeapUsedUnavailableReason:
                        'worker-heap-used-samples-missing',
                },
            ],
        },
        renderer: measured.renderer,
        runId: 'run-01',
        scenarioId: 'm3u-import-10k',
    });
    const invalidPeakSummary = createM3uImportBenchmarkSummary(
        createTestM3uImportManifest(),
        [warmup, invalidMeasured, diagnostic]
    );
    assert.equal(
        invalidPeakSummary.validity.databaseWorkerPeakMemory.validForComparison,
        false
    );
    assert.equal(
        invalidPeakSummary.measured.databaseWorkerHeapPeakBytes.count,
        0
    );
    assert.throws(
        () =>
            assertM3uImportComparisonValidity(
                invalidPeakSummary as M3uImportBenchmarkSummary
            ),
        /Database worker peak-memory capture is invalid/
    );
    assert.throws(
        () =>
            createM3uImportBenchmarkSummary(createTestM3uImportManifest(), [
                measured,
                diagnostic,
            ]),
        /m3u-import-summary-schedule-invalid/
    );
});

it('fails comparison when any measured worker request omits mandatory event-loop or CPU metrics', () => {
    const completeMain = createCompleteTestMainCapture();
    const databaseWorker = completeMain.workers[0];
    const get = databaseWorker?.requests[1];
    assert.ok(databaseWorker);
    assert.ok(get);
    const invalidMain = {
        ...completeMain,
        workers: [
            {
                ...databaseWorker,
                requests: [
                    databaseWorker.requests[0],
                    {
                        ...get,
                        eventLoopDelay: null,
                        eventLoopDelayUnavailableReason:
                            'event-loop-delay-capture-unavailable',
                        histogramFlushedEpochMs: null,
                    },
                ],
            },
        ],
    };
    const warmup = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.WARMUP,
        main: createCompleteTestMainCapture(),
        renderer: createCompleteTestRendererCapture(),
        runId: 'warmup-01',
        scenarioId: 'm3u-import-10k',
    });
    const measured = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.MEASURED,
        main: invalidMain,
        renderer: createCompleteTestRendererCapture(),
        runId: 'run-01',
        scenarioId: 'm3u-import-10k',
    });
    const diagnostic = createM3uImportIterationResult({
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        kind: PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
        main: createCompleteTestMainCapture(),
        renderer: createCompleteTestRendererCapture(),
        runId: 'diagnostic',
        scenarioId: 'm3u-import-10k',
    });
    const summary = createM3uImportBenchmarkSummary(
        createTestM3uImportManifest(),
        [warmup, measured, diagnostic]
    );

    assert.equal(
        summary.validity.databaseWorkerRequestMetrics.validForComparison,
        false
    );
    assert.equal(
        summary.validity.databaseWorkerRequestMetrics.expectedRequestCount,
        2
    );
    assert.equal(
        summary.validity.databaseWorkerRequestMetrics.validRequestCount,
        1
    );
    assert.equal(
        summary.measured.databaseWorkerGetEventLoopDelayP95Ms.count,
        0
    );
    assert.throws(
        () => assertM3uImportComparisonValidity(summary),
        /Database worker request metrics are invalid/
    );
});
