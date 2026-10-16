import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import type { ElectronApplication } from '@playwright/test';

import { computeJourneyIpcSerialDepth } from './journey-ipc-serial-depth';
import {
    assertJourneyMainIpcCapture,
    countJourneyMainIpcInFlight,
    detachJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    peekJourneyMainIpcCapture,
    peekJourneyMainIpcCaptures,
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
        ambiguousTimelineCompletions: 0,
        callsAfterSentinel: 2,
        callsBeforeStart: 0,
        callsBeforeSentinel: 7,
        callsByMethod: { dbGetAppPlaylists: 1, getSettings: 6 },
        inFlightByMethod: {},
        installedEpochMs: 1,
        malformedEvents: 0,
        processStartEpochMs: 0,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 2 },
        timeline: [],
        unmatchedCompletions: 0,
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
        new RegExp(
            `${JOURNEY_IPC_SENTINEL_METHOD}: \\(id: string\\) =>\\s+ipcRenderer\\.invoke\\('SOURCE_HEALTH_CANCEL', id\\)`
        )
    );
    const debugTrace = readFileSync(
        resolve(electronBackendSource, 'services/debug-trace.ts'),
        'utf8'
    );
    assert.match(debugTrace, /readFlag\('IPTVNATOR_TRACE_IPC'\)/);
});

test('the sentinel method is a no-op for an unknown id in the main process', () => {
    // The markers must not queue work ahead of the measured journey: the
    // handler only aborts a probe registered under that id, if any.
    const control = readFileSync(
        resolve(electronBackendSource, 'events/source-probe-control.ts'),
        'utf8'
    );
    assert.match(
        control,
        /ipcMain\.handle\(SOURCE_HEALTH_CANCEL, \(event, requestId: string\) => \{\s+requests\.get\(`\$\{event\.sender\.id\}:\$\{requestId\}`\)\?\.abort\(\);\s+\}\);/
    );
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
    listeners(): number;
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
        listeners: () => ipcMain.listenerCount(channel),
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
        read: () => Promise<JourneyMainIpcCaptureState>,
        stateKey: string
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
        await run(
            fake,
            () => peekJourneyMainIpcCapture(fake.app, stateKey),
            stateKey
        );
    } finally {
        const target = globalThis as unknown as Record<string, unknown>;
        delete target[stateKey];
        delete target[`${stateKey}:detach`];
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

test('records starts and completions in order between the markers', async () => {
    await withCapture(
        { startSentinelId: JOURNEY_OPEN_SOURCE_START_SENTINEL_ID },
        async (fake, read) => {
            fake.send(1, 'getSettings', []);
            fake.send(1, 'getSettings', [], 'success');
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
            ]);
            fake.send(1, 'dbGetAppPlaylist', ['playlist-1']);
            // The start marker's own completion is not part of the journey.
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [], 'success');
            fake.send(1, 'dbGetAppPlaylist', [], 'success');
            fake.send(1, 'xtreamRequest', [{ action: 'get_account_info' }]);
            fake.send(1, 'xtreamRequest', [], 'error');
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
            ]);
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [], 'success');
            fake.send(1, 'getSettings', []);
            const state = assertJourneyMainIpcCapture(await read());
            assert.deepEqual(state.timeline, [
                { method: 'dbGetAppPlaylist', phase: 'start' },
                { method: 'dbGetAppPlaylist', phase: 'end' },
                { method: 'xtreamRequest', phase: 'start' },
                { method: 'xtreamRequest', phase: 'end' },
            ]);
        }
    );
});

test('leaves out the completion of a call started before the start marker', async () => {
    await withCapture(
        { startSentinelId: JOURNEY_OPEN_SOURCE_START_SENTINEL_ID },
        async (fake, read) => {
            fake.send(1, 'dbGetAppState', []);
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
            ]);
            fake.send(1, 'dbGetAppState', [], 'success');
            fake.send(1, 'xtreamRequest', []);
            fake.send(1, 'xtreamRequest', [], 'success');
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
            ]);
            const state = assertJourneyMainIpcCapture(await read());
            assert.deepEqual(state.timeline, [
                { method: 'xtreamRequest', phase: 'start' },
                { method: 'xtreamRequest', phase: 'end' },
            ]);
            assert.doesNotThrow(() =>
                computeJourneyIpcSerialDepth(state.timeline)
            );
        }
    );
});

