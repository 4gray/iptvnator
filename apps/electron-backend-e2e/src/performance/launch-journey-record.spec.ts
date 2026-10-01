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
            changeDetectionTicks: 'counted',
            layoutShift: true,
            longTask: true,
            observedTarget: 'document',
        },
        counters: {
            changeDetectionTicks: 23,
            domMutations: 480,
            layoutShiftScore: 0.123456789,
            layoutShiftScoreSettled: 0.2304999,
            longTasks: 2,
            recentInputLayoutShiftScore: 0,
        },
        final: true,
        firstCardPaintEpochMs: 2_650,
        idle: {
            domMutations: 12,
            endEpochMs: 33_200.04,
            startEpochMs: 3_200,
            status: 'done',
            ticks: 31,
        },
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
        media: null,
        navigation: {
            domContentLoadedEpochMs: 1_300,
            loadEventEndEpochMs: 1_400.26,
        },
        preStart: { domMutations: 0, lastMutationEpochMs: null },
        schemaVersion: 1,
        sentinel: { epochMs: 2_601, status: 'sent' },
        settle: {
            domMutations: 37,
            epochMs: 3_180.06,
            lastMutationEpochMs: 2_680,
            lateShifts: [
                {
                    afterFirstCardMs: 14.96,
                    sources: [
                        {
                            deltaHeight: 0,
                            deltaY: -240,
                            node: 'section.dashboard-rail',
                        },
                    ],
                    value: 0.23049,
                },
            ],
            observedTarget: 'root',
            status: 'quiet',
        },
        start: null,
        terminal: {
            cardCount: 2,
            cardTag: 'div',
            cardTestId: 'dashboard-recent-sources-rail-card',
            companionCounts: [],
            epochMs: 2_600.04,
            pathname: '/dist/apps/web/workspace/dashboard',
        },
    };
    const ipc: JourneyMainIpcCaptureState = {
        ambiguousTimelineCompletions: 0,
        callsAfterSentinel: 3,
        callsBeforeStart: 0,
        callsBeforeSentinel: 14,
        callsByMethod: { dbGetAppPlaylists: 1, getSettings: 13 },
        inFlightByMethod: {},
        installedEpochMs: 1_100,
        malformedEvents: 0,
        processStartEpochMs: 900,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 2_602 },
        start: null,
        timeline: [
            { method: 'getSettings', phase: 'start' },
            { method: 'getSettings', phase: 'end' },
            { method: 'dbGetAppPlaylists', phase: 'start' },
            { method: 'getSettings', phase: 'start' },
            { method: 'dbGetAppPlaylists', phase: 'end' },
        ],
        unmatchedCompletions: 0,
    };
    return {
        electronVersion: '43.3.0',
        gate: {
            blankLoadedEpochMs: 1_050,
            errors: [],
            gatedEpochMs: 1_020,
            gatedMethod: 'loadFile',
            passThroughLoads: 0,
            readyToShowHeldOnBlank: 1,
            releasedEpochMs: 1_150,
            timedOut: false,
        },
        ipc,
        mainCounters: {
            counters: {
                'main.modulesRegisteredBeforeWindow': 2,
                'main.sqlStatements': 61,
                'main.sqlStatementsBeforeReadyToShow': 9,
                'main.startupPhases': 9,
            },
            frozenAtEpochMs: {
                'main.modulesRegisteredBeforeWindow': 1_010,
                'main.sqlStatementsBeforeReadyToShow': 1_250,
            },
        },
        pid: 4242,
        renderer,
        spawnEpochMs: 1_000,
        ...overrides,
    };
}

