import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { createXtreamAssemblerFixture } from './xtream-iteration-assembler.fixture';
import { assembleXtreamRawIteration } from './xtream-iteration-assembler';
import { assertXtreamIterationResult } from './xtream-iteration-validity';

describe('Xtream raw iteration assembler', () => {
    for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
        it(`assembles measured ${scenarioId} evidence without inventing fields`, () => {
            const input = createXtreamAssemblerFixture(
                scenarioId as XtreamScenarioId
            );

            const result = assembleXtreamRawIteration(input);

            assert.doesNotThrow(() => assertXtreamIterationResult(result));
            assert.equal(
                result.processIdentity.captureGeneration,
                input.mainCapture.captureGeneration
            );
            assert.equal(
                result.databaseWorker.requests.evidence.length,
                input.mainCapture.requests.length
            );
            assert.equal(result.validity.databaseWorkerCount, 1);
            assert.equal(result.validity.playlistWorkerCount, 0);
            assert.equal(result.main.cpuMetricScope, 'electron-main-thread');
            assert.equal(
                result.databaseWorker.cpuMetricScope,
                'sum-valid-request-thread-cpu'
            );
            assert.equal(
                result.databaseWorker.cpuUserMicros,
                result.databaseWorker.requests.evidence.reduce(
                    (total, request) =>
                        total +
                        (request.invalidReason === null
                            ? Number(request.threadCpuUserMicros)
                            : 0),
                    0
                )
            );
            assert.equal(
                result.cancellationEvidence === null,
                scenarioId !== XTREAM_SCENARIO_ID.CANCEL_IMPORT
            );
        });
    }

    it('fails closed on capture invalidation instead of manufacturing a valid result', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    mainCapture: {
                        ...input.mainCapture,
                        invalidReasons: {
                            ...input.mainCapture.invalidReasons,
                            capture: ['database-worker-activity-after-cutoff'],
                        },
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });

    it('accepts a coarse trigger clock from the same millisecond as renderer start', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const operationStartEpochMs =
            input.rendererCapture.probe.operationStartEpochMs + 0.05;

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                rendererCapture: {
                    ...input.rendererCapture,
                    measurementStartEpochMs: operationStartEpochMs,
                    probe: {
                        ...input.rendererCapture.probe,
                        operationStartEpochMs,
                    },
                },
                trigger: {
                    ...input.trigger,
                    triggerEpochMs: Math.floor(operationStartEpochMs),
                },
            })
        );
    });

    it('rejects a coarse trigger clock from the millisecond before renderer start', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const operationStartEpochMs =
            input.rendererCapture.probe.operationStartEpochMs + 0.05;

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    rendererCapture: {
                        ...input.rendererCapture,
                        probe: {
                            ...input.rendererCapture.probe,
                            operationStartEpochMs,
                        },
                    },
                    trigger: {
                        ...input.trigger,
                        triggerEpochMs: Math.floor(operationStartEpochMs) - 1,
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });

    it('accepts a late delete driver observation after renderer and main capture cutoffs', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.DELETE_LARGE
        );

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                terminal: {
                    ...input.terminal,
                    terminalEpochMs:
                        input.mainCapture.captureCutoffEpochMs + 100,
                },
            })
        );
    });

    it('accepts renderer cancellation delivery after the authoritative database response', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.CANCEL_IMPORT
        );
        const authoritativeTerminalEpochMs = input.mainCapture.requests.find(
            ({ operation, success }) =>
                operation === 'DB_SAVE_CONTENT' && !success
        )?.responseEpochMs;
        assert.equal(typeof authoritativeTerminalEpochMs, 'number');
        const dbCancellationTerminalEpochMs =
            Number(authoritativeTerminalEpochMs) + 0.25;
        assert.ok(
            dbCancellationTerminalEpochMs <
                Number(input.rendererCapture.probe.uiPaintedEpochMs)
        );

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                rendererCapture: {
                    ...input.rendererCapture,
                    probe: {
                        ...input.rendererCapture.probe,
                        dbCancellationTerminalEpochMs,
                    },
                },
            })
        );
    });

    it('accepts sub-millisecond skew between renderer and main cancellation clocks', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.CANCEL_IMPORT
        );
        const workerTerminal = input.mainCapture.cancelTimeline.find(
            ({ type }) => type === 'db-cancel-terminal-received'
        );
        assert.ok(workerTerminal);
        const rendererTerminalEpochMs = workerTerminal.epochMs - 0.1;
        assert.ok(
            rendererTerminalEpochMs >
                Number(input.rendererCapture.probe.cancellationClickEpochMs)
        );

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                rendererCapture: {
                    ...input.rendererCapture,
                    probe: {
                        ...input.rendererCapture.probe,
                        dbCancellationTerminalEpochMs: rendererTerminalEpochMs,
                    },
                },
            })
        );
    });

    it('rejects a cancellation terminal that substantially predates the main receipt', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.CANCEL_IMPORT
        );
        const workerTerminal = input.mainCapture.cancelTimeline.find(
            ({ type }) => type === 'db-cancel-terminal-received'
        );
        assert.ok(workerTerminal);

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    rendererCapture: {
                        ...input.rendererCapture,
                        probe: {
                            ...input.rendererCapture.probe,
                            dbCancellationTerminalEpochMs:
                                workerTerminal.epochMs - 2,
                        },
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });

    it('accepts main observing a network cancel response after the next renderer IPC starts', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.CANCEL_IMPORT
        );
        const databaseCancelStart = input.mainCapture.ipcTimeline.find(
            ({ boundary, method }) =>
                boundary === 'start' && method === 'dbCancelOperation'
        );
        assert.ok(databaseCancelStart);
        assert.equal(typeof databaseCancelStart.sourceEpochMs, 'number');
        const rendererHandoffEpochMs = Number(
            databaseCancelStart.sourceEpochMs
        );
        const delayedMainObservationEpochMs = rendererHandoffEpochMs + 0.1;
        assert.ok(delayedMainObservationEpochMs < databaseCancelStart.epochMs);

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                mainCapture: {
                    ...input.mainCapture,
                    ipcTimeline: input.mainCapture.ipcTimeline.map((record) =>
                        record.boundary === 'end' &&
                        record.method === 'xtreamCancelSession'
                            ? {
                                  ...record,
                                  epochMs: delayedMainObservationEpochMs,
                                  sourceEpochMs: rendererHandoffEpochMs,
                              }
                            : record
                    ),
                },
            })
        );
    });

    it('accepts the non-authoritative cancel IPC returning after the database acknowledgement', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.CANCEL_IMPORT
        );
        const authoritativeTerminalEpochMs = input.mainCapture.requests.find(
            ({ operation, success }) =>
                operation === 'DB_SAVE_CONTENT' && !success
        )?.responseEpochMs;
        assert.equal(typeof authoritativeTerminalEpochMs, 'number');
        const responseSourceEpochMs =
            Number(authoritativeTerminalEpochMs) + 0.1;
        const responseObservedEpochMs = responseSourceEpochMs + 0.1;
        assert.ok(
            responseObservedEpochMs <
                Number(input.rendererCapture.probe.uiPaintedEpochMs)
        );

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                mainCapture: {
                    ...input.mainCapture,
                    ipcTimeline: input.mainCapture.ipcTimeline
                        .map((record) =>
                            record.boundary === 'end' &&
                            record.method === 'dbCancelOperation'
                                ? {
                                      ...record,
                                      epochMs: responseObservedEpochMs,
                                      sourceEpochMs: responseSourceEpochMs,
                                  }
                                : record
                        )
                        .sort((left, right) => left.epochMs - right.epochMs),
                },
            })
        );
    });

    it('binds store-to-paint duration to the renderer terminal and paint epochs', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.CANCEL_IMPORT
        );

        assert.doesNotThrow(() => assembleXtreamRawIteration(input));
        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    rendererCapture: {
                        ...input.rendererCapture,
                        storeToPaintMs:
                            input.rendererCapture.storeToPaintMs + 0.1,
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });

    it('includes trailing delete database and IPC evidence after the visible paint', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.DELETE_LARGE
        );
        const rendererTerminalEpochMs =
            input.rendererCapture.probe.uiPaintedEpochMs;

        const result = assembleXtreamRawIteration({
            ...input,
            rendererCapture: {
                ...input.rendererCapture,
                probe: {
                    ...input.rendererCapture.probe,
                    terminalEpochMs: rendererTerminalEpochMs,
                },
            },
        });

        assert.ok(
            result.phaseCapture.terminalEpochMs > rendererTerminalEpochMs
        );
        assert.equal(
            result.phases.totalMs,
            result.phaseCapture.terminalEpochMs -
                result.phaseCapture.operationStartEpochMs
        );
    });

    it('binds diagnostic durations and worker ordinal only from validated artifact evidence', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    definition: {
                        ...input.definition,
                        eligibleForComparison: false,
                        kind: 'diagnostic',
                        runId: 'diagnostic',
                    },
                    diagnosticArtifacts: {
                        artifacts: [],
                        directorySha256: '0'.repeat(64),
                        profiles: {
                            databaseWorker: {
                                durationMicros: 1,
                                ordinal: 1,
                            },
                            main: { durationMicros: 1 },
                            renderer: { durationMicros: 1 },
                        },
                    } as never,
                }),
            /xtream-iteration-assembly-invalid/
        );
    });
});
