import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_PRELOAD_PERFORMANCE_METHOD,
    XtreamCodeActions,
} from '@iptvnator/shared/interfaces';

import {
    createXtreamIpcMarkerCapture,
    deriveXtreamAcquisitionDurationMs,
    type XtreamIpcMarkerCaptureOptions,
} from './xtream-ipc-marker-events';

const options: XtreamIpcMarkerCaptureOptions = {
    actions: Object.values(XtreamCodeActions),
    mainPhases: Object.values(XTREAM_MAIN_PERFORMANCE_PHASE),
    methods: Object.values(XTREAM_PRELOAD_PERFORMANCE_METHOD),
    schemaVersion: 1,
};

function marker(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        sourceEpochMs: 100,
        ipcCallId: 1,
        method: 'dbSaveContent',
        boundary: 'start',
        outcome: null,
        playlistId: 'playlist-1',
        operationId: 'operation-1',
        sessionId: null,
        action: null,
        categoryType: null,
        contentType: 'live',
        itemCount: 60_000,
        ...overrides,
    };
}

function mainPhase(overrides: Record<string, unknown> = {}) {
    return {
        boundary: 'start',
        durationMs: null,
        epochMs: 110,
        phase: 'xtream.network.total',
        requestId: 'xtream-mock1-1',
        ...overrides,
    };
}

