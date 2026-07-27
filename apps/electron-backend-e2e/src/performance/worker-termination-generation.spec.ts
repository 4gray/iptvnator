/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface WorkerTerminationGenerationApi {
    isCurrent(input: {
        readonly capturedGeneration: number | null;
        readonly currentGeneration: number;
        readonly recordGeneration: number | null;
    }): boolean;
}

interface WorkerTerminationGenerationModule {
    createWorkerTerminationGenerationApi?: () => WorkerTerminationGenerationApi;
}

const modulePromise = import(
    new URL('./worker-termination-generation.ts', import.meta.url).href
)
    .then((module) => module as WorkerTerminationGenerationModule)
    .catch(() => null);

test('rejects a delayed termination completion after capture rollover or record reuse', async () => {
    const module = await modulePromise;
    assert.ok(module, 'worker termination generation guard must exist');
    const api = module.createWorkerTerminationGenerationApi?.();
    assert.ok(api);

    assert.equal(
        api.isCurrent({
            capturedGeneration: 4,
            currentGeneration: 4,
            recordGeneration: 4,
        }),
        true
    );
    assert.equal(
        api.isCurrent({
            capturedGeneration: 4,
            currentGeneration: 5,
            recordGeneration: 4,
        }),
        false,
        'a late completion must not write into the next global capture generation'
    );
    assert.equal(
        api.isCurrent({
            capturedGeneration: 4,
            currentGeneration: 5,
            recordGeneration: 5,
        }),
        false,
        'a reused record must not be finalized by the prior termination promise'
    );
});

test('fails closed for missing or invalid generation identities', async () => {
    const module = await modulePromise;
    assert.ok(module);
    const api = module.createWorkerTerminationGenerationApi?.();
    assert.ok(api);

    for (const capturedGeneration of [null, 0, -1, 1.5, Number.NaN]) {
        assert.equal(
            api.isCurrent({
                capturedGeneration,
                currentGeneration: 1,
                recordGeneration: 1,
            }),
            false
        );
    }
});

test('the Electron termination callback applies the generation guard before mutating capture state', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const terminateStart = source.indexOf(
        'WorkerClass.prototype.terminate = function'
    );
    const terminateEnd = source.indexOf('const inspectorPost', terminateStart);
    const terminateBlock = source.slice(terminateStart, terminateEnd);
    const terminationGeneration = terminateBlock.indexOf(
        'const terminationGeneration = record.captureGeneration'
    );
    const generationGuard = terminateBlock.indexOf(
        'workerTerminationGenerationApi.isCurrent'
    );
    const terminationMutation = terminateBlock.indexOf(
        'record.terminatedEpochMs = nowEpochMs()'
    );

    assert.ok(
        terminationGeneration >= 0 &&
            terminationGeneration < generationGuard &&
            generationGuard < terminationMutation,
        'late termination completion must be generation-gated before mutating the record or timeline'
    );
});
