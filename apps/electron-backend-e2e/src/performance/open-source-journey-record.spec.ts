import assert from 'node:assert/strict';
import test from 'node:test';

import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import type { JourneyMockRequest } from './journey-mock-request-ledger';
import type { JourneyRendererProbeState } from './journey-renderer-probe';
import { summarizeJourneyIterations } from './journey-summary';
import {
    OPEN_SOURCE_JOURNEY_UNAVAILABLE_COUNTERS,
    toOpenSourceIterationRecord,
    type OpenSourceJourneyMeasurement,
} from './open-source-journey-record';

const SOURCE_PATH = '/dist/apps/web/workspace/xtreams/playlist-1/vod';

function request(sequence: number, route: string, epochMs: number) {
    return { epochMs, method: 'GET', route, sequence } as JourneyMockRequest;
}

function measurement(
    overrides: Partial<OpenSourceJourneyMeasurement> = {}
): OpenSourceJourneyMeasurement {
    const renderer: JourneyRendererProbeState = {
        capabilities: {
            changeDetectionTicks: 'counted',
            layoutShift: true,
            longTask: true,
            observedTarget: 'documentElement',
        },
        counters: {
            changeDetectionTicks: 9,
            domMutations: 1_596,
            layoutShiftScore: 0.0004,
            layoutShiftScoreSettled: 0,
            longTasks: 1,
            recentInputLayoutShiftScore: 0.22061,
        },
        final: true,
        firstCardPaintEpochMs: 10_090,
        idle: {
            domMutations: 0,
            endEpochMs: null,
            startEpochMs: null,
            status: 'disabled',
            ticks: null,
        },
        installed: {
            bridgePresent: true,
            documentElementPresent: true,
            epochMs: 9_000,
            readyState: 'complete',
            scriptCount: 12,
        },
        invalidReasons: [],
        journey: 'open-source',
        longTaskDurationsMs: [61.26],
        media: null,
        navigation: null,
        preStart: { domMutations: 4, lastMutationEpochMs: 9_100 },
        schemaVersion: 1,
        sentinel: { epochMs: 10_080.5, status: 'sent' },
        settle: {
            domMutations: 0,
            epochMs: null,
            lastMutationEpochMs: null,
            lateShifts: [],
            observedTarget: null,
            status: 'disabled',
        },
        start: {
            epochMs: 10_000.2,
            listenerEpochMs: 10_001,
            pathname: '/dist/apps/web/workspace/dashboard',
            sentinelStatus: 'sent',
            targetTag: 'div',
            targetTestId: 'dashboard-recent-sources-rail-card',
        },
        terminal: {
            cardCount: 50,
            cardTag: 'mat-card',
            cardTestId: null,
            companionCounts: [8],
            epochMs: 10_078.54,
            pathname: SOURCE_PATH,
        },
    };
    const ipc: JourneyMainIpcCaptureState = {
        ambiguousTimelineCompletions: 0,
        callsAfterSentinel: 2,
        callsBeforeStart: 0,
        callsBeforeSentinel: 17,
        callsByMethod: { dbGetAppState: 6, dbGetContent: 2, xtreamRequest: 1 },
        inFlightByMethod: {},
        installedEpochMs: 9_500,
        malformedEvents: 0,
        processStartEpochMs: 1_000,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 10_081 },
        start: { occurrences: 1, receivedEpochMs: 10_002 },
        timeline: [],
        unmatchedCompletions: 0,
    };
    return {
        http: {
            afterSettleBeforeClick: 0,
            afterSettled: [
                request(3, '/player_api.php?action=get_vod_streams', 12_500),
            ],
            beforeClick: [
                request(0, '/player_api.php?action=get_account_info', 2_000),
            ],
            requests: [
                request(1, '/player_api.php?action=get_account_info', 10_040),
                request(2, '/assets/marketing/poster/a', 10_200),
            ],
        },
        ipc,
        pid: 4343,
        renderer,
        settle: {
            preStartDomMutations: 4,
            preStartHttpRequests: 0,
            preStartIpcCalls: 0,
            quietMs: 1_000,
            waitedMs: 1_048,
        },
        ...overrides,
    };
}

