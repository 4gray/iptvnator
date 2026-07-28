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
import { createXtreamIpcMarkerProtocol } from './xtream-ipc-marker-protocol';
import { createXtreamMainLifecycleValidator } from './xtream-main-lifecycle';

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

describe('Xtream preload marker capture', () => {
    it('restores both factories without module closures for Electron-main injection', () => {
        const restore = <T>(source: string): T =>
            new Function(`"use strict"; return (${source});`)() as T;
        const protocolFactory = restore<typeof createXtreamIpcMarkerProtocol>(
            createXtreamIpcMarkerProtocol.toString()
        );
        const captureFactory = restore<typeof createXtreamIpcMarkerCapture>(
            createXtreamIpcMarkerCapture.toString()
        );
        const lifecycleFactory = restore<
            typeof createXtreamMainLifecycleValidator
        >(createXtreamMainLifecycleValidator.toString());
        const capture = captureFactory(
            options,
            protocolFactory(options),
            lifecycleFactory()
        );

        capture.start(42, 90);
        assert.equal(capture.acceptPreload(42, 101, marker()), true);
    });

    it('accepts only the exact 13-key safe schema from the bound webContents', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);

        assert.equal(capture.acceptPreload(42, 101, marker()), true);
        assert.equal(
            capture.acceptPreload(
                42,
                102,
                marker({
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 101,
                })
            ),
            true
        );

        const snapshot = capture.stop();
        assert.deepEqual(snapshot.invalidReasons, []);
        assert.equal(snapshot.quarantinedKeyCount, 0);
        assert.equal(snapshot.timeline.length, 2);
        assert.deepEqual(snapshot.timeline[0], {
            action: null,
            boundary: 'start',
            categoryType: null,
            contentType: 'live',
            epochMs: 101,
            ipcCallId: 1,
            itemCount: 60_000,
            method: 'dbSaveContent',
            operationId: 'operation-1',
            outcome: null,
            playlistId: 'playlist-1',
            sessionId: null,
            sourceEpochMs: 100,
            type: 'xtream-preload-marker',
        });
    });

    it('normalizes sub-millisecond cross-process clock skew and rejects larger reversals', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);

        assert.equal(
            capture.acceptPreload(42, 100, marker({ sourceEpochMs: 100.006 })),
            true
        );
        assert.equal(
            capture.acceptPreload(
                42,
                101,
                marker({
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 101.006,
                })
            ),
            true
        );
        const snapshot = capture.stop();
        assert.deepEqual(snapshot.invalidReasons, []);
        assert.equal(snapshot.timeline[0]?.epochMs, 100.006);
        assert.equal(snapshot.timeline[1]?.epochMs, 101.006);

        const reversed = createXtreamIpcMarkerCapture(options);
        reversed.start(42, 90);
        assert.equal(
            reversed.acceptPreload(42, 100, marker({ sourceEpochMs: 101.001 })),
            false
        );
        assert.ok(
            reversed
                .stop()
                .invalidReasons.includes('preload-marker-source-after-receipt')
        );
    });

    it('rejects delayed preload markers from a completed capture generation', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        capture.stop();
        capture.start(42, 200);

        assert.equal(capture.acceptPreload(42, 210, marker()), false);
        assert.equal(
            capture.acceptPreload(
                42,
                211,
                marker({
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 101,
                })
            ),
            false
        );
        assert.ok(
            capture
                .stop()
                .invalidReasons.includes('preload-marker-before-capture-start')
        );
    });

    it('rejects another sender, extra or missing keys, malformed IDs, and regressing epochs', () => {
        const invalidCases: Array<{
            first?: Record<string, unknown>;
            input: Record<string, unknown>;
            receivedEpochMs?: number;
            sender?: number;
        }> = [
            { input: marker(), sender: 7 },
            { input: { ...marker(), password: 'provider-secret' } },
            {
                input: Object.fromEntries(
                    Object.entries(marker()).filter(
                        ([key]) => key !== 'itemCount'
                    )
                ),
            },
            { input: marker({ playlistId: ' playlist-1' }) },
            { input: marker({ ipcCallId: 0 }) },
            { input: marker({ outcome: 'success' }) },
            {
                first: marker(),
                input: marker({
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 99,
                }),
                receivedEpochMs: 102,
            },
            {
                input: marker({ sourceEpochMs: 102 }),
                receivedEpochMs: 101,
            },
        ];

        for (const testCase of invalidCases) {
            const capture = createXtreamIpcMarkerCapture(options);
            capture.start(42, 90);
            if (testCase.first) {
                assert.equal(
                    capture.acceptPreload(42, 101, testCase.first),
                    true
                );
            }
            assert.equal(
                capture.acceptPreload(
                    testCase.sender ?? 42,
                    testCase.receivedEpochMs ?? 101,
                    testCase.input
                ),
                false
            );
            assert.notEqual(capture.stop().invalidReasons.length, 0);
        }
    });

    it('correlates DB requests FIFO and quarantines overlapping duplicate keys', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        assert.equal(capture.acceptPreload(42, 100, marker()), true);

        const identity = capture.matchDatabaseRequest({
            operation: 'DB_SAVE_CONTENT',
            payload: {
                operationId: 'operation-1',
                playlistId: 'playlist-1',
                type: 'live',
            },
        });
        assert.deepEqual(identity, {
            ipcCallId: 1,
            operationId: 'operation-1',
            operationIdUnavailableReason: null,
            sourceEpochMs: 100,
        });
        assert.equal(
            capture.matchDatabaseRequest({
                operation: 'DB_GET_APP_PLAYLIST',
                payload: { playlistId: 'playlist-1' },
            }),
            null
        );

        const duplicateCapture = createXtreamIpcMarkerCapture(options);
        duplicateCapture.start(42, 90);
        assert.equal(duplicateCapture.acceptPreload(42, 100, marker()), true);
        assert.equal(
            duplicateCapture.acceptPreload(
                42,
                101,
                marker({ ipcCallId: 2, sourceEpochMs: 101 })
            ),
            false
        );
        assert.deepEqual(
            duplicateCapture.matchDatabaseRequest({
                operation: 'DB_SAVE_CONTENT',
                payload: {
                    operationId: 'operation-1',
                    playlistId: 'playlist-1',
                    type: 'live',
                },
            }),
            {
                ipcCallId: null,
                operationId: null,
                operationIdUnavailableReason:
                    'xtream-preload-performance-marker-ambiguous',
                sourceEpochMs: null,
            }
        );
        assert.equal(duplicateCapture.stop().quarantinedKeyCount, 1);
    });

    it('retains a mutable missing identity when a valid preload start arrives after the worker request', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const identity = capture.matchDatabaseRequest({
            operation: 'DB_SAVE_CONTENT',
            payload: {
                operationId: 'operation-1',
                playlistId: 'playlist-1',
                type: 'live',
            },
        });
        assert.deepEqual(identity, {
            ipcCallId: null,
            operationId: null,
            operationIdUnavailableReason:
                'xtream-preload-performance-marker-missing',
            sourceEpochMs: null,
        });

        assert.equal(capture.acceptPreload(42, 100, marker()), true);
        assert.deepEqual(identity, {
            ipcCallId: 1,
            operationId: 'operation-1',
            operationIdUnavailableReason: null,
            sourceEpochMs: 100,
        });
    });

    it('correlates read-only content requests without inventing an operation ID', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        assert.equal(
            capture.acceptPreload(
                42,
                100,
                marker({
                    ipcCallId: 3,
                    itemCount: null,
                    method: 'dbGetContent',
                    operationId: null,
                })
            ),
            true
        );

        assert.deepEqual(
            capture.matchDatabaseRequest({
                operation: 'DB_GET_CONTENT',
                payload: { playlistId: 'playlist-1', type: 'live' },
            }),
            {
                ipcCallId: 3,
                operationId: null,
                operationIdUnavailableReason: null,
                sourceEpochMs: 100,
            }
        );
    });

    it('correlates the preload cancel call separately from the active DB request', () => {
        const capture = createXtreamIpcMarkerCapture(options);
        capture.start(42, 90);
        const cancelMarker = marker({
            contentType: null,
            ipcCallId: 4,
            itemCount: null,
            method: 'dbCancelOperation',
            playlistId: null,
        });
        assert.equal(capture.acceptPreload(42, 100, cancelMarker), true);
        assert.deepEqual(
            capture.matchDatabaseCancel({
                operationId: 'operation-1',
                type: 'cancel',
            }),
            {
                ipcCallId: 4,
                operationId: 'operation-1',
                operationIdUnavailableReason: null,
                sourceEpochMs: 100,
            }
        );
        assert.equal(
            capture.acceptPreload(
                42,
                102,
                marker({
                    ...cancelMarker,
                    boundary: 'end',
                    outcome: 'success',
                    sourceEpochMs: 101,
                })
            ),
            true
        );
        assert.deepEqual(capture.stop().invalidReasons, []);
    });
});
