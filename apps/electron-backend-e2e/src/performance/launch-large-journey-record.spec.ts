import assert from 'node:assert/strict';
import test from 'node:test';

import type {
    JourneyIpcLogEvent,
    JourneyMainIpcCaptureState,
} from './journey-main-ipc-capture';
import type {
    JourneyRendererProbePhaseState,
    JourneyRendererProbeState,
} from './journey-renderer-probe';
import {
    createLaunchLargeJourneyPhases,
    LAUNCH_LARGE_JOURNEY_UNAVAILABLE_COUNTERS,
    LAUNCH_LARGE_RAILS_PHASE,
    LAUNCH_LARGE_RAILS_SENTINEL_ID,
    LAUNCH_LARGE_SQL_SAMPLE,
    summarizeDatabaseCalls,
    toLaunchLargeIterationRecord,
    type LaunchLargeJourneyMeasurement,
} from './launch-large-journey-record';

const LOAD = 1_400;
const FIRST_CARD = 2_600;
const RAILS = 4_100;

function log(
    ...entries: [number, string, 'end' | 'start'][]
): JourneyIpcLogEvent[] {
    return entries.map(([epochMs, method, phase]) => ({
        epochMs,
        method,
        phase,
    }));
}

/** Metas 1,420-1,900 (480 ms), positions 2,700-3,900 in two calls. */
const LOG = log(
    [1_405, 'dbGetAppState', 'start'],
    [1_412, 'dbGetAppState', 'end'],
    [1_420, 'dbGetAppPlaylistMetas', 'start'],
    [1_900, 'dbGetAppPlaylistMetas', 'end'],
    [2_000, 'reconcileEpgSources', 'start'],
    [2_050, 'reconcileEpgSources', 'end'],
    [2_601, 'cancelSourceProbe', 'start'],
    [2_602, 'cancelSourceProbe', 'end'],
    [2_700, 'dbGetAllPlaybackPositions', 'start'],
    [2_701, 'dbGetAllPlaybackPositions', 'start'],
    [3_800, 'dbGetAllPlaybackPositions', 'end'],
    [3_900, 'dbGetAllPlaybackPositions', 'end'],
    [4_101, 'cancelSourceProbe', 'start'],
    // After the rails: not timed.
    [4_200, 'dbGetAllPlaybackPositions', 'start'],
    [4_300, 'dbGetAllPlaybackPositions', 'end']
);

function phase(
    overrides: Partial<JourneyRendererProbePhaseState> = {}
): JourneyRendererProbePhaseState {
    return {
        afterFirstCardMs: RAILS - FIRST_CARD,
        domMutations: 150,
        epochMs: RAILS,
        missing: [],
        sentinelStatus: 'sent',
        status: 'reached',
        ...overrides,
    };
}