test('maps the probe, IPC capture and main counters to exact counters and spawn-relative wall-clock', () => {
    const record = toLaunchIterationRecord(2, false, measurement());
    assert.equal(record.index, 2);
    assert.equal(record.warmup, false);
    assert.equal(record.pid, 4242);
    assert.deepEqual(record.counters, {
        'main.modulesRegisteredBeforeWindow': 2,
        'main.sqlStatementsBeforeReadyToShow': 9,
        'renderer.cdTicksIdle30s': 31,
        'renderer.cdTicksToFirstCard': 23,
        'renderer.domMutationsToFirstCard': 480,
        'renderer.ipcCallsToFirstCard': 14,
        'renderer.ipcSerialDepthToFirstCard': 2,
        'renderer.layoutShiftScore': 0.123,
        'renderer.layoutShiftScoreSettled': 0.23,
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
    assert.deepEqual(record.evidence['ipcSerialDepth'], {
        chain: ['getSettings', 'dbGetAppPlaylists'],
        depth: 2,
        depthLowerBound: 2,
        inFlightAtEnd: 1,
    });
    assert.deepEqual(record.evidence['ipcTimeline'], [
        '+getSettings',
        '-getSettings',
        '+dbGetAppPlaylists',
        '+getSettings',
        '-dbGetAppPlaylists',
    ]);
    assert.deepEqual(record.evidence['longTaskDurationsMs'], [71.3, 120]);
    assert.equal(record.evidence['ipcCallsAfterFirstCard'], 3);
    assert.deepEqual(record.evidence['mainCountersAtRead'], {
        'main.modulesRegisteredBeforeWindow': 2,
        'main.sqlStatements': 61,
        'main.sqlStatementsBeforeReadyToShow': 9,
        'main.startupPhases': 9,
    });
    assert.equal(record.evidence['rendererGateReadyToShowHeldOnBlank'], 1);
    assert.deepEqual(record.evidence['epochs'], {
        firstCard: 2_600.04,
        firstCardPaint: 2_650,
        loadEventEnd: 1_400.26,
        mainIpcCaptureInstalled: 1_100,
        mainProcessStart: 900,
        mainReadyToShow: 1_250,
        mainWindowCreated: 1_010,
        rendererGateBlankLoaded: 1_050,
        rendererGateReleased: 1_150,
        rendererProbeInstalled: 1_200,
        settled: 3_180.06,
        spawn: 1_000,
    });
    assert.deepEqual(record.evidence['settle'], {
        domMutations: 37,
        firstCardToSettledMs: 580,
        lateShifts: [
            {
                afterFirstCardMs: 15,
                sources: [
                    {
                        deltaHeight: 0,
                        deltaY: -240,
                        node: 'section.dashboard-rail',
                    },
                ],
                value: 0.2305,
            },
        ],
        observedTarget: 'root',
        reason: 'quiet',
    });
    assert.deepEqual(record.evidence['idle'], {
        domMutations: 12,
        durationMs: 30_000,
        settledToIdleStartMs: 19.9,
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
    // A launch that ran without the main-process counters (as J2's do) is
    // not a J1 measurement.
    assert.throws(
        () =>
            toLaunchIterationRecord(0, false, { ...base, mainCounters: null }),
        /main-counters-missing/
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
                        changeDetectionTicks: 'unavailable-counter-missing',
                    },
                    counters: {
                        ...base.renderer.counters,
                        changeDetectionTicks: null,
                    },
                },
            }),
        /cd-ticks-unavailable-counter-missing/
    );
});

test('refuses a launch without a complete, on-time idle window after the settle point', () => {
    const base = measurement();
    const withIdle = (
        idle: Partial<LaunchJourneyMeasurement['renderer']['idle']>
    ): LaunchJourneyMeasurement => ({
        ...base,
        renderer: {
            ...base.renderer,
            idle: { ...base.renderer.idle, ...idle },
        },
    });
    // J2's launches skip the window; such a launch is not a J1 measurement.
    assert.throws(
        () =>
            toLaunchIterationRecord(
                0,
                false,
                withIdle({ status: 'disabled', ticks: null })
            ),
        /idle-disabled/
    );
    assert.throws(
        () => toLaunchIterationRecord(0, false, withIdle({ ticks: null })),
        /idle-done/
    );
    assert.throws(
        () =>
            toLaunchIterationRecord(
                0,
                false,
                withIdle({ endEpochMs: 33_000, startEpochMs: 3_000 })
            ),
        /idle-before-settle/
    );
    // The settle point is 3_180.06: a window opened 120 ms after it left
    // ticks uncounted in between.
    assert.throws(
        () =>
            toLaunchIterationRecord(
                0,
                false,
                withIdle({ endEpochMs: 33_300.1, startEpochMs: 3_300.1 })
            ),
        /idle-start-late/
    );
    assert.doesNotThrow(() =>
        toLaunchIterationRecord(
            0,
            false,
            withIdle({ endEpochMs: 33_250, startEpochMs: 3_250 })
        )
    );
    assert.throws(
        () =>
            toLaunchIterationRecord(0, false, withIdle({ endEpochMs: 33_000 })),
        /idle-window-short/
    );
    assert.throws(
        () =>
            toLaunchIterationRecord(0, false, withIdle({ endEpochMs: 34_500 })),
        /idle-window-late/
    );
    assert.equal(
        toLaunchIterationRecord(0, false, withIdle({ ticks: 0 })).counters[
            'renderer.cdTicksIdle30s'
        ],
        0
    );
});

test('refuses a launch whose settle window did not end after the first-card cutoff', () => {
    const base = measurement();
    const withSettle = (
        settle: Partial<LaunchJourneyMeasurement['renderer']['settle']>
    ): LaunchJourneyMeasurement => ({
        ...base,
        renderer: {
            ...base.renderer,
            settle: { ...base.renderer.settle, ...settle },
        },
    });
    assert.throws(
        () =>
            toLaunchIterationRecord(
                0,
                false,
                withSettle({ epochMs: null, status: 'pending' })
            ),
        /settle-pending/
    );
    assert.throws(
        () =>
            toLaunchIterationRecord(
                0,
                false,
                withSettle({ epochMs: null, status: 'disabled' })
            ),
        /settle-disabled/
    );
    assert.throws(
        () => toLaunchIterationRecord(0, false, withSettle({ epochMs: 2_640 })),
        /settle-quiet/
    );
    const capped = toLaunchIterationRecord(
        0,
        false,
        withSettle({ epochMs: 3_150, status: 'cap' })
    );
    assert.equal(
        (capped.evidence['settle'] as { reason: string }).reason,
        'cap'
    );
});

test('measures every counter the plan lists for J1', () => {
    assert.deepEqual(Object.keys(LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS), []);
});

test('never reports a measured counter as unavailable', () => {
    const record = toLaunchIterationRecord(0, false, measurement());
    for (const name of Object.keys(LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS)) {
        assert.equal(name in record.counters, false, name);
    }
});
