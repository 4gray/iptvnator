import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
} from './xtream-benchmark-contract';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import {
    iteration as createIteration,
    withWorkerRequestOverlap,
} from './xtream-benchmark-report.fixtures';
import {
    XTREAM_WORKER_REQUEST_METRIC_SCOPE,
    XTREAM_WORKER_WHOLE_METRIC_SCOPE,
    type XtreamRawIterationResult,
} from './xtream-summary-contract';

describe('Xtream raw iteration validity', () => {
    it('requires exact finite nonnegative numeric keys for every process and phase', () => {
        const raw = iteration();
        const candidates = [
            {
                ...raw,
                phases: { ...raw.phases, totalMs: '100' },
            },
            {
                ...raw,
                renderer: { ...raw.renderer, peakRssBytes: undefined },
            },
            {
                ...raw,
                main: { ...raw.main, cpuUserMicros: null },
            },
            {
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    peakExternalBytes: Number.NaN,
                },
            },
            {
                ...raw,
                main: { ...raw.main, inventedMetric: 1 },
            },
        ];

        assert.doesNotThrow(() => assertXtreamIterationResult(raw));
        for (const candidate of candidates) {
            assert.throws(
                () =>
                    assertXtreamIterationResult(
                        candidate as unknown as XtreamRawIterationResult
                    ),
                /invalid Xtream iteration/
            );
        }
    });

    it('uses explicit diagnostic-only CPU-profile availability pairs', () => {
        const measured = iteration();
        const diagnostic = iteration({
            ...definition(),
            kind: XTREAM_ITERATION_KIND.DIAGNOSTIC,
            runId: 'diagnostic',
            eligibleForComparison: false,
        });

        assert.doesNotThrow(() => assertXtreamIterationResult(measured));
        assert.doesNotThrow(() => assertXtreamIterationResult(diagnostic));
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...measured,
                    main: {
                        ...measured.main,
                        cpuProfileDurationMicros: 100,
                        cpuProfileUnavailableReason: null,
                    },
                }),
            /invalid Xtream iteration/
        );
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...diagnostic,
                    renderer: {
                        ...diagnostic.renderer,
                        cpuProfileDurationMicros: null,
                        cpuProfileUnavailableReason:
                            'not-captured-outside-diagnostic',
                    },
                }),
            /invalid Xtream iteration/
        );
    });

    it('requires one exact store-to-paint value and a fresh process identity', () => {
        const raw = iteration();

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    renderer: { ...raw.renderer, storeToPaintMs: 12.999 },
                }),
            /invalid Xtream iteration/
        );
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    processIdentity: {
                        ...raw.processIdentity,
                        freshProcess: false,
                    },
                }),
            /invalid Xtream iteration/
        );
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    processIdentity: {
                        ...raw.processIdentity,
                        startupAttemptCount: 2,
                        startupRetryReasons: [],
                    },
                }),
            /invalid Xtream iteration/
        );
        const { processIdentity: _removed, ...missingIdentity } = raw;
        void _removed;
        assert.throws(
            () =>
                assertXtreamIterationResult(
                    missingIdentity as XtreamRawIterationResult
                ),
            /invalid Xtream iteration/
        );
    });

    it('requires every cancel receipt and validates the authoritative timeline', () => {
        const cancel = iteration({
            ...definition(),
            scenarioId: XTREAM_SCENARIO_ID.CANCEL_IMPORT,
        });

        assert.doesNotThrow(() => assertXtreamIterationResult(cancel));
        for (const cancellation of [
            {
                ...cancel.cancellation,
                clickToPreloadReturnMs:
                    Number(cancel.cancellation.clickToPreloadReturnMs) - 0.5,
                preloadReturnEpochMs:
                    Number(cancel.cancellation.preloadReturnEpochMs) - 0.5,
            },
            {
                ...cancel.cancellation,
                clickToPreloadReturnMs:
                    Number(cancel.cancellation.clickToPreloadReturnMs) + 0.5,
                preloadReturnEpochMs:
                    Number(cancel.cancellation.preloadReturnEpochMs) + 0.5,
            },
            { ...cancel.cancellation, workerReceiptLatencyMs: null },
            {
                ...cancel.cancellation,
                workerReceiptEpochMs:
                    Number(cancel.cancellation.databaseDispatchEpochMs) - 0.5,
            },
            {
                ...cancel.cancellation,
                clickToPaintMs:
                    Number(cancel.cancellation.clickToPaintMs) + 0.1,
            },
            {
                ...cancel.cancellation,
                preloadReturnEpochMs:
                    Number(cancel.cancellation.preloadStartEpochMs) - 0.1,
            },
            {
                ...cancel.cancellation,
                clickToPreloadReturnMs:
                    Number(cancel.cancellation.clickToPreloadReturnMs) + 1,
                preloadReturnEpochMs:
                    Number(cancel.cancellation.preloadReturnEpochMs) + 1,
            },
        ]) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...cancel,
                        cancellation,
                    }),
                /invalid Xtream iteration|authoritative database cancellation/
            );
        }
    });

    it('requires all non-cancel timeline values to be exact nulls', () => {
        const raw = iteration();

        for (const cancellation of [
            { ...raw.cancellation, clickEpochMs: 100 },
            {
                ...raw.cancellation,
                failedDatabaseRequestId: 'unexpected-request',
            },
            {
                ...raw.cancellation,
                failedOperationId: 'unexpected-operation',
            },
        ]) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        cancellation,
                    }),
                /invalid Xtream iteration/
            );
        }
    });

    it('keeps the interactive background refresh visible without an overlay', () => {
        const background = iteration({
            ...definition(),
            scenarioId: XTREAM_SCENARIO_ID.BACKGROUND_UI,
        });

        assert.equal(
            background.renderer.dashboardPaintVisibility,
            'visible-without-overlay'
        );
        assert.doesNotThrow(() => assertXtreamIterationResult(background));
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...background,
                    renderer: {
                        ...background.renderer,
                        dashboardPaintVisibility: 'occluded-by-overlay',
                    },
                } as unknown as XtreamRawIterationResult),
            /invalid Xtream iteration/
        );
    });

    it('accounts for scheduler-dependent overlap without filtering samples', () => {
        for (const scenarioId of [
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            XTREAM_SCENARIO_ID.REFRESH_LARGE,
            XTREAM_SCENARIO_ID.CANCEL_IMPORT,
            XTREAM_SCENARIO_ID.BACKGROUND_UI,
        ]) {
            const overlapped = withWorkerRequestOverlap(
                iteration({ ...definition(), scenarioId }),
                2
            );
            assert.doesNotThrow(() => assertXtreamIterationResult(overlapped));
        }

        const overlapped = withWorkerRequestOverlap(iteration(), 2);
        for (const requests of [
            {
                ...overlapped.databaseWorker.requests,
                invalidReasons: [{ count: 2, reason: 'missing-event-loop' }],
            },
            {
                ...overlapped.databaseWorker.requests,
                invalidReasons: [
                    {
                        count: 1,
                        reason: 'overlapping-database-worker-requests',
                    },
                ],
            },
            {
                ...overlapped.databaseWorker.requests,
                eventLoopDelayP95Ms: null,
            },
            {
                ...overlapped.databaseWorker.requests,
                metricScope: 'whole-worker-operation',
            },
        ]) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...overlapped,
                        databaseWorker: {
                            ...overlapped.databaseWorker,
                            requests,
                        },
                    } as unknown as XtreamRawIterationResult),
                /invalid Xtream iteration/
            );
        }
        const deletion = withWorkerRequestOverlap(
            iteration({
                ...definition(),
                scenarioId: XTREAM_SCENARIO_ID.DELETE_LARGE,
            }),
            1
        );
        assert.throws(
            () => assertXtreamIterationResult(deletion),
            /invalid Xtream iteration/
        );
    });

    it('derives request-window headline delay without relabelling whole-worker ELU', () => {
        const raw = iteration();
        assert.equal(
            raw.databaseWorker.eventLoopDelayMetricScope,
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY
        );
        assert.equal(
            raw.databaseWorker.requests.metricScope,
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY
        );
        assert.equal(
            raw.databaseWorker.wholeWorkerMetricScope,
            XTREAM_WORKER_WHOLE_METRIC_SCOPE.OPERATION_WINDOW
        );
        assert.notEqual(
            raw.databaseWorker.eventLoopUtilization,
            raw.databaseWorker.requests.eventLoopUtilization
        );
        assert.doesNotThrow(() => assertXtreamIterationResult(raw));
        const arbitraryRequestProxy = {
            eventLoopDelayMaxMs: 4,
            eventLoopDelayP95Ms: 1,
            eventLoopDelayP99Ms: 2,
            eventLoopUtilization: 0.9,
        };
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    databaseWorker: {
                        ...raw.databaseWorker,
                        ...arbitraryRequestProxy,
                        eventLoopUtilization:
                            raw.databaseWorker.eventLoopUtilization,
                        requests: {
                            ...raw.databaseWorker.requests,
                            ...arbitraryRequestProxy,
                        },
                    },
                }),
            /invalid Xtream iteration/
        );
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    databaseWorker: {
                        ...raw.databaseWorker,
                        requests: {
                            ...raw.databaseWorker.requests,
                            eventLoopDelayP95Ms: 2.5,
                        },
                    },
                }),
            /invalid Xtream iteration/
        );
    });
});

function definition(): XtreamIterationDefinition {
    return {
        eligibleForComparison: true,
        kind: XTREAM_ITERATION_KIND.MEASURED,
        runId: 'run-01',
        scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
    };
}

function iteration(
    input: XtreamIterationDefinition = definition()
): XtreamRawIterationResult {
    return createIteration(input, 1);
}
