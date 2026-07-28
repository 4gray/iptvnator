import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    expectedXtreamWorkerRequestInventory,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';
import {
    assertXtreamSettlementAfterTerminal,
    finalizeXtreamCaptureAfterRendererTerminal,
} from './xtream-benchmark-iteration-support';
import type { XtreamMainCaptureStatus } from './m3u-refresh-main-capture';

describe('Xtream terminal settlement ordering', () => {
    it('reads main status exactly once and only after terminal evidence resolves', async () => {
        const terminal = deferred<void>();
        let readCount = 0;
        const settlement = assertXtreamSettlementAfterTerminal({
            captureGeneration: 2,
            readStatus: async () => {
                readCount += 1;
                return settledStatus();
            },
            scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            terminal: terminal.promise,
        });

        assert.equal(readCount, 0);
        terminal.resolve();
        await settlement;
        assert.equal(readCount, 1);
    });

    it('fails closed on pending terminal status without polling again', async () => {
        let readCount = 0;
        const status = settledStatus();
        const first = status.operationOutcomes[0];
        assert.ok(first);

        await assert.rejects(
            assertXtreamSettlementAfterTerminal({
                captureGeneration: 2,
                readStatus: async () => {
                    readCount += 1;
                    return {
                        ...status,
                        activeOperations: [
                            {
                                operation: first.operation,
                                operationId: 'operation-1',
                                playlistId: 'playlist-1',
                                progress: null,
                                requestId: 'request-1',
                            },
                        ],
                    };
                },
                scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                terminal: Promise.resolve(),
            }),
            /xtream-main-not-settled-after-terminal/
        );
        assert.equal(readCount, 1);
    });

    it('rejects a changed capture generation after terminal evidence', async () => {
        await assert.rejects(
            assertXtreamSettlementAfterTerminal({
                captureGeneration: 3,
                readStatus: async () => settledStatus(),
                scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
                terminal: Promise.resolve(),
            }),
            /xtream-measured-capture-generation-changed/
        );
    });

    it('freezes both captures after renderer settlement without waiting for late driver evidence', async () => {
        const rendererTerminal = deferred<void>();
        const driverTerminal = deferred<{ terminalEpochMs: number }>();
        const calls: string[] = [];
        const finalization = finalizeXtreamCaptureAfterRendererTerminal({
            captureGeneration: 2,
            driverTerminal: driverTerminal.promise,
            readStatus: async () => {
                calls.push('status');
                return settledStatus();
            },
            rendererTerminal: rendererTerminal.promise,
            scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            stopMain: async () => {
                calls.push('stop-main');
                return 'main';
            },
            stopRenderer: async () => {
                calls.push('stop-renderer');
                return 'renderer';
            },
        });

        await Promise.resolve();
        assert.deepEqual(calls, []);

        rendererTerminal.resolve();
        await waitFor(() => calls.includes('stop-main'));
        assert.deepEqual(calls, ['status', 'stop-renderer', 'stop-main']);

        let completed = false;
        void finalization.then(() => {
            completed = true;
        });
        await Promise.resolve();
        assert.equal(completed, false);

        driverTerminal.resolve({ terminalEpochMs: 2_000 });
        assert.deepEqual(await finalization, {
            driverTerminal: { terminalEpochMs: 2_000 },
            mainCapture: 'main',
            rendererCapture: 'renderer',
        });
    });
});

function settledStatus(): XtreamMainCaptureStatus {
    return {
        active: true,
        activeOperations: [],
        captureGeneration: 2,
        captureStartedEpochMs: 1_000,
        cutoffPhase: 'active',
        databaseWorkerCount: 1,
        invalidReasons: [],
        lateDatabaseRequestCount: 0,
        lateEventCount: 0,
        measurementPhase: 'measuring',
        measurementStartedEpochMs: 1_001,
        operationOutcomes: expectedXtreamWorkerRequestInventory(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        ).map(({ count, operation, success }) => ({
            count,
            operation,
            outcome: success ? 'success' : 'error',
        })),
        playlistRefreshWorkerCount: 0,
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve(value: T): void;
} {
    let resolvePromise: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: resolvePromise,
    };
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 10 && !predicate(); attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(predicate(), true);
}
