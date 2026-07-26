/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
/* eslint-disable max-lines -- The one-shot transport contract keeps all terminal-path fixtures together. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

type WorkerUnavailableReason =
    'capture-failed' | 'gc-unavailable' | 'profiling-disabled' | 'worker-busy';

type MainUnavailableReason =
    | 'post-gc-probe-invalid-response'
    | 'post-gc-probe-message-error'
    | 'post-gc-probe-port-closed'
    | 'post-gc-probe-post-failed'
    | 'post-gc-probe-timeout';

type ProbeUnavailableReason = WorkerUnavailableReason | MainUnavailableReason;

type ProbeResult =
    | {
          readonly postGcHeapUsedBytes: number;
          readonly unavailableReason: null;
      }
    | {
          readonly postGcHeapUsedBytes: null;
          readonly unavailableReason: ProbeUnavailableReason;
      };

interface ProbePort {
    close(): void;
    off(event: 'close', listener: () => void): unknown;
    off(event: 'message', listener: (message: unknown) => void): unknown;
    off(event: 'messageerror', listener: (error: unknown) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    on(event: 'message', listener: (message: unknown) => void): unknown;
    on(event: 'messageerror', listener: (error: unknown) => void): unknown;
    postMessage(message: unknown): void;
    start(): void;
}

interface ProbeWorker {
    postMessage(message: unknown, transferList: readonly unknown[]): void;
}

interface ProbeTimers {
    clearTimeout(handle: unknown): void;
    setTimeout(callback: () => void, delayMs: number): unknown;
}

interface ProbeApi {
    probe(input: {
        readonly createMessageChannel: () => {
            readonly port1: ProbePort;
            readonly port2: ProbePort;
        };
        readonly timeoutMs?: number;
        readonly timers?: ProbeTimers;
        readonly worker: ProbeWorker;
    }): Promise<ProbeResult>;
}

interface ProbeModule {
    createDatabaseWorkerPostGcProbeApi?: () => ProbeApi;
}

const probeModulePromise = import(
    new URL('./database-worker-post-gc-probe.ts', import.meta.url).href
)
    .then((module) => module as ProbeModule)
    .catch(() => null);

class FakePort extends EventEmitter implements ProbePort {
    closeCalls = 0;
    peer: FakePort | null = null;
    startCalls = 0;

    close(): void {
        this.closeCalls += 1;
    }

    postMessage(message: unknown): void {
        this.peer?.emit('message', message);
    }

    start(): void {
        this.startCalls += 1;
    }
}

class FakeTimers implements ProbeTimers {
    readonly cleared: unknown[] = [];
    readonly scheduled: {
        readonly callback: () => void;
        readonly delayMs: number;
        readonly handle: number;
    }[] = [];
    private nextHandle = 1;

    clearTimeout(handle: unknown): void {
        this.cleared.push(handle);
    }

    fire(handle: number): void {
        const timer = this.scheduled.find(
            (candidate) => candidate.handle === handle
        );
        assert.ok(timer, `timer ${handle} must exist`);
        timer.callback();
    }

    setTimeout(callback: () => void, delayMs: number): number {
        const handle = this.nextHandle;
        this.nextHandle += 1;
        this.scheduled.push({ callback, delayMs, handle });
        return handle;
    }
}

interface ProbeHarness {
    readonly createMessageChannel: () => {
        readonly port1: FakePort;
        readonly port2: FakePort;
    };
    readonly port1: FakePort;
    readonly port2: FakePort;
    readonly timers: FakeTimers;
}

function createProbeHarness(): ProbeHarness {
    const port1 = new FakePort();
    const port2 = new FakePort();
    port1.peer = port2;
    port2.peer = port1;
    const timers = new FakeTimers();

    return {
        createMessageChannel: () => ({ port1, port2 }),
        port1,
        port2,
        timers,
    };
}

async function restoreSerializableApi(): Promise<ProbeApi> {
    const module = await probeModulePromise;
    assert.ok(module, 'database worker post-GC probe module must exist');
    const factory = module.createDatabaseWorkerPostGcProbeApi;
    assert.equal(typeof factory, 'function');

    const source = factory.toString();
    assert.doesNotMatch(source, /__name/);
    const restoredFactory = Function(
        `"use strict"; return (${source});`
    )() as () => ProbeApi;
    return restoredFactory();
}

function assertCoherentResult(result: ProbeResult): void {
    const hasHeap =
        Number.isSafeInteger(result.postGcHeapUsedBytes) &&
        Number(result.postGcHeapUsedBytes) >= 0;
    assert.equal(
        hasHeap,
        result.unavailableReason === null,
        'probe result must preserve the heap/reason XOR'
    );
}

function cleanupCounts(port: FakePort): Record<string, number> {
    return {
        close: port.listenerCount('close'),
        message: port.listenerCount('message'),
        messageerror: port.listenerCount('messageerror'),
    };
}

test('serializes the factory and sends the exact one-shot worker request with its transfer port', async () => {
    const api = await restoreSerializableApi();
    const harness = createProbeHarness();
    let postedMessage: unknown;
    let postedTransferList: readonly unknown[] | null = null;
    let terminateCalls = 0;
    const worker = {
        postMessage(message: unknown, transferList: readonly unknown[]): void {
            postedMessage = message;
            postedTransferList = transferList;
            const responsePort = (
                message as { readonly responsePort: ProbePort }
            ).responsePort;
            responsePort.postMessage({
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes: 73_728,
                unavailableReason: null,
            });
        },
        terminate(): void {
            terminateCalls += 1;
        },
    };

    const result = await api.probe({
        createMessageChannel: harness.createMessageChannel,
        timers: harness.timers,
        worker,
    });

    assert.deepEqual(postedMessage, {
        type: 'performance:collect-post-gc-heap',
        responsePort: harness.port2,
    });
    assert.deepEqual(postedTransferList, [harness.port2]);
    assert.deepEqual(result, {
        postGcHeapUsedBytes: 73_728,
        unavailableReason: null,
    });
    assertCoherentResult(result);
    assert.equal(harness.port1.startCalls, 1);
    assert.equal(harness.port1.closeCalls, 1);
    assert.deepEqual(cleanupCounts(harness.port1), {
        close: 0,
        message: 0,
        messageerror: 0,
    });
    assert.deepEqual(
        harness.timers.scheduled.map((timer) => timer.delayMs),
        [5_000]
    );
    assert.deepEqual(harness.timers.cleared, [1]);
    assert.equal(terminateCalls, 0);
});

test('preserves every coherent worker-side unavailable result', async () => {
    const api = await restoreSerializableApi();
    const reasons: readonly WorkerUnavailableReason[] = [
        'capture-failed',
        'gc-unavailable',
        'profiling-disabled',
        'worker-busy',
    ];

    for (const unavailableReason of reasons) {
        const harness = createProbeHarness();
        const result = await api.probe({
            createMessageChannel: harness.createMessageChannel,
            timers: harness.timers,
            worker: {
                postMessage(message: unknown): void {
                    (
                        message as { readonly responsePort: ProbePort }
                    ).responsePort.postMessage({
                        type: 'performance:post-gc-heap-result',
                        postGcHeapUsedBytes: null,
                        unavailableReason,
                    });
                },
            },
        });

        assert.deepEqual(result, {
            postGcHeapUsedBytes: null,
            unavailableReason,
        });
        assertCoherentResult(result);
    }
});

test('fails closed for malformed or incoherent worker responses', async () => {
    const api = await restoreSerializableApi();
    const malformedResponses: readonly unknown[] = [
        null,
        [],
        {
            type: 'wrong-result',
            postGcHeapUsedBytes: 1,
            unavailableReason: null,
        },
        {
            type: 'performance:post-gc-heap-result',
            postGcHeapUsedBytes: 1,
            unavailableReason: 'capture-failed',
        },
        {
            type: 'performance:post-gc-heap-result',
            postGcHeapUsedBytes: null,
            unavailableReason: null,
        },
        {
            type: 'performance:post-gc-heap-result',
            postGcHeapUsedBytes: null,
            unavailableReason: 'unknown-reason',
        },
        ...[-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map(
            (postGcHeapUsedBytes) => ({
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes,
                unavailableReason: null,
            })
        ),
        {
            type: 'performance:post-gc-heap-result',
            postGcHeapUsedBytes: Number.MAX_SAFE_INTEGER + 1,
            unavailableReason: null,
        },
    ];

    for (const response of malformedResponses) {
        const harness = createProbeHarness();
        const result = await api.probe({
            createMessageChannel: harness.createMessageChannel,
            timers: harness.timers,
            worker: {
                postMessage(message: unknown): void {
                    (
                        message as { readonly responsePort: ProbePort }
                    ).responsePort.postMessage(response);
                },
            },
        });

        assert.deepEqual(result, {
            postGcHeapUsedBytes: null,
            unavailableReason: 'post-gc-probe-invalid-response',
        });
        assertCoherentResult(result);
    }
});

test('times out once with an injectable deadline and ignores every later terminal signal', async () => {
    const api = await restoreSerializableApi();
    const harness = createProbeHarness();
    let terminateCalls = 0;
    const resultPromise = api.probe({
        createMessageChannel: harness.createMessageChannel,
        timeoutMs: 37,
        timers: harness.timers,
        worker: {
            postMessage(): void {
                // Keep the one-shot probe pending until its bounded deadline.
            },
            terminate(): void {
                terminateCalls += 1;
            },
        },
    });
    const timer = harness.timers.scheduled[0];
    assert.ok(timer);
    assert.equal(timer.delayMs, 37);

    harness.timers.fire(timer.handle);
    const result = await resultPromise;
    harness.port1.emit('message', {
        type: 'performance:post-gc-heap-result',
        postGcHeapUsedBytes: 99,
        unavailableReason: null,
    });
    harness.port1.emit('messageerror', new Error('late message error'));
    harness.port1.emit('close');
    timer.callback();

    assert.deepEqual(result, {
        postGcHeapUsedBytes: null,
        unavailableReason: 'post-gc-probe-timeout',
    });
    assertCoherentResult(result);
    assert.equal(harness.port1.closeCalls, 1);
    assert.deepEqual(cleanupCounts(harness.port1), {
        close: 0,
        message: 0,
        messageerror: 0,
    });
    assert.deepEqual(harness.timers.cleared, [timer.handle]);
    assert.equal(terminateCalls, 0);
});

test('maps message errors and an early response-port close to fixed reasons', async () => {
    const api = await restoreSerializableApi();
    const cases = [
        {
            emit(port: FakePort): void {
                port.emit('messageerror', new Error('clone failed'));
            },
            reason: 'post-gc-probe-message-error',
        },
        {
            emit(port: FakePort): void {
                port.emit('close');
            },
            reason: 'post-gc-probe-port-closed',
        },
    ] as const;

    for (const testCase of cases) {
        const harness = createProbeHarness();
        const resultPromise = api.probe({
            createMessageChannel: harness.createMessageChannel,
            timers: harness.timers,
            worker: {
                postMessage(): void {
                    testCase.emit(harness.port1);
                },
            },
        });

        const result = await resultPromise;
        assert.deepEqual(result, {
            postGcHeapUsedBytes: null,
            unavailableReason: testCase.reason,
        });
        assertCoherentResult(result);
        assert.equal(harness.port1.closeCalls, 1);
        assert.deepEqual(cleanupCounts(harness.port1), {
            close: 0,
            message: 0,
            messageerror: 0,
        });
    }
});

test('closes both ports and reports a fixed reason when the request cannot be posted', async () => {
    const api = await restoreSerializableApi();
    const harness = createProbeHarness();

    const result = await api.probe({
        createMessageChannel: harness.createMessageChannel,
        timers: harness.timers,
        worker: {
            postMessage(): void {
                throw new Error('worker already exited');
            },
        },
    });

    assert.deepEqual(result, {
        postGcHeapUsedBytes: null,
        unavailableReason: 'post-gc-probe-post-failed',
    });
    assertCoherentResult(result);
    assert.equal(harness.port1.closeCalls, 1);
    assert.equal(harness.port2.closeCalls, 1);
    assert.deepEqual(cleanupCounts(harness.port1), {
        close: 0,
        message: 0,
        messageerror: 0,
    });
    assert.deepEqual(harness.timers.cleared, [1]);
});