describe('Xtream main phase correlation', () => {
    it('binds network phases to preload calls in FIFO order without inventing handler entry time', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        assert.equal(
            capture.acceptPreload(
                42,
                100,
                marker({
                    action: XtreamCodeActions.GetLiveCategories,
                    contentType: null,
                    ipcCallId: 1,
                    itemCount: null,
                    method: 'xtreamRequest',
                    operationId: null,
                    playlistId: null,
                    sessionId: 'session-1',
                })
            ),
            true
        );
        assert.equal(
            capture.acceptMainPhase(
                mainPhase({ epochMs: 101, requestId: 'xtream-mock1-1' })
            ),
            true
        );
        assert.equal(
            capture.acceptMainPhase(
                mainPhase({
                    boundary: 'end',
                    durationMs: 9,
                    epochMs: 110,
                    requestId: 'xtream-mock1-1',
                })
            ),
            true
        );

        const mainEvents = capture
            .stop()
            .timeline.filter(({ type }) => type === 'xtream-main-phase');
        assert.deepEqual(
            mainEvents.map(({ action, ipcCallId, requestId }) => ({
                action,
                ipcCallId,
                requestId,
            })),
            [
                {
                    action: XtreamCodeActions.GetLiveCategories,
                    ipcCallId: 1,
                    requestId: 'xtream-mock1-1',
                },
                {
                    action: XtreamCodeActions.GetLiveCategories,
                    ipcCallId: 1,
                    requestId: 'xtream-mock1-1',
                },
            ]
        );
        assert.equal(
            JSON.stringify(mainEvents).includes('handler-entry'),
            false
        );
    });

    it('invalidates a successful preload request without its required main linkage and phase inventory', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const start = marker({
            action: XtreamCodeActions.GetLiveCategories,
            contentType: null,
            ipcCallId: 1,
            itemCount: null,
            method: 'xtreamRequest',
            operationId: null,
            playlistId: null,
            sessionId: 'session-1',
        });
        assert.equal(capture.acceptPreload(42, 100, start), true);
        assert.equal(
            capture.acceptPreload(
                42,
                120,
                marker({
                    ...start,
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 119,
                })
            ),
            true
        );

        assert.ok(
            capture
                .stop()
                .invalidReasons.includes('preload-main-linkage-missing')
        );
    });

    it('invalidates an errored preload request when no main lifecycle was captured', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const start = xtreamRequestMarker();
        assert.equal(capture.acceptPreload(42, 100, start), true);
        assert.equal(
            capture.acceptPreload(
                42,
                120,
                marker({
                    ...start,
                    boundary: 'end',
                    outcome: 'error',
                    sourceEpochMs: 119,
                })
            ),
            true
        );

        assert.ok(
            capture
                .stop()
                .invalidReasons.includes('preload-main-linkage-missing')
        );
    });

    it('rejects response-ready before network completion for one request', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const start = xtreamRequestMarker();
        assert.equal(capture.acceptPreload(42, 100, start), true);
        acceptMainBoundary(capture, 'xtream.network.total', 'start', 101);
        acceptMainPair(capture, 'xtream.json.transform', 102, 104);
        acceptMainPair(capture, 'xtream.response.ready', 105, 106);
        acceptMainBoundary(capture, 'xtream.network.total', 'end', 110, 9);
        assert.equal(
            capture.acceptPreload(
                42,
                120,
                marker({
                    ...start,
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 119,
                })
            ),
            true
        );

        assert.ok(
            capture
                .stop()
                .invalidReasons.includes('main-phase-topology-invalid')
        );
    });

    it('accepts the legal success and error main lifecycles', () => {
        const success = createXtreamIpcMarkerCapture(options);
        success.start(42, 90);
        const successStart = xtreamRequestMarker();
        assert.equal(success.acceptPreload(42, 100, successStart), true);
        acceptMainBoundary(success, 'xtream.network.total', 'start', 101);
        acceptMainPair(success, 'xtream.json.transform', 103, 106);
        acceptMainBoundary(success, 'xtream.network.total', 'end', 110, 9);
        acceptMainPair(success, 'xtream.response.ready', 111, 112);
        assert.equal(
            success.acceptPreload(
                42,
                120,
                marker({
                    ...successStart,
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 119,
                })
            ),
            true
        );
        assert.deepEqual(success.stop().invalidReasons, []);

        const error = createXtreamIpcMarkerCapture(options);
        error.start(42, 90);
        const errorStart = xtreamRequestMarker();
        assert.equal(error.acceptPreload(42, 100, errorStart), true);
        acceptMainPair(error, 'xtream.network.total', 101, 110);
        assert.equal(
            error.acceptPreload(
                42,
                120,
                marker({
                    ...errorStart,
                    boundary: 'end',
                    outcome: 'error',
                    sourceEpochMs: 119,
                })
            ),
            true
        );
        assert.deepEqual(error.stop().invalidReasons, []);
    });

    it('rejects duplicate, unclosed, or non-monotonic main phase boundaries', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        assert.equal(capture.acceptMainPhase(mainPhase()), true);
        assert.equal(capture.acceptMainPhase(mainPhase()), false);
        const snapshot = capture.stop();
        assert.ok(
            snapshot.invalidReasons.includes('main-phase-duplicate-boundary')
        );
        assert.ok(snapshot.invalidReasons.includes('main-phase-unclosed'));
    });

    it('rejects delayed main phases from a completed capture generation', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        capture.stop();
        capture.start(42, 200);

        assert.equal(
            capture.acceptMainPhase(mainPhase({ epochMs: 150 })),
            false
        );
        assert.equal(
            capture.acceptMainPhase(
                mainPhase({
                    boundary: 'end',
                    durationMs: 10,
                    epochMs: 160,
                })
            ),
            false
        );
        assert.ok(
            capture
                .stop()
                .invalidReasons.includes('main-phase-before-capture-start')
        );
    });

    it('fails neutrally when a phase or correlation payload is a revoked proxy', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();

        assert.doesNotThrow(() => capture.acceptMainPhase(revoked.proxy));
        assert.equal(capture.acceptMainPhase(revoked.proxy), false);
        assert.doesNotThrow(() => capture.matchDatabaseCancel(revoked.proxy));
        assert.doesNotThrow(() => capture.matchDatabaseRequest(revoked.proxy));
    });

    it('subtracts JSON transform from network total and rejects negative acquisition', () => {
        assert.equal(deriveXtreamAcquisitionDurationMs(150, 40), 110);
        assert.throws(
            () => deriveXtreamAcquisitionDurationMs(40, 41),
            /xtream-acquisition-duration-invalid/
        );
        assert.throws(
            () => deriveXtreamAcquisitionDurationMs(-1, 0),
            /xtream-acquisition-duration-invalid/
        );
    });
});

function xtreamRequestMarker() {
    return marker({
        action: XtreamCodeActions.GetLiveCategories,
        contentType: null,
        ipcCallId: 1,
        itemCount: null,
        method: 'xtreamRequest',
        operationId: null,
        playlistId: null,
        sessionId: 'session-1',
    });
}

function acceptMainPair(
    capture: ReturnType<typeof createXtreamIpcMarkerCapture>,
    phase: string,
    startedEpochMs: number,
    endedEpochMs: number
): void {
    assert.equal(
        capture.acceptMainPhase(
            mainPhase({
                epochMs: startedEpochMs,
                phase,
            })
        ),
        true
    );
    assert.equal(
        capture.acceptMainPhase(
            mainPhase({
                boundary: 'end',
                durationMs: endedEpochMs - startedEpochMs,
                epochMs: endedEpochMs,
                phase,
            })
        ),
        true
    );
}

function acceptMainBoundary(
    capture: ReturnType<typeof createXtreamIpcMarkerCapture>,
    phase: string,
    boundary: 'end' | 'start',
    epochMs: number,
    durationMs: number | null = null
): void {
    assert.equal(
        capture.acceptMainPhase(
            mainPhase({
                boundary,
                durationMs,
                epochMs,
                phase,
            })
        ),
        true
    );
}
