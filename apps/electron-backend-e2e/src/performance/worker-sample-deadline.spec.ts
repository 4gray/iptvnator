/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface WorkerSampleDeadlineIdentity {
    readonly captureGeneration: number;
    readonly recordGeneration: number | null;
    readonly sampleKey: object;
}

type WorkerSampleDeadlineOutcome =
    | { readonly status: 'completed' }
    | { readonly error: unknown; readonly status: 'failed' }
    | { readonly status: 'stale' }
    | { readonly status: 'timed-out' };

interface WorkerSampleDeadlineApi {
    run<T>(input: {
        readonly apply: (value: T) => void;
        readonly capturedGeneration: number | null;
        readonly currentIdentity: () => WorkerSampleDeadlineIdentity;
        readonly onTimeout: () => void;
        readonly operation: () => Promise<T>;
        readonly sampleKey: object;
        readonly timers?: WorkerSampleDeadlineTimers;
        readonly timeoutMs: number;
    }): Promise<WorkerSampleDeadlineOutcome>;
}

interface WorkerSampleDeadlineTimers {
    clearTimeout(handle: unknown): void;
    setTimeout(callback: () => void, timeoutMs: number): unknown;
}

interface WorkerSampleDeadlineModule {
    createWorkerSampleDeadlineApi?: () => WorkerSampleDeadlineApi;
}

const modulePromise = import(
    new URL('./worker-sample-deadline.ts', import.meta.url).href
)
    .then((module) => module as WorkerSampleDeadlineModule)
    .catch(() => null);

function deferred<T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createScheduler(): WorkerSampleDeadlineTimers & {
    readonly activeCount: () => number;
    readonly fireNext: () => void;
} {
    const tasks = new Map<unknown, () => void>();

    return {
        activeCount: () => tasks.size,
        clearTimeout(handle: unknown): void {
            tasks.delete(handle);
        },
        fireNext(): void {
            const next = tasks.entries().next().value as
                [unknown, () => void] | undefined;
            assert.ok(next, 'expected one pending deadline');
            tasks.delete(next[0]);
            next[1]();
        },
        setTimeout(callback): object {
            const handle = {};
            tasks.set(handle, callback);
            return handle;
        },
    };
}

async function restoreSerializableApi(): Promise<WorkerSampleDeadlineApi> {
    const module = await modulePromise;
    assert.ok(module, 'worker sample deadline module must exist');
    const factory = module.createWorkerSampleDeadlineApi;
    assert.equal(typeof factory, 'function');

    const source = factory.toString();
    assert.doesNotMatch(source, /__name/);
    const restoredFactory = Function(
        `"use strict"; return (${source});`
    )() as () => WorkerSampleDeadlineApi;
    return restoredFactory();
}

test('applies a worker sample only while its generation and identity are current', async () => {
    const scheduler = createScheduler();
    const api = await restoreSerializableApi();
    const operation = deferred<number>();
    const sampleKey = {};
    const applied: number[] = [];

    const outcomePromise = api.run({
        apply: (value) => applied.push(value),
        capturedGeneration: 7,
        currentIdentity: () => ({
            captureGeneration: 7,
            recordGeneration: 7,
            sampleKey,
        }),
        onTimeout: () => assert.fail('the operation completed in time'),
        operation: () => operation.promise,
        sampleKey,
        timers: scheduler,
        timeoutMs: 5_000,
    });
    operation.resolve(42);

    assert.deepEqual(await outcomePromise, { status: 'completed' });
    assert.deepEqual(applied, [42]);
    assert.equal(scheduler.activeCount(), 0);
});

test('ignores an already queued deadline callback after successful completion', async () => {
    const api = await restoreSerializableApi();
    const operation = deferred<number>();
    const sampleKey = {};
    const applied: number[] = [];
    let queuedTimeout: (() => void) | null = null;
    let timeoutCount = 0;
    const timers: WorkerSampleDeadlineTimers = {
        clearTimeout(): void {
            // The callback may already be queued when cancellation runs.
        },
        setTimeout(callback): object {
            queuedTimeout = callback;
            return {};
        },
    };

    const outcomePromise = api.run({
        apply: (value) => applied.push(value),
        capturedGeneration: 8,
        currentIdentity: () => ({
            captureGeneration: 8,
            recordGeneration: 8,
            sampleKey,
        }),
        onTimeout: () => {
            timeoutCount += 1;
        },
        operation: () => operation.promise,
        sampleKey,
        timers,
        timeoutMs: 5_000,
    });
    operation.resolve(43);

    assert.deepEqual(await outcomePromise, { status: 'completed' });
    assert.deepEqual(applied, [43]);
    assert.ok(queuedTimeout);
    queuedTimeout();
    assert.equal(timeoutCount, 0);
    assert.deepEqual(applied, [43]);
});

