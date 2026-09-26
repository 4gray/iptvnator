import assert from 'node:assert/strict';
import test from 'node:test';

import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import type { JourneyRendererProbeState } from './journey-renderer-probe';
import {
    LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS,
    toLaunchIterationRecord,
    type LaunchJourneyMeasurement,
} from './launch-journey-record';

function measurement(
    overrides: Partial<LaunchJourneyMeasurement> = {}
): LaunchJourneyMeasurement {
    const renderer: JourneyRendererProbeState = {
        capabilities: {
            changeDetectionTicks: 'unavailable-ng-global-not-published',
            layoutShift: true,
            longTask: true,
            observedTarget: 'document',
        },
        counters: {
            domMutations: 480,
            layoutShiftScore: 0.123456789,
            longTasks: 2,
        },
        final: true,
        firstCardPaintEpochMs: 2_650,
        installed: {
            bridgePresent: true,
            documentElementPresent: false,
            epochMs: 1_200,
            readyState: 'loading',
            scriptCount: 0,
        },
        invalidReasons: [],
        journey: 'launch',
        longTaskDurationsMs: [71.26, 120.04],
        navigation: {
            domContentLoadedEpochMs: 1_300,
            loadEventEndEpochMs: 1_400.26,
        },
        schemaVersion: 1,
        sentinel: { epochMs: 2_601, status: 'sent' },
        terminal: {
            cardTag: 'div',
            cardTestId: 'dashboard-recent-sources-rail-card',
            epochMs: 2_600.04,
            pathname: '/dist/apps/web/workspace/dashboard',
        },
    };
    const ipc: JourneyMainIpcCaptureState = {
        callsAfterSentinel: 3,
        callsBeforeSentinel: 14,
        callsByMethod: { dbGetAppPlaylists: 1, getSettings: 13 },
        installedEpochMs: 1_100,
        malformedEvents: 0,
        processStartEpochMs: 900,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 2_602 },
    };
    return {
        electronVersion: '43.3.0',
        gate: {
            blankLoadedEpochMs: 1_050,
            errors: [],
            gatedEpochMs: 1_020,
            gatedMethod: 'loadFile',
            passThroughLoads: 0,
            releasedEpochMs: 1_150,
            timedOut: false,
        },
        ipc,
        pid: 4242,
        renderer,
        spawnEpochMs: 1_000,
        ...overrides,
    };
}

test('maps the probe and IPC capture to exact counters and spawn-relative wall-clock', () => {
    const record = toLaunchIterationRecord(2, false, measurement());
    assert.equal(record.index, 2);
    assert.equal(record.warmup, false);
    assert.equal(record.pid, 4242);
    assert.deepEqual(record.counters, {
        'renderer.domMutationsToFirstCard': 480,
        'renderer.ipcCallsToFirstCard': 14,
        'renderer.layoutShiftScore': 0.123,
        'renderer.longTasks': 2,
    });
    assert.deepEqual(record.wallClock, {
        spawnToDidFinishLoadMs: 400.3,
        spawnToFirstCardMs: 1_600,
    });
    assert.deepEqual(record.evidence['ipcCallsByMethod'], {
        dbGetAppPlaylists: 1,
        getSettings: 13,
    });
    assert.deepEqual(record.evidence['longTaskDurationsMs'], [71.3, 120]);
    assert.equal(record.evidence['ipcCallsAfterFirstCard'], 3);
    assert.deepEqual(record.evidence['epochs'], {
        firstCard: 2_600.04,
        firstCardPaint: 2_650,
        loadEventEnd: 1_400.26,
        mainIpcCaptureInstalled: 1_100,
        mainProcessStart: 900,
        rendererGateBlankLoaded: 1_050,
        rendererGateReleased: 1_150,
        rendererProbeInstalled: 1_200,
        spawn: 1_000,
    });
});

test('rejects measurements whose clocks or probes are inconsistent', () => {
    const base = measurement();
    assert.throws(
        () =>
            toLaunchIterationRecord(0, false, {
                ...base,
                renderer: { ...base.renderer, navigation: null },
            }),
        /incomplete-probe/
    );
    assert.throws(
        () =>
            toLaunchIterationRecord(0, false, { ...base, spawnEpochMs: 2_700 }),
        /clock-order/
    );
    assert.throws(
        () =>
            toLaunchIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...base.renderer,
                    capabilities: {
                        ...base.renderer.capabilities,
                        changeDetectionTicks: 'hook-present-not-counted',
                    },
                },
            }),
        /cd-hook-hook-present-not-counted/
    );
});

test('names the counters the harness cannot measure yet', () => {
    assert.deepEqual(Object.keys(LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS).sort(), [
        'main.sqlStatementsBeforeReadyToShow',
        'renderer.cdTicksToFirstCard',
    ]);
});
