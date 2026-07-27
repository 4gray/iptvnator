import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
} from './xtream-benchmark-contract';
import { iteration as createIteration } from './xtream-benchmark-report.fixtures';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import type { XtreamRawIterationResult } from './xtream-summary-contract';

describe('Xtream iteration semantic evidence', () => {
    it('labels only the selected IPC proxy boundary', () => {
        const raw = iteration();

        assert.equal(
            raw.phases.structuredCloneAttribution,
            'selected-ipc-proxy-includes-queueing-and-scheduling'
        );
        assert.equal(
            raw.phases.indexesReason,
            'schema-indexes-pre-exist; operation-creates-none'
        );
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    phases: {
                        ...raw.phases,
                        structuredCloneAttribution:
                            'proxy-includes-queueing-and-scheduling',
                    },
                }),
            /invalid Xtream iteration/
        );
    });

    it('preserves Electron main ELU as an explicit unavailable pair', () => {
        const raw = iteration();

        assert.equal(raw.main.eventLoopUtilization, null);
        assert.equal(
            raw.main.eventLoopUtilizationUnavailableReason,
            'electron-main-embedded-event-loop'
        );
        for (const main of [
            {
                ...raw.main,
                eventLoopUtilization: 0,
                eventLoopUtilizationUnavailableReason: null,
            },
            {
                ...raw.main,
                eventLoopUtilizationUnavailableReason: null,
            },
        ]) {
            assert.throws(
                () => assertXtreamIterationResult({ ...raw, main }),
                /invalid Xtream iteration/
            );
        }
    });

    it('requires physically possible process memory, phase bounds, and long-task pairs', () => {
        const raw = iteration();
        const invalid = [
            {
                ...raw,
                renderer: { ...raw.renderer, peakHeapUsedBytes: 0 },
            },
            {
                ...raw,
                renderer: {
                    ...raw.renderer,
                    postGcHeapUsedBytes: raw.renderer.peakHeapUsedBytes + 1,
                },
            },
            {
                ...raw,
                main: { ...raw.main, peakRssBytes: 0 },
            },
            {
                ...raw,
                main: {
                    ...raw.main,
                    peakHeapUsedBytes: raw.main.peakRssBytes + 1,
                },
            },
            {
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    peakHeapUsedBytes: 0,
                },
            },
            {
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    postGcHeapUsedBytes:
                        raw.databaseWorker.peakHeapUsedBytes + 1,
                },
            },
            {
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    ordinal: 0,
                },
            },
            {
                ...raw,
                phases: {
                    ...raw.phases,
                    storeUpdateMs: raw.phases.totalMs + 1,
                },
            },
            {
                ...raw,
                renderer: {
                    ...raw.renderer,
                    longTaskCount: 0,
                    longTaskMaxMs: 75,
                },
            },
            {
                ...raw,
                renderer: {
                    ...raw.renderer,
                    longTaskCount: 2,
                    longTaskMaxMs: 0,
                },
            },
        ];

        for (const candidate of invalid) {
            assert.throws(
                () =>
                    assertXtreamIterationResult(
                        candidate as XtreamRawIterationResult
                    ),
                /invalid Xtream iteration/
            );
        }
    });

    it('requires positive safe diagnostic CPU-profile durations', () => {
        const diagnostic = iteration({
            ...definition(),
            eligibleForComparison: false,
            kind: XTREAM_ITERATION_KIND.DIAGNOSTIC,
            runId: 'diagnostic',
        });
        const mutate = (
            process: 'databaseWorker' | 'main' | 'renderer',
            cpuProfileDurationMicros: number
        ): XtreamRawIterationResult => ({
            ...diagnostic,
            [process]: {
                ...diagnostic[process],
                cpuProfileDurationMicros,
            },
        });

        for (const process of ['databaseWorker', 'main', 'renderer'] as const) {
            for (const duration of [0, 1.5]) {
                assert.throws(
                    () =>
                        assertXtreamIterationResult(mutate(process, duration)),
                    /invalid Xtream iteration/
                );
            }
        }
    });

    it('requires distinct worker request and producer preload identities', () => {
        const raw = iteration();
        const evidence = raw.databaseWorker.requests.evidence;
        const first = evidence[0];
        const second = evidence[1];
        const correlated = evidence.filter(
            ({ operation }) => operation === 'DB_GET_CATEGORIES'
        );
        const operationIdentities = evidence.filter(
            ({ operation }) => operation === 'DB_SAVE_CONTENT'
        );
        const firstCorrelated = correlated[0];
        const secondCorrelated = correlated[1];
        const firstOperation = operationIdentities[0];
        const secondOperation = operationIdentities[1];
        assert.ok(first?.requestId);
        assert.ok(second);
        assert.ok(firstCorrelated?.ipcCallId !== null);
        assert.ok(secondCorrelated);
        assert.ok(firstOperation?.operationId);
        assert.ok(secondOperation);

        const duplicateRequestId = evidence.map((request, index) =>
            index === 1
                ? {
                      ...request,
                      requestId: first.requestId,
                      phaseEvents: request.phaseEvents.map((event) => ({
                          ...event,
                          requestId: first.requestId,
                      })),
                  }
                : request
        );
        const duplicateIpcCallId = evidence.map((request) =>
            request === secondCorrelated
                ? {
                      ...request,
                      ipcCallId: firstCorrelated.ipcCallId,
                      sourceEpochMs: firstCorrelated.sourceEpochMs,
                  }
                : request
        );
        const duplicateOperationId = evidence.map((request) =>
            request === secondOperation
                ? {
                      ...request,
                      operationId: firstOperation.operationId,
                      operationIdUnavailableReason: null,
                  }
                : request
        );
        const zeroSourceEpoch = evidence.map((request) =>
            request === firstCorrelated
                ? { ...request, sourceEpochMs: 0 }
                : request
        );
        const missingProducerIdentity = evidence.map((request) =>
            request === firstCorrelated
                ? {
                      ...request,
                      ipcCallId: null,
                      operationIdUnavailableReason:
                          'preload-performance-marker-not-applicable',
                      sourceEpochMs: null,
                  }
                : request
        );

        for (const candidate of [
            duplicateRequestId,
            duplicateIpcCallId,
            duplicateOperationId,
            zeroSourceEpoch,
            missingProducerIdentity,
        ]) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        databaseWorker: {
                            ...raw.databaseWorker,
                            requests: {
                                ...raw.databaseWorker.requests,
                                evidence: candidate,
                            },
                        },
                    }),
                /invalid Xtream iteration/
            );
        }
    });

    it('requires exact per-request operation, outcome, phase, and accounting evidence', () => {
        const raw = iteration();
        const evidence = raw.databaseWorker.requests.evidence;
        assert.ok(evidence.length > 1);

        const mutations = [
            {
                ...raw.databaseWorker.requests,
                totalCount: 1,
                validSampleCount: 1,
            },
            {
                ...raw.databaseWorker.requests,
                evidence: evidence.slice(1),
                totalCount: evidence.length - 1,
                validSampleCount: evidence.length - 1,
            },
            {
                ...raw.databaseWorker.requests,
                evidence: evidence.map((request, index) =>
                    index === 0
                        ? { ...request, operation: 'DB_GET_CONTENT' }
                        : request
                ),
            },
            {
                ...raw.databaseWorker.requests,
                evidence: evidence.map((request, index) =>
                    index === 0 ? { ...request, success: false } : request
                ),
            },
            {
                ...raw.databaseWorker.requests,
                evidence: evidence.map((request, index) =>
                    index === 0 ? { ...request, phaseEvents: [] } : request
                ),
            },
        ];

        for (const requests of mutations) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        databaseWorker: {
                            ...raw.databaseWorker,
                            requests,
                        },
                    } as XtreamRawIterationResult),
                /invalid Xtream iteration/
            );
        }
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
