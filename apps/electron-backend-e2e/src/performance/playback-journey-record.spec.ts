import assert from 'node:assert/strict';
import test from 'node:test';

import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import type { JourneyMockRequest } from './journey-mock-request-ledger';
import type { JourneyRendererProbeState } from './journey-renderer-probe';
import { summarizeJourneyIterations } from './journey-summary';
import {
    PLAYBACK_JOURNEY_UNAVAILABLE_COUNTERS,
    toPlaybackIterationRecord,
    type PlaybackJourneyMeasurement,
} from './playback-journey-record';

const LIVE_PATH = '/dist/apps/web/workspace/xtreams/playlist-1/live';
const STREAM_ROUTE = '/live/:username/:password/10000.ts';

function request(sequence: number, route: string, epochMs: number) {
    return { epochMs, method: 'GET', route, sequence } as JourneyMockRequest;
}

type Start = NonNullable<JourneyRendererProbeState['start']>;
type Terminal = NonNullable<JourneyRendererProbeState['terminal']>;
type Media = NonNullable<JourneyRendererProbeState['media']>;

function measurement(
    overrides: Partial<PlaybackJourneyMeasurement> = {}
): PlaybackJourneyMeasurement {
    const renderer: JourneyRendererProbeState = {
        capabilities: {
            changeDetectionTicks: 'counted',
            layoutShift: true,
            longTask: true,
            observedTarget: 'documentElement',
        },
        counters: {
            changeDetectionTicks: 14,
            domMutations: 6_188,
            layoutShiftScore: 0,
            layoutShiftScoreSettled: 0,
            longTasks: 0,
            recentInputLayoutShiftScore: 0.00061,
        },
        final: true,
        firstCardPaintEpochMs: 10_360,
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
        journey: 'playback',
        longTaskDurationsMs: [],
        media: {
            element: {
                currentSrcScheme: 'blob',
                currentTime: 0.02133,
                paused: false,
                readyState: 4,
                videoHeight: 90,
                videoWidth: 160,
            },
            phases: { loadedmetadata: 10_095.04, playing: 10_349.84 },
        },
        navigation: null,
        preStart: { domMutations: 53, lastMutationEpochMs: 8_900 },
        schemaVersion: 1,
        sentinel: { epochMs: 10_350, status: 'sent' },
        settle: {
            domMutations: 0,
            epochMs: null,
            lastMutationEpochMs: null,
            lateShifts: [],
            observedTarget: null,
            status: 'disabled',
        },
        start: {
            epochMs: 10_000,
            listenerEpochMs: 10_000.5,
            pathname: LIVE_PATH,
            sentinelStatus: 'sent',
            targetTag: 'div',
            targetTestId: 'channel-item',
        },
        terminal: {
            cardCount: 1,
            cardTag: 'video',
            cardTestId: null,
            companionCounts: [],
            epochMs: 10_349.84,
            pathname: LIVE_PATH,
        },
    };
    const ipc: JourneyMainIpcCaptureState = {
        ambiguousTimelineCompletions: 0,
        callsAfterSentinel: 3,
        callsBeforeStart: 6,
        callsBeforeSentinel: 4,
        callsByMethod: {
            getEpgMapping: 1,
            setUserAgent: 1,
            updateRemoteControlStatus: 1,
            xtreamRequest: 1,
        },
        inFlightByMethod: {},
        installedEpochMs: 9_500,
        malformedEvents: 0,
        processStartEpochMs: 1_000,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 10_351 },
        start: { occurrences: 1, receivedEpochMs: 10_001 },
        timeline: [
            { method: 'setUserAgent', phase: 'start' },
            { method: 'setUserAgent', phase: 'end' },
            { method: 'xtreamRequest', phase: 'start' },
            { method: 'getEpgMapping', phase: 'start' },
            { method: 'getEpgMapping', phase: 'end' },
            { method: 'updateRemoteControlStatus', phase: 'start' },
            { method: 'updateRemoteControlStatus', phase: 'end' },
            { method: 'xtreamRequest', phase: 'end' },
        ],
        unmatchedCompletions: 0,
    };
    return {
        externalArtworkCancelled: 8,
        http: {
            afterPlaying: [
                request(9, '/player_api.php?action=get_short_epg', 10_400),
            ],
            afterSettleBeforeClick: 0,
            beforeClick: [
                request(0, '/player_api.php?action=get_live_streams', 8_000),
            ],
            toPlaying: [
                request(7, STREAM_ROUTE, 10_020),
                request(
                    8,
                    '/player_api.php?action=get_simple_data_table',
                    10_030
                ),
            ],
        },
        ipc,
        pid: 5151,
        renderer,
        settle: {
            preStartDomMutations: 53,
            preStartHttpRequests: 4,
            preStartIpcCalls: 6,
            quietMs: 1_000,
            waitedMs: 1_809,
        },
        ...overrides,
    };
}

