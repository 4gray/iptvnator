/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
    installDatabaseRequestIdentityCaptureInMain,
    type DatabaseRequestIdentityCaptureApi,
} from './database-request-identity-capture';

const CHANNEL = 'IPTVNATOR_PERF_CAPTURE_MARKER';
let nextStateId = 1;

function createCapture(): {
    api: DatabaseRequestIdentityCaptureApi;
    ipcMain: EventEmitter;
} {
    const ipcMain = new EventEmitter();
    const stateKey = `__identityCapture${nextStateId}`;
    nextStateId += 1;
    installDatabaseRequestIdentityCaptureInMain({ ipcMain } as never, stateKey);
    const api = (globalThis as unknown as Record<string, unknown>)[
        stateKey
    ] as DatabaseRequestIdentityCaptureApi;
    api.start();
    return { api, ipcMain };
}

function marker(overrides: Record<string, unknown> = {}) {
    return {
        correlationState: 'correlated',
        invalidReason: null,
        ipcCallId: 2,
        method: 'dbGetAppPlaylist',
        operationId: 'refresh-operation-1',
        phase: 'start',
        playlistId: 'playlist-1',
        sourceEpochMs: 100,
        ...overrides,
    };
}

test('correlates the real preload marker to a DB request whose payload omits operationId', () => {
    const { api, ipcMain } = createCapture();
    ipcMain.emit(CHANNEL, {}, marker());

    const identity = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-1',
        type: 'request',
    });

    assert.deepEqual(identity, {
        ipcCallId: 2,
        operationId: 'refresh-operation-1',
        operationIdUnavailableReason: null,
        sourceEpochMs: 100,
    });
});

test('retains the initial-import upsert marker when its operationId is intentionally uncorrelated', () => {
    const { api, ipcMain } = createCapture();
    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            correlationState: 'uncorrelated',
            ipcCallId: 7,
            method: 'dbUpsertAppPlaylist',
            operationId: null,
            sourceEpochMs: 1_077.25,
        })
    );

    const identity = api.matchDatabaseRequest({
        operation: 'DB_UPSERT_APP_PLAYLIST',
        payload: { _id: 'playlist-1' },
        requestId: 'initial-import-upsert',
        type: 'request',
    });

    assert.deepEqual(identity, {
        ipcCallId: 7,
        operationId: null,
        operationIdUnavailableReason: 'preload-performance-marker-uncorrelated',
        sourceEpochMs: 1_077.25,
    });
});

test('captures exact successful preload completion markers for DB return-clone attribution', () => {
    const { api, ipcMain } = createCapture();
    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            correlationState: 'uncorrelated',
            ipcCallId: 7,
            method: 'dbUpsertAppPlaylist',
            operationId: null,
            phase: 'success',
            sourceEpochMs: 140.25,
        })
    );
    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            correlationState: 'uncorrelated',
            ipcCallId: 8,
            operationId: null,
            phase: 'success',
            sourceEpochMs: 175.5,
        })
    );

    assert.equal(api.successMarkerCount(), 2);
    assert.deepEqual(api.takeSuccessMarkers(), [
        {
            ipcCallId: 7,
            operation: 'DB_UPSERT_APP_PLAYLIST',
            operationId: null,
            playlistId: 'playlist-1',
            sourceEpochMs: 140.25,
        },
        {
            ipcCallId: 8,
            operation: 'DB_GET_APP_PLAYLIST',
            operationId: null,
            playlistId: 'playlist-1',
            sourceEpochMs: 175.5,
        },
    ]);
    assert.equal(api.successMarkerCount(), 0);
    assert.deepEqual(api.takeSuccessMarkers(), []);
});

test('fails closed for malformed or invalid successful preload markers and resets completions', () => {
    const { api, ipcMain } = createCapture();
    for (const invalid of [
        { invalidReason: 'out-of-order' },
        { correlationState: 'invalid' },
        { ipcCallId: 0 },
        { playlistId: '' },
        { sourceEpochMs: Number.NaN },
        { method: 'refreshPlaylist' },
        { correlationState: 'correlated', operationId: null },
    ]) {
        ipcMain.emit(
            CHANNEL,
            {},
            marker({
                phase: 'success',
                ...invalid,
            })
        );
    }
    assert.equal(api.successMarkerCount(), 0);
    assert.deepEqual(api.takeSuccessMarkers(), []);

    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            phase: 'success',
        })
    );
    api.stop();
    api.start();
    assert.equal(api.successMarkerCount(), 0);
    assert.deepEqual(api.takeSuccessMarkers(), []);
});