test('attributes an ambiguous marker-method completion outside the timeline', async () => {
    await withCapture(
        { startSentinelId: JOURNEY_OPEN_SOURCE_START_SENTINEL_ID },
        async (fake, read) => {
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
            ]);
            // An app call of the marker method overlaps the start marker.
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, ['source-1']);
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [], 'success');
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [], 'success');
            fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
                JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
            ]);
            const state = assertJourneyMainIpcCapture(await read());
            assert.equal(state.ambiguousTimelineCompletions, 1);
            // The first completion could be either call; only the second one
            // certainly belongs to the app call.
            assert.deepEqual(state.timeline, [
                { method: JOURNEY_IPC_SENTINEL_METHOD, phase: 'start' },
                { method: JOURNEY_IPC_SENTINEL_METHOD, phase: 'end' },
            ]);
        }
    );
});

test('tracks bridge calls in flight from start to success or error', async () => {
    await withCapture({}, async (fake, read) => {
        fake.send(1, 'getSettings', []);
        fake.send(1, 'getSettings', []);
        fake.send(1, 'xtreamRequest', [{ action: 'get_account_info' }]);
        let state = await read();
        assert.deepEqual(state.inFlightByMethod, {
            getSettings: 2,
            xtreamRequest: 1,
        });
        assert.equal(countJourneyMainIpcInFlight(state), 3);
        fake.send(1, 'getSettings', [], 'success');
        fake.send(1, 'xtreamRequest', [], 'error');
        fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [
            JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
        ]);
        state = await read();
        assert.deepEqual(state.inFlightByMethod, {
            [JOURNEY_IPC_SENTINEL_METHOD]: 1,
            getSettings: 1,
        });
        fake.send(1, JOURNEY_IPC_SENTINEL_METHOD, [], 'success');
        fake.send(1, 'getSettings', [], 'success');
        state = await read();
        assert.equal(countJourneyMainIpcInFlight(state), 0);
        assert.equal(state.unmatchedCompletions, 0);
        // A completion whose start this capture never saw.
        fake.send(1, 'dbGetAppState', [], 'success');
        state = await read();
        assert.equal(state.unmatchedCompletions, 1);
        assert.equal(countJourneyMainIpcInFlight(state), 0);
    });
});

test('a detached capture stops listening and keeps its last state', async () => {
    await withCapture({}, async (fake, read, stateKey) => {
        fake.send(1, 'getSettings', []);
        assert.equal(fake.listeners(), 1);
        await detachJourneyMainIpcCapture(fake.app, stateKey);
        assert.equal(fake.listeners(), 0);
        fake.send(1, 'getSettings', []);
        fake.send(1, 'dbGetAppState', []);
        const state = await read();
        assert.equal(state.callsBeforeSentinel, 1);
        assert.deepEqual(state.inFlightByMethod, { getSettings: 1 });
        await assert.rejects(
            detachJourneyMainIpcCapture(fake.app, stateKey),
            /not-attached/
        );
    });
});

test('reads several captures in one main-process pass', async () => {
    const fake = createFakeElectronApp();
    let evaluations = 0;
    const counting = {
        evaluate: (...args: Parameters<ElectronApplication['evaluate']>) => {
            evaluations += 1;
            return fake.app.evaluate(...args);
        },
    } as unknown as ElectronApplication;
    const target = globalThis as unknown as Record<string, unknown>;
    const [first, second] = ['__journeyPeekA', '__journeyPeekB'];
    target[first] = { callsBeforeStart: 1 };
    target[second] = { callsBeforeStart: 2 };
    try {
        const states = await peekJourneyMainIpcCaptures(counting, [
            first,
            second,
        ]);
        assert.equal(evaluations, 1);
        assert.deepEqual(
            states.map((state) => state.callsBeforeStart),
            [1, 2]
        );
        await assert.rejects(
            peekJourneyMainIpcCaptures(counting, [
                first,
                '__journeyPeekMissing',
            ]),
            /capture-missing/
        );
    } finally {
        delete target[first];
        delete target[second];
    }
});