test('times out a stalled sample and ignores its late result', async () => {
    const scheduler = createScheduler();
    const api = await restoreSerializableApi();
    const operation = deferred<number>();
    const sampleKey = {};
    const applied: number[] = [];
    let timeoutCount = 0;

    const outcomePromise = api.run({
        apply: (value) => applied.push(value),
        capturedGeneration: 11,
        currentIdentity: () => ({
            captureGeneration: 11,
            recordGeneration: 11,
            sampleKey,
        }),
        onTimeout: () => {
            timeoutCount += 1;
        },
        operation: () => operation.promise,
        sampleKey,
        timers: scheduler,
        timeoutMs: 5_000,
    });
    scheduler.fireNext();

    assert.deepEqual(await outcomePromise, { status: 'timed-out' });
    assert.equal(timeoutCount, 1);
    assert.deepEqual(applied, []);

    operation.resolve(99);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(
        applied,
        [],
        'a non-cancellable Worker promise must not mutate capture state after its deadline'
    );
});

test('fails closed when capture rollover makes a pending sample stale', async () => {
    const scheduler = createScheduler();
    const api = await restoreSerializableApi();
    const operation = deferred<number>();
    const sampleKey = {};
    const applied: number[] = [];
    let currentGeneration = 4;

    const outcomePromise = api.run({
        apply: (value) => applied.push(value),
        capturedGeneration: 4,
        currentIdentity: () => ({
            captureGeneration: currentGeneration,
            recordGeneration: currentGeneration,
            sampleKey,
        }),
        onTimeout: () => assert.fail('a stale sample is not a timeout'),
        operation: () => operation.promise,
        sampleKey,
        timers: scheduler,
        timeoutMs: 5_000,
    });
    currentGeneration = 5;
    operation.resolve(7);

    assert.deepEqual(await outcomePromise, { status: 'stale' });
    assert.deepEqual(applied, []);
    assert.equal(scheduler.activeCount(), 0);
});

test('the main capture bounds worker sampling and invalidates timed-out evidence', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const sampleWorkerStart = source.indexOf('const sampleWorker =');
    const sampleWorkerEnd = source.indexOf(
        'const resetWorkerForCapture',
        sampleWorkerStart
    );
    const sampleWorker = source.slice(sampleWorkerStart, sampleWorkerEnd);
    const startCaptureStart = source.indexOf('const startCapture =');
    const startCaptureEnd = source.indexOf('const api =', startCaptureStart);
    const startCapture = source.slice(startCaptureStart, startCaptureEnd);
    const apiStartStart = source.indexOf(
        'start: async (options: MainCaptureStartOptions)'
    );
    const apiStartEnd = source.indexOf(
        'beginMeasurement: async',
        apiStartStart
    );
    const apiStart = source.slice(apiStartStart, apiStartEnd);
    const stopStart = source.indexOf('stop: async (');
    const stopEnd = source.indexOf(
        'xtreamStatus: (): XtreamMainCaptureStatus',
        stopStart
    );
    const stopCapture = source.slice(stopStart, stopEnd);

    assert.match(
        source,
        /workerSampleDeadlineApiFactorySource:\s+createWorkerSampleDeadlineApi\.toString\(\)/
    );
    assert.match(source, /workerSampleDeadlineMs:\s+5_000/);
    assert.match(source, /capturePoisonedReason:\s+null as string \| null/);
    assert.match(source, /sampleKey: object/);
    assert.match(source, /sampleTimedOut: boolean/);
    assert.match(sampleWorker, /workerSampleDeadlineApi\s*\.run\(/);
    assert.match(sampleWorker, /invalidateCapture\('worker-sample-timeout'\)/);
    assert.match(
        sampleWorker,
        /state\.capturePoisonedReason\s*=\s*'worker-sample-timeout'/
    );
    assert.match(sampleWorker, /record\.sampleKey === sampleKey/);
    assert.match(sampleWorker, /record\.samplePromise === boundedSample/);
    assert.match(
        startCapture,
        /if \(state\.capturePoisonedReason !== null\)[\s\S]*xtream-main-capture-poisoned/
    );
    assert.match(
        apiStart,
        /if \(state\.capturePoisonedReason !== null\)[\s\S]*xtream-main-capture-poisoned[\s\S]*databaseWorkerPostGcCutoffApi\.beginCapture\(\)/
    );
    assert.match(
        stopCapture,
        /const nextCaptureUnavailableReason =\s+state\.capturePoisonedReason \?\?/
    );
});