test('resolves a response-retained request identity when the marker arrives later and resets between captures', () => {
    const { api, ipcMain } = createCapture();
    const identity = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-before-marker',
        type: 'request',
    });
    assert.equal(
        identity.operationIdUnavailableReason,
        'preload-performance-marker-missing'
    );
    const responseOutcome = { identity };

    ipcMain.emit(CHANNEL, {}, marker());
    assert.deepEqual(responseOutcome.identity, {
        ipcCallId: 2,
        operationId: 'refresh-operation-1',
        operationIdUnavailableReason: null,
        sourceEpochMs: 100,
    });

    api.stop();
    ipcMain.emit(CHANNEL, {}, marker({ operationId: 'marker-while-stopped' }));
    api.start();
    const afterReset = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-after-reset',
        type: 'request',
    });
    assert.deepEqual(afterReset, {
        ipcCallId: null,
        operationId: null,
        operationIdUnavailableReason: 'preload-performance-marker-missing',
        sourceEpochMs: null,
    });
});

test('fails closed for missing and ambiguous preload markers', () => {
    const missingCapture = createCapture();
    const missing = missingCapture.api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-missing',
        type: 'request',
    });
    assert.deepEqual(missing, {
        ipcCallId: null,
        operationId: null,
        operationIdUnavailableReason: 'preload-performance-marker-missing',
        sourceEpochMs: null,
    });

    const ambiguousCapture = createCapture();
    ambiguousCapture.ipcMain.emit(CHANNEL, {}, marker());
    ambiguousCapture.ipcMain.emit(
        CHANNEL,
        {},
        marker({
            ipcCallId: 3,
            operationId: 'refresh-operation-2',
        })
    );
    const ambiguous = ambiguousCapture.api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-ambiguous',
        type: 'request',
    });
    assert.deepEqual(ambiguous, {
        ipcCallId: null,
        operationId: null,
        operationIdUnavailableReason: 'preload-performance-marker-ambiguous',
        sourceEpochMs: null,
    });
});

test('quarantines a key after response-before-marker ambiguity', () => {
    const { api, ipcMain } = createCapture();
    const requestA = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-a',
        type: 'request',
    });
    const requestB = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-b',
        type: 'request',
    });

    ipcMain.emit(
        CHANNEL,
        {},
        marker({ ipcCallId: 2, operationId: 'refresh-operation-a' })
    );
    ipcMain.emit(
        CHANNEL,
        {},
        marker({ ipcCallId: 3, operationId: 'refresh-operation-b' })
    );

    const requestC = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'request-c',
        type: 'request',
    });
    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            ipcCallId: 4,
            operationId: 'other-playlist-operation',
            playlistId: 'playlist-2',
        })
    );
    const otherPlaylist = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-2' },
        requestId: 'other-playlist-request',
        type: 'request',
    });
    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            ipcCallId: 5,
            method: 'dbUpsertAppPlaylist',
            operationId: 'other-db-operation',
        })
    );
    const otherOperation = api.matchDatabaseRequest({
        operation: 'DB_UPSERT_APP_PLAYLIST',
        payload: { _id: 'playlist-1' },
        requestId: 'other-operation-request',
        type: 'request',
    });

    const ambiguousIdentity = {
        ipcCallId: null,
        operationId: null,
        operationIdUnavailableReason: 'preload-performance-marker-ambiguous',
        sourceEpochMs: null,
    };
    assert.deepEqual(requestA, ambiguousIdentity);
    assert.deepEqual(requestB, ambiguousIdentity);
    assert.deepEqual(requestC, ambiguousIdentity);
    assert.deepEqual(otherPlaylist, {
        ipcCallId: 4,
        operationId: 'other-playlist-operation',
        operationIdUnavailableReason: null,
        sourceEpochMs: 100,
    });
    assert.deepEqual(otherOperation, {
        ipcCallId: 5,
        operationId: 'other-db-operation',
        operationIdUnavailableReason: null,
        sourceEpochMs: 100,
    });

    api.stop();
    api.start();
    ipcMain.emit(
        CHANNEL,
        {},
        marker({
            ipcCallId: 6,
            operationId: 'fresh-capture-operation',
        })
    );
    const freshCaptureIdentity = api.matchDatabaseRequest({
        operation: 'DB_GET_APP_PLAYLIST',
        payload: { playlistId: 'playlist-1' },
        requestId: 'fresh-capture-request',
        type: 'request',
    });
    assert.deepEqual(freshCaptureIdentity, {
        ipcCallId: 6,
        operationId: 'fresh-capture-operation',
        operationIdUnavailableReason: null,
        sourceEpochMs: 100,
    });
});