function measurement(
    overrides: {
        ipc?: Partial<JourneyMainIpcCaptureState>;
        phase?: Partial<JourneyRendererProbePhaseState> | null;
        renderer?: Partial<JourneyRendererProbeState>;
        sqlAtSentinels?: LaunchLargeJourneyMeasurement['sqlAtSentinels'];
    } = {}
): LaunchLargeJourneyMeasurement {
    const renderer: JourneyRendererProbeState = {
        capabilities: {
            changeDetectionTicks: 'counted',
            layoutShift: true,
            longTask: true,
            observedTarget: 'documentElement',
        },
        counters: {
            changeDetectionTicks: 5,
            domMutations: 900,
            layoutShiftScore: 0,
            layoutShiftScoreSettled: 0,
            longTasks: 1,
            recentInputLayoutShiftScore: 0,
        },
        final: true,
        firstCardPaintEpochMs: FIRST_CARD + 20,
        idle: {
            domMutations: 0,
            endEpochMs: null,
            startEpochMs: null,
            status: 'disabled',
            ticks: null,
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
        longTaskDurationsMs: [80],
        media: null,
        navigation: {
            domContentLoadedEpochMs: 1_300,
            loadEventEndEpochMs: LOAD,
        },
        phases:
            overrides.phase === null
                ? {}
                : { [LAUNCH_LARGE_RAILS_PHASE]: phase(overrides.phase) },
        preStart: { domMutations: 0, lastMutationEpochMs: null },
        schemaVersion: 1,
        sentinel: { epochMs: FIRST_CARD + 1, status: 'sent' },
        shiftCount: 0,
        shifts: [],
        settle: {
            domMutations: 40,
            epochMs: FIRST_CARD + 600,
            lastMutationEpochMs: FIRST_CARD + 100,
            lateShifts: [],
            observedTarget: 'root',
            status: 'quiet',
        },
        start: null,
        terminal: {
            cardCount: 4,
            cardTag: 'div',
            cardTestId: 'dashboard-recent-sources-rail-card',
            companionCounts: [],
            epochMs: FIRST_CARD,
            pathname: '/workspace/dashboard',
        },
        ...overrides.renderer,
    };
    const ipc: JourneyMainIpcCaptureState = {
        ambiguousTimelineCompletions: 0,
        callsAfterSentinel: 4,
        callsBeforeStart: 0,
        callsBeforeSentinel: 3,
        callsByMethod: {
            dbGetAppPlaylistMetas: 1,
            dbGetAppState: 1,
            reconcileEpgSources: 1,
        },
        inFlightByMethod: {},
        installedEpochMs: 1_100,
        log: LOG,
        logDropped: 0,
        malformedEvents: 0,
        processStartEpochMs: 900,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: FIRST_CARD + 1 },
        start: null,
        timeline: [
            { method: 'dbGetAppState', phase: 'start' },
            { method: 'dbGetAppState', phase: 'end' },
            { method: 'dbGetAppPlaylistMetas', phase: 'start' },
            { method: 'dbGetAppPlaylistMetas', phase: 'end' },
            { method: 'reconcileEpgSources', phase: 'start' },
            { method: 'reconcileEpgSources', phase: 'end' },
        ],
        unmatchedCompletions: 0,
        ...overrides.ipc,
    };
    return {
        electronVersion: '43.3.0',
        gate: {
            blankLoadedEpochMs: 1_050,
            didFinishLoadHeldOnBlank: 1,
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
                'main.sqlStatements': 400,
                'main.sqlStatementsBeforeReadyToShow': 90,
                'main.startupPhases': 9,
            },
            frozenAtEpochMs: {
                'main.modulesRegisteredBeforeWindow': 1_010,
                'main.sqlStatementsBeforeReadyToShow': 1_250,
            },
        },
        pid: 7,
        renderer,
        spawnEpochMs: 1_000,
        sqlAtSentinels: overrides.sqlAtSentinels ?? {
            [LAUNCH_LARGE_SQL_SAMPLE.FIRST_CARD]: {
                epochMs: FIRST_CARD + 2,
                sqlStatements: 120,
            },
            [LAUNCH_LARGE_SQL_SAMPLE.RAILS_SETTLED]: {
                epochMs: RAILS + 2,
                sqlStatements: 380,
            },
        },
    };
}

test('the rails phase watches every profile-fed rail and no skeleton', () => {
    const [phase, ...rest] = createLaunchLargeJourneyPhases();
    assert.equal(rest.length, 0);
    assert.equal(phase?.name, LAUNCH_LARGE_RAILS_PHASE);
    assert.equal(phase?.sentinelId, LAUNCH_LARGE_RAILS_SENTINEL_ID);
    assert.ok(
        phase?.requiredSelectors.includes(
            '[data-test-id="dashboard-continue-watching-rail-card"]'
        )
    );
    assert.ok(
        phase?.requiredSelectors.includes(
            '[data-test-id="dashboard-hero-slide"]'
        )
    );
    assert.deepEqual(phase?.absentSelectors, [
        '[data-test-id$="-rail-skeleton"]',
        '[data-test-id="dashboard-hero-skeleton"]',
    ]);
    assert.ok((phase?.timeoutMs ?? 0) >= 120_000);
});

