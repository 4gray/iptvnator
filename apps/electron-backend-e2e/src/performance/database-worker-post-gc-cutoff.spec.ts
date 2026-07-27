/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type RequestDisposition = 'after-cutoff' | 'capture' | 'outside-capture';

interface CutoffApi {
    beginCapture(): void;
    beginStop(): void;
    finishStop(): void;
    observeDatabaseRequest(): RequestDisposition;
    rolloverCapture?(): void;
    snapshot(): {
        readonly lateRequestCount: number;
        readonly phase: 'active' | 'idle' | 'stopping';
    };
}

interface CutoffModule {
    createDatabaseWorkerPostGcCutoffApi?: () => CutoffApi;
}

const cutoffModulePromise = import(
    new URL('./database-worker-post-gc-cutoff.ts', import.meta.url).href
)
    .then((module) => module as CutoffModule)
    .catch(() => null);

async function restoreSerializableApi(): Promise<CutoffApi> {
    const module = await cutoffModulePromise;
    assert.ok(module, 'database worker post-GC cutoff module must exist');
    const factory = module.createDatabaseWorkerPostGcCutoffApi;
    assert.equal(typeof factory, 'function');

    const source = factory.toString();
    assert.doesNotMatch(source, /__name/);
    const restoredFactory = Function(
        `"use strict"; return (${source});`
    )() as () => CutoffApi;
    return restoredFactory();
}

test('classifies requests after the synchronous capture cutoff without carrying state across generations', async () => {
    const api = await restoreSerializableApi();

    assert.equal(api.observeDatabaseRequest(), 'outside-capture');
    api.beginCapture();
    assert.equal(api.observeDatabaseRequest(), 'capture');
    api.beginStop();
    assert.equal(api.observeDatabaseRequest(), 'after-cutoff');
    assert.equal(api.observeDatabaseRequest(), 'after-cutoff');
    assert.deepEqual(api.snapshot(), {
        lateRequestCount: 2,
        phase: 'stopping',
    });
    api.finishStop();
    assert.equal(api.observeDatabaseRequest(), 'outside-capture');

    api.beginCapture();
    assert.deepEqual(api.snapshot(), {
        lateRequestCount: 0,
        phase: 'active',
    });
});

test('atomically rolls a clean cutoff into the next generation without erasing contamination', async () => {
    const clean = await restoreSerializableApi();
    assert.equal(typeof clean.rolloverCapture, 'function');
    clean.beginCapture();
    clean.beginStop();
    clean.rolloverCapture?.();
    assert.deepEqual(clean.snapshot(), {
        lateRequestCount: 0,
        phase: 'active',
    });
    assert.equal(clean.observeDatabaseRequest(), 'capture');

    const contaminated = await restoreSerializableApi();
    assert.equal(typeof contaminated.rolloverCapture, 'function');
    contaminated.beginCapture();
    contaminated.beginStop();
    assert.equal(contaminated.observeDatabaseRequest(), 'after-cutoff');
    assert.throws(
        () => contaminated.rolloverCapture?.(),
        /database-worker-post-gc-capture-contaminated/
    );
    assert.deepEqual(contaminated.snapshot(), {
        lateRequestCount: 1,
        phase: 'stopping',
    });
});

test('main capture arms cutoff before awaiting and rejects late DB work before startWorker can restart profiling', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const stopStart = source.indexOf('stop: async (');
    const cutoffStart = source.indexOf(
        'databaseWorkerPostGcCutoffApi.beginStop()',
        stopStart
    );
    const activeFalse = source.indexOf('state.active = false', stopStart);
    const firstAwait = source.indexOf('await ', stopStart);
    const observeRequest = source.indexOf(
        'databaseWorkerPostGcCutoffApi.observeDatabaseRequest()'
    );
    const startWorker = source.indexOf('startWorker(record)', observeRequest);

    assert.ok(stopStart >= 0);
    assert.ok(cutoffStart > stopStart && cutoffStart < firstAwait);
    assert.ok(activeFalse > stopStart && activeFalse < firstAwait);
    assert.ok(observeRequest >= 0 && observeRequest < startWorker);
    assert.match(source, /database-worker-activity-after-cutoff/);
});
