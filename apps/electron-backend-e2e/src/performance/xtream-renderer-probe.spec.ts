import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';

interface ProbeModule {
    XTREAM_RENDERER_STATE_KEY?: string;
    assertCompleteXtreamRendererProbe?: (value: unknown) => void;
    assertXtreamBackgroundDeleteActive?: (page: unknown) => Promise<void>;
    assertXtreamBackgroundRefreshActive?: (
        page: unknown,
        identity: {
            readonly operationId: string;
            readonly playlistId: string;
        }
    ) => Promise<void>;
    beginXtreamRendererOperation?: (page: unknown) => Promise<number>;
    installXtreamRendererProbe?: (
        page: unknown,
        options: {
            readonly scenarioId: string;
            readonly sourceTitle: string;
        }
    ) => Promise<void>;
    recordXtreamRendererHeartbeat?: (
        page: unknown,
        deadlineEpochMs: number
    ) => Promise<void>;
    stopXtreamRendererProbe?: (page: unknown) => Promise<unknown>;
    waitForXtreamRendererTerminal?: (page: unknown) => Promise<void>;
}

const probeUrl = new URL('./xtream-renderer-probe.ts', import.meta.url);
const modulePromise = import(probeUrl.href)
    .then((module) => module as unknown as ProbeModule)
    .catch(() => null);

test('exports the fail-closed Xtream renderer probe lifecycle', async () => {
    const module = await modulePromise;

    assert.ok(module, 'Xtream renderer probe module must exist');
    assert.equal(typeof module.XTREAM_RENDERER_STATE_KEY, 'string');
    assert.equal(typeof module.installXtreamRendererProbe, 'function');
    assert.equal(typeof module.beginXtreamRendererOperation, 'function');
    assert.equal(typeof module.recordXtreamRendererHeartbeat, 'function');
    assert.equal(typeof module.waitForXtreamRendererTerminal, 'function');
    assert.equal(typeof module.stopXtreamRendererProbe, 'function');
    assert.equal(typeof module.assertCompleteXtreamRendererProbe, 'function');
    assert.equal(typeof module.assertXtreamBackgroundDeleteActive, 'function');
    assert.equal(typeof module.assertXtreamBackgroundRefreshActive, 'function');
});

test('passively correlates the driver-owned cancel click with live DB progress', () => {
    const source = readFileSync(probeUrl, 'utf8');

    assert.match(source, /RENDERER_PERFORMANCE_PHASE_HOOK_KEY/);
    assert.match(source, /onDbOperationEvent/);
    assert.doesNotMatch(source, /event\.error/);
    assert.match(source, /Math\.max\(\s*100,[\s\S]*Math\.floor/);
    assert.match(source, /workspace-loading-overlay__action/);
    assert.match(source, /addEventListener\('click'/);
    assert.doesNotMatch(source, /\.click\(\)/);
    assert.match(source, /Math\.min\(/);
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /longtask/);
});

test('requires a final store marker, DOM gate, and two rendered frames', () => {
    const source = readFileSync(probeUrl, 'utf8');

    assert.match(source, /store\.xtream-import-terminal/);
    assert.match(source, /routeHydratesAfterImport/);
    assert.match(source, /requiredStoreTerminalCount/);
    assert.match(source, /routeHydratesAfterImport\s*\?\s*2\s*:\s*1/);
    assert.match(source, /store\.xtream-delete-row/);
    assert.match(source, /workspace-loading-overlay/);
    assert.match(source, /xtream-content-gate/);
    assert.match(source, /catalog/);
    assert.match(source, /paintFrameCount/);
    assert.match(source, />=\s*2/);
});

test('rejects incomplete and internally inconsistent terminal evidence', async () => {
    const module = await modulePromise;
    assert.ok(module?.assertCompleteXtreamRendererProbe);
    const valid = completeProbe();

    assert.doesNotThrow(() =>
        module.assertCompleteXtreamRendererProbe?.(valid)
    );
    assert.throws(
        () =>
            module.assertCompleteXtreamRendererProbe?.({
                ...valid,
                terminalEpochMs: null,
            }),
        /xtream-renderer-probe-incomplete/
    );
    assert.throws(
        () =>
            module.assertCompleteXtreamRendererProbe?.({
                ...valid,
                uiPaintedEpochMs: 90,
            }),
        /xtream-renderer-probe-incomplete/
    );
});

test('keeps a completed delete inside the identified refresh lifecycle until store terminal', async () => {
    const module = await modulePromise;
    assert.ok(module?.assertXtreamBackgroundRefreshActive);
    assert.ok(module.XTREAM_RENDERER_STATE_KEY);
    const stateKey = module.XTREAM_RENDERER_STATE_KEY;
    const target = globalThis as unknown as Record<string, unknown>;
    const identity = {
        operationId: 'delete-operation-1',
        playlistId: 'playlist-1',
    };
    const page = {
        evaluate: async (
            callback: (argument: unknown) => unknown,
            argument: unknown
        ) => callback(argument),
    };
    target[stateKey] = backgroundRefreshState(identity);
    try {
        await assert.doesNotReject(() =>
            module.assertXtreamBackgroundRefreshActive?.(page, identity)
        );
        target[stateKey] = {
            ...backgroundRefreshState(identity),
            storeTerminalEpochMs: 200,
        };
        await assert.rejects(
            () =>
                module.assertXtreamBackgroundRefreshActive?.(page, identity) ??
                Promise.resolve(),
            /xtream-background-refresh-not-active/
        );
        target[stateKey] = backgroundRefreshState({
            ...identity,
            operationId: 'different-operation',
        });
        await assert.rejects(
            () =>
                module.assertXtreamBackgroundRefreshActive?.(page, identity) ??
                Promise.resolve(),
            /xtream-background-refresh-not-active/
        );
    } finally {
        delete target[stateKey];
    }
});

function completeProbe(): Record<string, unknown> {
    return {
        cancellationClickEpochMs: null,
        cancelEligibleProgressEpochMs: null,
        dbCancellationTerminalEpochMs: null,
        dbOperationEvents: [],
        domReadyEpochMs: 150,
        frameGapsMs: [16],
        heartbeatDelaysMs: [2],
        invalidReason: null,
        longTasksMs: [],
        operationStartEpochMs: 100,
        performancePhaseEvents: [
            {
                boundary: 'end',
                epochMs: 140,
                monotonicMs: 40,
                outcome: 'success',
                phase: 'store.xtream-import-terminal',
                phaseId: 'terminal-1',
                schemaVersion: 1,
            },
        ],
        routeReadyEpochMs: 120,
        scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
        storeTerminalEpochMs: 140,
        terminalEpochMs: 160,
        uiPaintedEpochMs: 160,
    };
}

function backgroundRefreshState(identity: {
    readonly operationId: string;
    readonly playlistId: string;
}): Record<string, unknown> {
    return {
        dbOperationEvents: [
            {
                operation: 'delete-xtream-content',
                ...identity,
                status: 'started',
            },
            {
                operation: 'delete-xtream-content',
                ...identity,
                status: 'completed',
            },
        ],
        invalidReason: null,
        operationStartEpochMs: 100,
        scenarioId: XTREAM_SCENARIO_ID.BACKGROUND_UI,
        storeTerminalEpochMs: null,
        terminalEpochMs: null,
    };
}