test('adds the rails phase, the sampled SQL totals and the startup reads to J1 record', () => {
    const record = toLaunchLargeIterationRecord(1, false, measurement());
    assert.deepEqual(record.counters, {
        'main.modulesRegisteredBeforeWindow': 2,
        'main.sqlStatementsBeforeReadyToShow': 90,
        'main.sqlStatementsToFirstCard': 120,
        'main.sqlStatementsToRailsSettled': 380,
        'renderer.cdTicksToFirstCard': 5,
        'renderer.domMutationsToFirstCard': 900,
        'renderer.domMutationsToRailsSettled': 1_050,
        'renderer.ipcCallsToFirstCard': 3,
        'renderer.ipcSerialDepthToFirstCard': 3,
        'renderer.layoutShiftScore': 0,
        'renderer.layoutShiftScoreSettled': 0,
        'renderer.longTasks': 1,
        'renderer.playbackPositionCallsToRailsSettled': 2,
    });
    assert.deepEqual(record.wallClock, {
        firstCardToRailsSettledMs: 1_500,
        loadToFirstDbResponseMs: 12,
        playbackPositionsSpanMs: 1_200,
        playlistMetasMs: 480,
        spawnToDidFinishLoadMs: 400,
        spawnToFirstCardMs: 1_600,
        spawnToRailsSettledMs: 3_100,
    });
    assert.equal(record.evidence['idle'], null);
    assert.deepEqual(record.evidence['rails'], {
        afterFirstCardMs: 1_500,
        domMutations: 150,
        epochMs: RAILS,
        sqlSampledAtEpochMs: RAILS + 2,
    });
    assert.deepEqual(record.evidence['startup'], {
        firstDatabaseResponse: { afterLoadMs: 12, method: 'dbGetAppState' },
        playbackPositions: {
            calls: 2,
            firstStartAfterLoadMs: 1_300,
            spanMs: 1_200,
        },
        playlistMetas: { calls: 1, firstStartAfterLoadMs: 20, spanMs: 480 },
    });
    assert.deepEqual(
        (record.evidence['databaseCalls'] as Record<string, unknown>)[
            'dbGetAllPlaybackPositions'
        ],
        { calls: 3, firstStartAfterLoadMs: 1_300, lastEndAfterLoadMs: 2_900 }
    );
    assert.ok(
        'renderer.cdTicksIdle30s' in LAUNCH_LARGE_JOURNEY_UNAVAILABLE_COUNTERS
    );
    assert.ok(
        'main.rowsScannedToFirstCard' in
            LAUNCH_LARGE_JOURNEY_UNAVAILABLE_COUNTERS
    );
});

test('summarizes database calls relative to the load event', () => {
    assert.deepEqual(summarizeDatabaseCalls(LOG, LOAD), {
        dbGetAllPlaybackPositions: {
            calls: 3,
            firstStartAfterLoadMs: 1_300,
            lastEndAfterLoadMs: 2_900,
        },
        dbGetAppPlaylistMetas: {
            calls: 1,
            firstStartAfterLoadMs: 20,
            lastEndAfterLoadMs: 500,
        },
        dbGetAppState: {
            calls: 1,
            firstStartAfterLoadMs: 5,
            lastEndAfterLoadMs: 12,
        },
    });
});

test('refuses a launch whose rails never settled, lost a sample or a read', () => {
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({
                    phase: {
                        epochMs: null,
                        missing: ['[data-test-id="dashboard-hero-slide"]'],
                        status: 'timeout',
                    },
                })
            ),
        /rails-timeout: \[data-test-id="dashboard-hero-slide"\]/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({ phase: null })
            ),
        /rails-missing/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({ phase: { sentinelStatus: 'bridge-missing' } })
            ),
        /rails-sentinel-bridge-missing/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({
                    sqlAtSentinels: {
                        firstCard: { epochMs: 1, sqlStatements: 1 },
                        railsSettled: null,
                    },
                })
            ),
        /sql-samples-missing/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({
                    sqlAtSentinels: {
                        firstCard: { epochMs: 1, sqlStatements: 10 },
                        railsSettled: { epochMs: 2, sqlStatements: 9 },
                    },
                })
            ),
        /sql-samples-order/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({ ipc: { logDropped: 3 } })
            ),
        /ipc-log-dropped-3/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({
                    ipc: {
                        log: LOG.filter(
                            (event) => event.method !== 'dbGetAppPlaylistMetas'
                        ),
                    },
                })
            ),
        /no-playlist-metas-read/
    );
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(
                0,
                false,
                measurement({
                    ipc: {
                        log: LOG.filter(
                            (event) =>
                                event.method !== 'dbGetAllPlaybackPositions'
                        ),
                    },
                })
            ),
        /no-playback-position-reads/
    );
    // A probe that ran J1's idle window is not a large-library launch.
    const base = measurement();
    assert.throws(
        () =>
            toLaunchLargeIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...base.renderer,
                    idle: { ...base.renderer.idle, status: 'done' },
                },
            }),
        /idle-unexpected-done/
    );
});