function withRenderer(
    patch: Partial<JourneyRendererProbeState>
): PlaybackJourneyMeasurement {
    const base = measurement();
    return { ...base, renderer: { ...base.renderer, ...patch } };
}

test('maps the media-terminated probe, IPC window and mock ledger to exact counters', () => {
    const record = toPlaybackIterationRecord(2, false, measurement());
    assert.equal(record.index, 2);
    assert.equal(record.warmup, false);
    assert.equal(record.pid, 5151);
    assert.deepEqual(record.counters, {
        'renderer.cdTicksToPlaying': 14,
        'renderer.domMutationsToPlaying': 6_188,
        'renderer.httpRequestsToPlaying': 2,
        'renderer.ipcCallsToPlaying': 4,
        'renderer.layoutShiftScore': 0.001,
        'renderer.longTasks': 0,
    });
    assert.deepEqual(record.wallClock, {
        clickToLoadedMetadataMs: 95,
        clickToPlayingMs: 349.8,
    });
    assert.deepEqual(record.evidence['httpRequestsByRoute'], {
        '/live/:username/:password/10000.ts': 1,
        '/player_api.php?action=get_simple_data_table': 1,
    });
    assert.deepEqual(record.evidence['httpRequestsAfterPlayingByRoute'], {
        '/player_api.php?action=get_short_epg': 1,
    });
    assert.deepEqual(record.evidence['httpRequestsBeforeClickByRoute'], {
        '/player_api.php?action=get_live_streams': 1,
    });
    assert.deepEqual(record.evidence['media'], {
        currentSrcScheme: 'blob',
        currentTime: 0.021,
        paused: false,
        readyState: 4,
        videoElements: 1,
        videoHeight: 90,
        videoWidth: 160,
    });
    assert.deepEqual(record.evidence['epochs'], {
        click: 10_000,
        clickListener: 10_000.5,
        loadedMetadata: 10_095.04,
        mainIpcSentinel: 10_351,
        mainIpcStart: 10_001,
        playing: 10_349.84,
    });
    // Click 10,000: last request before at 8,000, first after at 10,020.
    // Playing 10,349.84: last before at 10,030, first after at 10,400.
    assert.deepEqual(record.evidence['httpBoundaryMarginsMs'], {
        click: 20,
        playing: 50.2,
    });
    assert.equal(record.evidence['externalArtworkCancelled'], 8);
    assert.equal(record.evidence['ipcCallsAfterPlaying'], 3);
});

