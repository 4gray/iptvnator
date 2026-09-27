import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import type { ElectronApplication } from '@playwright/test';

import {
    assertJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    peekJourneyMainIpcCapture,
    type JourneyMainIpcCaptureOptions,
    type JourneyMainIpcCaptureState,
} from './journey-main-ipc-capture';
import {
    JOURNEY_IPC_SENTINEL_METHOD,
    JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
    JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
} from './journey-renderer-probe';

const electronBackendSource = resolve(
    __dirname,
    '../../../electron-backend/src/app'
);

function validCapture(
    overrides: Partial<JourneyMainIpcCaptureState> = {}
): JourneyMainIpcCaptureState {
    return {
        callsAfterSentinel: 2,
        callsBeforeStart: 0,
        callsBeforeSentinel: 7,
        callsByMethod: { dbGetAppPlaylists: 1, getSettings: 6 },
        installedEpochMs: 1,
        malformedEvents: 0,
        processStartEpochMs: 0,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 2 },
        start: null,
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

/**
 * Runs the capture's main-process function in this process against a fake
 * `ipcMain`, the way `electronApp.evaluate` runs it in Electron.
 */
function createFakeElectronApp(): {
    readonly app: ElectronApplication;
    send(
        senderId: number,
        method: string,
        args: unknown[],
        phase?: string
    ): void;
} {
    const ipcMain = new EventEmitter();
    let channel = '';
    const app = {
        evaluate: async (
            fn: (electron: unknown, arg: unknown) => unknown,
            arg: unknown
        ) => {
            channel =
                (arg as Partial<JourneyMainIpcCaptureOptions>).channel ??
                channel;
            return fn({ ipcMain }, arg);
        },
    } as unknown as ElectronApplication;
    return {
        app,
        send: (senderId, method, args, phase = 'start') => {
            ipcMain.emit(
                channel,
                { sender: { id: senderId } },
                { args, method, phase }
            );
        },
    };
}

async function withCapture(
    options: Partial<JourneyMainIpcCaptureOptions>,
    run: (
        fake: ReturnType<typeof createFakeElectronApp>,
        read: () => Promise<JourneyMainIpcCaptureState>
    ) => Promise<void>
): Promise<void> {
    const stateKey = `__journeyIpcCaptureTest${Math.random()}`;
    const fake = createFakeElectronApp();
    try {
        await installJourneyMainIpcCapture(fake.app, {
            channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
            sentinelId: JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
            sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
            stateKey,
            ...options,
        });
        await run(fake, () => peekJourneyMainIpcCapture(fake.app, stateKey));
    } finally {
        delete (globalThis as unknown as Record<string, unknown>)[stateKey];
    }
}

test('without a start marker, counts every call from install to the sentinel', async () => {
    await withCapture({}, async (fake, read) => {
        fake.send(1, 'getSettings', []);
        fake.send(1, 'getSettings', [], 'end');
        fake.send(1, 'onSomething', []);
        fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
            JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
        ]);
        fake.send(1, 'dbGetAppPlaylists', []);
        const state = assertJourneyMainIpcCapture(await read());
        assert.equal(state.start, null);
        assert.equal(state.callsBeforeStart, 0);
        assert.equal(state.callsBeforeSentinel, 2);
        assert.equal(state.callsAfterSentinel, 1);
        assert.deepEqual(state.callsByMethod, {
            getSettings: 1,
            onSomething: 1,
        });
    });
});

test('with a start marker, counts only the calls between the two sentinels', async () => {
    await withCapture(
        { startSentinelId: JOURNEY_OPEN_SOURCE_START_SENTINEL_ID },
        async (fake, read) => {
            fake.send(1, 'getSettings', []);
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, ['other-playlist']);
            assert.equal((await read()).callsBeforeStart, 2);
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
            ]);
            fake.send(1, 'dbGetAppPlaylist', ['playlist-1']);
            fake.send(1, 'xtreamRequest', [{ action: 'get_account_info' }]);
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
            ]);
            fake.send(1, 'getSettings', []);
            const state = assertJourneyMainIpcCapture(await read());
            assert.equal(state.callsBeforeStart, 2);
            assert.equal(state.callsBeforeSentinel, 2);
            assert.equal(state.callsAfterSentinel, 1);
            assert.deepEqual(state.callsByMethod, {
                dbGetAppPlaylist: 1,
                xtreamRequest: 1,
            });
            assert.equal(state.start?.occurrences, 1);
        }
    );
});

test('rejects a start marker that is missing, repeated or after the sentinel', async () => {
    await withCapture(
        { startSentinelId: JOURNEY_OPEN_SOURCE_START_SENTINEL_ID },
        async (fake, read) => {
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
            ]);
            const early = await read();
            const state = () => early;
            assert.throws(
                () => assertJourneyMainIpcCapture(state()),
                /start-count-0/
            );
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
            ]);
            const late = await read();
            assert.equal(late.start?.occurrences, 1);
            assert.throws(
                () => assertJourneyMainIpcCapture(late),
                /sentinel-before-start/
            );
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
            ]);
            const repeated = await read();
            assert.throws(
                () => assertJourneyMainIpcCapture(repeated),
                /start-count-2/
            );
        }
    );
    assert.throws(
        () =>
            assertJourneyMainIpcCapture(
                validCapture({
                    start: { occurrences: 1, receivedEpochMs: 3 },
                })
            ),
        /sentinel-before-start/
    );
    assert.throws(
        () =>
            assertJourneyMainIpcCapture(
                validCapture({
                    start: { occurrences: 1, receivedEpochMs: null },
                })
            ),
        /sentinel-before-start/
    );
    assert.throws(
        () =>
            assertJourneyMainIpcCapture(
                validCapture({
                    start: { occurrences: 2, receivedEpochMs: 1 },
                })
            ),
        /start-count-2/
    );
    assert.equal(
        assertJourneyMainIpcCapture(
            validCapture({ start: { occurrences: 1, receivedEpochMs: 1 } })
        ).callsBeforeSentinel,
        7
    );
});
