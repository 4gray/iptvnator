import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
    assertJourneyMainIpcCapture,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    type JourneyMainIpcCaptureState,
} from './journey-main-ipc-capture';
import { JOURNEY_IPC_SENTINEL_METHOD } from './journey-renderer-probe';

const electronBackendSource = resolve(
    __dirname,
    '../../../electron-backend/src/app'
);

function validCapture(
    overrides: Partial<JourneyMainIpcCaptureState> = {}
): JourneyMainIpcCaptureState {
    return {
        callsAfterSentinel: 2,
        callsBeforeSentinel: 7,
        callsByMethod: { dbGetAppPlaylists: 1, getSettings: 6 },
        installedEpochMs: 1,
        malformedEvents: 0,
        processStartEpochMs: 0,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 2 },
        ...overrides,
    };
}

test('the trace channel literal matches the main-process constant', () => {
    const source = readFileSync(
        resolve(electronBackendSource, 'services/debug-trace.ts'),
        'utf8'
    );
    assert.match(
        source,
        new RegExp(
            `DEBUG_TRACE_EVENT_CHANNEL = '${JOURNEY_RENDERER_API_TRACE_CHANNEL}'`
        )
    );
});

test('the preload traces every bridge invocation on that channel when IPC tracing is on', () => {
    const preload = readFileSync(
        resolve(electronBackendSource, 'api/main.preload.ts'),
        'utf8'
    );
    assert.match(
        preload,
        /ipcRenderer\.send\(DEBUG_TRACE_EVENT_CHANNEL, payload\)/
    );
    assert.match(preload, /name\.startsWith\('on'\)/);
    assert.match(preload, /name\.startsWith\('remove'\)/);
    assert.match(
        preload,
        new RegExp(`${JOURNEY_IPC_SENTINEL_METHOD}: \\(playlistId: string`)
    );
    const debugTrace = readFileSync(
        resolve(electronBackendSource, 'services/debug-trace.ts'),
        'utf8'
    );
    assert.match(debugTrace, /readFlag\('IPTVNATOR_TRACE_IPC'\)/);
});

test('accepts a capture with exactly one sentinel from one renderer', () => {
    assert.equal(
        assertJourneyMainIpcCapture(validCapture()).callsBeforeSentinel,
        7
    );
});

test('rejects captures that cannot bound the counter exactly', () => {
    assert.throws(() => assertJourneyMainIpcCapture(null), /missing/);
    assert.throws(
        () =>
            assertJourneyMainIpcCapture(
                validCapture({
                    sentinel: { occurrences: 0, receivedEpochMs: null },
                })
            ),
        /sentinel-count-0/
    );
    assert.throws(
        () =>
            assertJourneyMainIpcCapture(
                validCapture({
                    sentinel: { occurrences: 2, receivedEpochMs: 2 },
                })
            ),
        /sentinel-count-2/
    );
    assert.throws(
        () => assertJourneyMainIpcCapture(validCapture({ senderIds: [1, 2] })),
        /senders-2/
    );
    assert.throws(
        () => assertJourneyMainIpcCapture(validCapture({ malformedEvents: 1 })),
        /malformed/
    );
});