test('rejects measurements that did not start at a live channel or did not play a video', () => {
    const base = measurement();
    const start = base.renderer.start as Start;
    const terminal = base.renderer.terminal as Terminal;
    const media = base.renderer.media as Media;
    const cases: [PlaybackJourneyMeasurement, RegExp][] = [
        [withRenderer({ start: null }), /incomplete-probe/],
        [withRenderer({ terminal: null }), /incomplete-probe/],
        [withRenderer({ media: null }), /incomplete-probe/],
        [{ ...base, ipc: { ...base.ipc, start: null } }, /ipc-without-start/],
        [
            withRenderer({
                start: { ...start, pathname: '/workspace/dashboard' },
            }),
            /start-route/,
        ],
        [
            withRenderer({
                start: {
                    ...start,
                    pathname: '/workspace/xtreams/playlist-1/vod',
                },
            }),
            /start-route/,
        ],
        [
            withRenderer({ terminal: { ...terminal, cardTag: 'div' } }),
            /not-a-video/,
        ],
        [withRenderer({ media: { ...media, element: null } }), /not-a-video/],
        [withRenderer({ media: { ...media, phases: {} } }), /clock-order/],
        [
            withRenderer({
                media: {
                    ...media,
                    phases: { loadedmetadata: terminal.epochMs + 1 },
                },
            }),
            /clock-order/,
        ],
        [
            withRenderer({
                media: {
                    ...media,
                    phases: { loadedmetadata: start.epochMs - 1 },
                },
            }),
            /clock-order/,
        ],
        [
            withRenderer({
                terminal: { ...terminal, epochMs: start.epochMs },
                media: { ...media, phases: { loadedmetadata: start.epochMs } },
            }),
            /clock-order/,
        ],
        [
            withRenderer({
                capabilities: {
                    ...base.renderer.capabilities,
                    changeDetectionTicks: 'unavailable-counter-missing',
                },
                counters: {
                    ...base.renderer.counters,
                    changeDetectionTicks: null,
                },
            }),
            /cd-ticks-unavailable-counter-missing/,
        ],
    ];
    for (const [input, error] of cases) {
        assert.throws(() => toPlaybackIterationRecord(0, false, input), error);
    }
});

test('requires the stream from the local fixture inside the window', () => {
    const base = measurement();
    const withoutStream = {
        ...base,
        http: {
            ...base.http,
            toPlaying: base.http.toPlaying.filter(
                (entry) => entry.route !== STREAM_ROUTE
            ),
        },
    };
    assert.throws(
        () => toPlaybackIterationRecord(0, false, withoutStream),
        /no-local-stream/
    );
    const hls = {
        ...base,
        http: {
            ...base.http,
            toPlaying: [request(7, '/live/:username/:password/10000.m3u8', 1)],
        },
    };
    assert.throws(
        () => toPlaybackIterationRecord(0, false, hls),
        /no-local-stream/
    );
});

test('rejects activity that moved between the settle snapshot and the click', () => {
    const base = measurement();
    assert.throws(
        () =>
            toPlaybackIterationRecord(0, false, {
                ...base,
                http: { ...base.http, afterSettleBeforeClick: 1 },
                ipc: { ...base.ipc, callsBeforeStart: 7 },
                renderer: {
                    ...base.renderer,
                    preStart: { domMutations: 54, lastMutationEpochMs: 1 },
                },
            }),
        /activity-before-click-dom-ipc-http/
    );
});

test('summarizes playback iterations with J3 counters and unavailable reasons', () => {
    const iterations = [0, 1, 2].map((index) =>
        toPlaybackIterationRecord(index, index === 0, {
            ...measurement(),
            pid: 100 + index,
        })
    );
    const entry = summarizeJourneyIterations(
        iterations,
        PLAYBACK_JOURNEY_UNAVAILABLE_COUNTERS
    );
    assert.equal(entry.counters['renderer.ipcCallsToPlaying'], 4);
    assert.deepEqual(entry.counterStability['renderer.ipcCallsToPlaying'], {
        stable: true,
        values: [4, 4],
    });
    assert.equal(entry.wallClock['clickToPlayingMs.p50'], 349.8);
    assert.equal(entry.wallClock['clickToLoadedMetadataMs.p90'], 95);
    assert.equal(entry.counters['renderer.cdTicksToPlaying'], 14);
    assert.deepEqual(Object.keys(entry.unavailable).sort(), [
        'renderer.ipcSerialDepthToPlaying',
    ]);
});
