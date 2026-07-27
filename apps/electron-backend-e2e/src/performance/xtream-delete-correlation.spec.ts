import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_PRELOAD_PERFORMANCE_METHOD,
    XtreamCodeActions,
} from '@iptvnator/shared/interfaces';

import {
    createXtreamIpcMarkerCapture,
    type XtreamIpcMarkerCaptureOptions,
} from './xtream-ipc-marker-events';

const options: XtreamIpcMarkerCaptureOptions = {
    actions: Object.values(XtreamCodeActions),
    mainPhases: Object.values(XTREAM_MAIN_PERFORMANCE_PHASE),
    methods: Object.values(XTREAM_PRELOAD_PERFORMANCE_METHOD),
    schemaVersion: 1,
};

describe('Xtream playlist delete correlation', () => {
    it('correlates the follow-up playlist delete without fabricating an operation ID', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);

        assert.equal(capture.acceptPreload(42, 100, deleteMarker()), true);
        assert.deepEqual(capture.matchDatabaseRequest(deleteRequest()), {
            ipcCallId: 1,
            operationId: 'operation-1',
            operationIdUnavailableReason: null,
            sourceEpochMs: 100,
        });
        assert.equal(
            capture.acceptPreload(
                42,
                102,
                deleteMarker({
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 101,
                })
            ),
            true
        );

        const followUp = deleteMarker({
            ipcCallId: 2,
            operationId: null,
            sourceEpochMs: 103,
        });
        assert.equal(capture.acceptPreload(42, 104, followUp), true);
        assert.deepEqual(
            capture.matchDatabaseRequest(
                deleteRequest({ operationId: undefined })
            ),
            {
                ipcCallId: 2,
                operationId: null,
                operationIdUnavailableReason: null,
                sourceEpochMs: 103,
            }
        );
        assert.equal(
            capture.acceptPreload(
                42,
                106,
                deleteMarker({
                    ...followUp,
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 105,
                })
            ),
            true
        );
        assert.deepEqual(capture.stop().invalidReasons, []);
    });

    it('quarantines overlapping deletes that share the explicit no-operation-ID key', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const first = deleteMarker({ operationId: null });

        assert.equal(capture.acceptPreload(42, 100, first), true);
        assert.equal(
            capture.acceptPreload(
                42,
                101,
                deleteMarker({
                    ipcCallId: 2,
                    operationId: null,
                    sourceEpochMs: 101,
                })
            ),
            false
        );
        assert.deepEqual(
            capture.matchDatabaseRequest(deleteRequest({ operationId: null })),
            {
                ipcCallId: null,
                operationId: null,
                operationIdUnavailableReason:
                    'xtream-preload-performance-marker-ambiguous',
                sourceEpochMs: null,
            }
        );
        assert.equal(capture.stop().quarantinedKeyCount, 1);
    });
});

function deleteMarker(overrides: Record<string, unknown> = {}) {
    return {
        action: null,
        boundary: 'start',
        categoryType: null,
        contentType: null,
        ipcCallId: 1,
        itemCount: null,
        method: 'dbDeletePlaylist',
        operationId: 'operation-1',
        outcome: null,
        playlistId: 'playlist-1',
        schemaVersion: 1,
        sessionId: null,
        sourceEpochMs: 100,
        ...overrides,
    };
}

function deleteRequest(
    payloadOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        operation: 'DB_DELETE_PLAYLIST',
        payload: {
            operationId: 'operation-1',
            playlistId: 'playlist-1',
            ...payloadOverrides,
        },
    };
}
