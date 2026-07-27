import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDatabaseWorkerCancelCapture } from './database-worker-cancel-capture';

function dispatch(overrides: Record<string, unknown> = {}) {
    return {
        captureGeneration: 3,
        ipcCallId: 9,
        operationId: 'operation-1',
        postedEpochMs: 110,
        requestId: 'request-1',
        sourceEpochMs: 100,
        ...overrides,
    };
}

function receipt(overrides: Record<string, unknown> = {}) {
    return {
        type: 'performance-cancel-received',
        epochMs: 120,
        operationId: 'operation-1',
        requestId: 'request-1',
        ...overrides,
    };
}

describe('database worker cancel capture', () => {
    it('restores without module closures for Electron-main injection', () => {
        const source = createDatabaseWorkerCancelCapture.toString();
        assert.doesNotMatch(source, /__name/);
        const factory = new Function(
            `"use strict"; return (${source});`
        )() as typeof createDatabaseWorkerCancelCapture;
        factory().start(1);
    });

    it('keeps dispatch, worker receipt, and terminal cancellation distinct', () => {
        const capture = createDatabaseWorkerCancelCapture();
        capture.start(3);
        assert.equal(capture.acceptDispatch(dispatch()), true);
        assert.equal(
            capture.acceptReceipt({
                captureGeneration: 3,
                message: receipt(),
                receivedEpochMs: 121,
                recordGeneration: 3,
            }),
            true
        );
        assert.equal(
            capture.acceptTerminal({
                captureGeneration: 3,
                operationId: 'operation-1',
                receivedEpochMs: 130,
                recordGeneration: 3,
                requestId: 'request-1',
            }),
            true
        );

        const snapshot = capture.stop();
        assert.deepEqual(snapshot.invalidReasons, []);
        assert.deepEqual(
            snapshot.timeline.map(({ epochMs, type }) => ({ epochMs, type })),
            [
                { epochMs: 110, type: 'db-cancel-dispatched' },
                { epochMs: 120, type: 'db-cancel-received' },
                { epochMs: 130, type: 'db-cancel-terminal-received' },
            ]
        );
    });

    it('rejects extra fields, non-monotonic epochs, and cross-generation receipts', () => {
        for (const testCase of [
            {
                message: receipt({ credential: 'forbidden' }),
                receivedEpochMs: 121,
                recordGeneration: 3,
            },
            {
                message: receipt({ epochMs: 109 }),
                receivedEpochMs: 121,
                recordGeneration: 3,
            },
            {
                message: receipt({ epochMs: 122 }),
                receivedEpochMs: 121,
                recordGeneration: 3,
            },
            {
                message: receipt(),
                receivedEpochMs: 121,
                recordGeneration: 2,
            },
        ]) {
            const capture = createDatabaseWorkerCancelCapture();
            capture.start(3);
            assert.equal(capture.acceptDispatch(dispatch()), true);
            assert.equal(
                capture.acceptReceipt({
                    captureGeneration: 3,
                    ...testCase,
                }),
                false
            );
            assert.notEqual(capture.stop().invalidReasons.length, 0);
        }
    });

    it('invalidates a missing receipt separately from a missing terminal', () => {
        const missingReceipt = createDatabaseWorkerCancelCapture();
        missingReceipt.start(3);
        assert.equal(missingReceipt.acceptDispatch(dispatch()), true);
        assert.deepEqual(missingReceipt.stop().invalidReasons, [
            'cancel-receipt-missing',
            'cancel-terminal-missing',
        ]);

        const missingTerminal = createDatabaseWorkerCancelCapture();
        missingTerminal.start(3);
        assert.equal(missingTerminal.acceptDispatch(dispatch()), true);
        assert.equal(
            missingTerminal.acceptReceipt({
                captureGeneration: 3,
                message: receipt(),
                receivedEpochMs: 121,
                recordGeneration: 3,
            }),
            true
        );
        assert.deepEqual(missingTerminal.stop().invalidReasons, [
            'cancel-terminal-missing',
        ]);
    });

    it('fails neutrally for revoked or throwing proxy input', () => {
        const capture = createDatabaseWorkerCancelCapture();
        capture.start(3);
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        const throwing = new Proxy(
            {},
            {
                get() {
                    throw new Error('property access denied');
                },
                ownKeys() {
                    throw new Error('keys denied');
                },
            }
        );

        assert.doesNotThrow(() => capture.acceptDispatch(revoked.proxy));
        assert.equal(capture.acceptDispatch(revoked.proxy), false);
        assert.doesNotThrow(() => capture.acceptReceipt(throwing as never));
        assert.equal(capture.acceptReceipt(throwing as never), false);
        assert.doesNotThrow(() => capture.acceptTerminal(throwing as never));
        assert.equal(capture.acceptTerminal(throwing as never), false);
    });
});
