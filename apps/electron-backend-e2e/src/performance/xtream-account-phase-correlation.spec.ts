import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_PRELOAD_PERFORMANCE_METHOD,
    XtreamCodeActions,
} from '@iptvnator/shared/interfaces';

import {
    createXtreamIpcMarkerCapture,
    type XtreamIpcMarkerCapture,
    type XtreamIpcMarkerCaptureOptions,
} from './xtream-ipc-marker-events';

const OPTIONS: XtreamIpcMarkerCaptureOptions = {
    actions: Object.values(XtreamCodeActions),
    mainPhases: Object.values(XTREAM_MAIN_PERFORMANCE_PHASE),
    methods: Object.values(XTREAM_PRELOAD_PERFORMANCE_METHOD),
    schemaVersion: 1,
};

describe('Xtream account phase correlation', () => {
    it('accepts overlapping null-session calls and links main phases FIFO', () => {
        const capture = createXtreamIpcMarkerCapture(OPTIONS);
        capture.start(42, 90);
        assert.equal(
            capture.acceptPreload(42, 100, accountMarker(1, 99)),
            true
        );
        assert.equal(
            capture.acceptPreload(42, 102, accountMarker(2, 101)),
            true
        );
        acceptAccountMainLifecycle(capture, 1, 103);
        assert.equal(
            capture.acceptPreload(42, 113, accountMarker(1, 112, 'end')),
            true
        );
        acceptAccountMainLifecycle(capture, 2, 114);
        assert.equal(
            capture.acceptPreload(42, 124, accountMarker(2, 123, 'end')),
            true
        );

        const snapshot = capture.stop();
        assert.deepEqual(snapshot.invalidReasons, []);
        assert.equal(snapshot.quarantinedKeyCount, 0);
        const phases = snapshot.timeline.filter(
            ({ type }) => type === 'xtream-main-phase'
        );
        assert.deepEqual(
            phases.map(({ action, ipcCallId }) => ({ action, ipcCallId })),
            [
                ...Array.from({ length: 6 }, () => ({
                    action: XtreamCodeActions.GetAccountInfo,
                    ipcCallId: 1,
                })),
                ...Array.from({ length: 6 }, () => ({
                    action: XtreamCodeActions.GetAccountInfo,
                    ipcCallId: 2,
                })),
            ]
        );
    });

    it('fails closed for duplicate and malformed preload call IDs', () => {
        const capture = createXtreamIpcMarkerCapture(OPTIONS);
        capture.start(42, 90);
        assert.equal(
            capture.acceptPreload(42, 100, accountMarker(1, 99)),
            true
        );
        assert.equal(
            capture.acceptPreload(42, 102, accountMarker(1, 101)),
            false
        );
        assert.equal(
            capture.acceptPreload(42, 104, accountMarker(0, 103)),
            false
        );

        const snapshot = capture.stop();
        assert.equal(snapshot.quarantinedKeyCount, 1);
        assert.ok(
            snapshot.invalidReasons.includes('preload-marker-duplicate-key')
        );
    });
});

function acceptAccountMainLifecycle(
    capture: XtreamIpcMarkerCapture,
    ipcCallId: number,
    offset: number
): void {
    const requestId = `xtream-account-${ipcCallId}`;
    acceptMainBoundary(
        capture,
        requestId,
        'xtream.network.total',
        offset + 1,
        'start'
    );
    acceptMainPair(
        capture,
        requestId,
        'xtream.json.transform',
        offset + 2,
        offset + 3
    );
    acceptMainBoundary(
        capture,
        requestId,
        'xtream.network.total',
        offset + 6,
        'end',
        5
    );
    acceptMainPair(
        capture,
        requestId,
        'xtream.response.ready',
        offset + 7,
        offset + 8
    );
}

function acceptMainBoundary(
    capture: XtreamIpcMarkerCapture,
    requestId: string,
    phase: string,
    epochMs: number,
    boundary: 'end' | 'start',
    durationMs: number | null = null
): void {
    assert.equal(
        capture.acceptMainPhase({
            boundary,
            durationMs,
            epochMs,
            phase,
            requestId,
        }),
        true
    );
}

function acceptMainPair(
    capture: XtreamIpcMarkerCapture,
    requestId: string,
    phase: string,
    startEpochMs: number,
    endEpochMs: number
): void {
    assert.equal(
        capture.acceptMainPhase({
            boundary: 'start',
            durationMs: null,
            epochMs: startEpochMs,
            phase,
            requestId,
        }),
        true
    );
    assert.equal(
        capture.acceptMainPhase({
            boundary: 'end',
            durationMs: endEpochMs - startEpochMs,
            epochMs: endEpochMs,
            phase,
            requestId,
        }),
        true
    );
}

function accountMarker(
    ipcCallId: number,
    sourceEpochMs: number,
    boundary: 'end' | 'start' = 'start'
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        sourceEpochMs,
        ipcCallId,
        method: 'xtreamRequest',
        boundary,
        outcome: boundary === 'start' ? null : 'success',
        playlistId: null,
        operationId: null,
        sessionId: null,
        action: XtreamCodeActions.GetAccountInfo,
        categoryType: null,
        contentType: null,
        itemCount: null,
    };
}