test('maps the click-started probe, IPC window and mock ledger to exact counters', () => {
    const record = toOpenSourceIterationRecord(3, false, measurement());
    assert.equal(record.index, 3);
    assert.equal(record.warmup, false);
    assert.equal(record.pid, 4343);
    assert.deepEqual(record.counters, {
        'main.mockHttpRequestsToSettled': 2,
        'renderer.cdTicksToFirstPage': 9,
        'renderer.domMutationsToFirstPage': 1_596,
        'renderer.ipcCallsToFirstPage': 17,
        'renderer.layoutShiftScore': 0.221,
        'renderer.longTasks': 1,
    });
    assert.deepEqual(record.wallClock, {
        clickToFirstPageMs: 78.3,
        clickToFirstPagePaintMs: 89.8,
    });
    assert.deepEqual(record.evidence['layoutShift'], {
        recentInput: 0.221,
        withoutRecentInput: 0,
    });
    assert.deepEqual(record.evidence['httpRequestsByRoute'], {
        '/assets/marketing/poster/a': 1,
        '/player_api.php?action=get_account_info': 1,
    });
    // Arrived after the post-terminal quiet sample: evidence, not counted.
    assert.deepEqual(record.evidence['httpRequestsAfterSettledByRoute'], {
        '/player_api.php?action=get_vod_streams': 1,
    });
    assert.deepEqual(record.evidence['httpRequestsBeforeClickByRoute'], {
        '/player_api.php?action=get_account_info': 1,
    });
    assert.equal(record.evidence['httpRequestsToFirstPage'], 1);
    assert.equal(record.evidence['ipcCallsAfterFirstPage'], 2);
    assert.deepEqual(record.evidence['firstPage'], {
        cardCount: 50,
        cardTag: 'mat-card',
        cardTestId: null,
        categoryCount: 8,
        pathname: SOURCE_PATH,
        section: 'vod',
    });
    assert.deepEqual(record.evidence['start'], {
        pathname: '/dist/apps/web/workspace/dashboard',
        targetTag: 'div',
        targetTestId: 'dashboard-recent-sources-rail-card',
    });
    assert.deepEqual(record.evidence['longTaskDurationsMs'], [61.3]);
    assert.deepEqual(record.evidence['epochs'], {
        click: 10_000.2,
        clickListener: 10_001,
        firstPage: 10_078.54,
        firstPagePaint: 10_090,
        mainIpcSentinel: 10_081,
        mainIpcStart: 10_002,
    });
});

test('rejects measurements that did not start at the click or did not open the source', () => {
    const base = measurement();
    const renderer = base.renderer;
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: { ...renderer, start: null },
            }),
        /incomplete-probe/
    );
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: { ...renderer, terminal: null },
            }),
        /incomplete-probe/
    );
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                ipc: { ...base.ipc, start: null },
            }),
        /ipc-without-start/
    );
    const terminal = renderer.terminal as NonNullable<
        JourneyRendererProbeState['terminal']
    >;
    const start = renderer.start as NonNullable<
        JourneyRendererProbeState['start']
    >;
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...renderer,
                    terminal: { ...terminal, pathname: '/workspace/dashboard' },
                },
            }),
        /record-route/
    );
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...renderer,
                    start: { ...start, pathname: SOURCE_PATH },
                },
            }),
        /started-inside-source/
    );
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...renderer,
                    terminal: { ...terminal, epochMs: start.epochMs },
                },
            }),
        /clock-order/
    );
    for (const firstCardPaintEpochMs of [null, terminal.epochMs - 1]) {
        assert.throws(
            () =>
                toOpenSourceIterationRecord(0, false, {
                    ...base,
                    renderer: { ...renderer, firstCardPaintEpochMs },
                }),
            /clock-order/
        );
    }
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...renderer,
                    capabilities: {
                        ...renderer.capabilities,
                        changeDetectionTicks: 'unavailable-counter-missing',
                    },
                    counters: {
                        ...renderer.counters,
                        changeDetectionTicks: null,
                    },
                },
            }),
        /cd-ticks-unavailable-counter-missing/
    );
});

test('rejects an iteration with activity between the settle snapshot and the click', () => {
    const base = measurement();
    assert.doesNotThrow(() => toOpenSourceIterationRecord(0, false, base));
    // The probe counted DOM mutations after the snapshot (4) but before the
    // click, e.g. while Playwright ran its actionability checks.
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                renderer: {
                    ...base.renderer,
                    preStart: { domMutations: 5, lastMutationEpochMs: 9_990 },
                },
            }),
        /activity-before-click-dom$/
    );
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                ipc: { ...base.ipc, callsBeforeStart: 1 },
            }),
        /activity-before-click-ipc$/
    );
    assert.throws(
        () =>
            toOpenSourceIterationRecord(0, false, {
                ...base,
                http: { ...base.http, afterSettleBeforeClick: 1 },
                ipc: { ...base.ipc, callsBeforeStart: 2 },
            }),
        /activity-before-click-ipc-http$/
    );
});

test('summarizes under the J2 counters with the unmeasurable ones listed', () => {
    const entry = summarizeJourneyIterations(
        [0, 1, 2].map((index) =>
            toOpenSourceIterationRecord(
                index,
                index === 0,
                measurement({ pid: 5_000 + index })
            )
        ),
        OPEN_SOURCE_JOURNEY_UNAVAILABLE_COUNTERS
    );
    assert.equal(entry.counters['renderer.ipcCallsToFirstPage'], 17);
    assert.equal(
        entry.counterStability['main.mockHttpRequestsToSettled']?.stable,
        true
    );
    assert.equal(entry.wallClock['clickToFirstPageMs.p50'], 78.3);
    assert.equal(entry.wallClock['clickToFirstPagePaintMs.p90'], 89.8);
    assert.equal(entry.counters['renderer.cdTicksToFirstPage'], 9);
    assert.deepEqual(Object.keys(entry.unavailable).sort(), [
        'main.sqlStatementsToFirstPage',
    ]);
});
