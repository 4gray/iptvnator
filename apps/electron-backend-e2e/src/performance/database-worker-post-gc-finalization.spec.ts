/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type AncillaryFailureStage = 'heap-snapshot' | 'post-gc-probe' | 'profile-stop';

type PostGcOutcome =
    | {
          readonly postGcHeapUsedBytes: number;
          readonly unavailableReason: null;
      }
    | {
          readonly postGcHeapUsedBytes: null;
          readonly unavailableReason: string;
      };

interface FinalizationInput {
    readonly finalizationKey: object;
    readonly joinFinalSample: () => Promise<void>;
    readonly probePostGc: () => Promise<PostGcOutcome>;
    readonly reportAncillaryFailure: (
        stage: AncillaryFailureStage,
        error: unknown
    ) => void;
    readonly stopProfile: () => Promise<void>;
    readonly stopSampling: () => void;
    readonly takeHeapSnapshot?: () => Promise<void>;
}

interface FinalizationApi {
    finalize(input: FinalizationInput): Promise<PostGcOutcome>;
}

interface FinalizationModule {
    createDatabaseWorkerPostGcFinalizationApi?: () => FinalizationApi;
}

const finalizationModulePromise = import(
    new URL('./database-worker-post-gc-finalization.ts', import.meta.url).href
)
    .then((module) => module as FinalizationModule)
    .catch(() => null);

function deferred(): {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
} {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function restoreSerializableApi(): Promise<FinalizationApi> {
    const module = await finalizationModulePromise;
    assert.ok(module, 'database worker post-GC finalization module must exist');
    const factory = module.createDatabaseWorkerPostGcFinalizationApi;
    assert.equal(typeof factory, 'function');

    const source = factory.toString();
    assert.doesNotMatch(source, /__name/);
    const restoredFactory = Function(
        `"use strict"; return (${source});`
    )() as () => FinalizationApi;
    return restoredFactory();
}

test('coordinates database worker post-GC finalization in order and single-flight', async () => {
    const api = await restoreSerializableApi();
    const finalSampleGate = deferred();
    const events: string[] = [];
    let probeCalls = 0;
    const successfulPostGc = {
        postGcHeapUsedBytes: 98_304,
        unavailableReason: null,
    } as const;
    const input: FinalizationInput = {
        finalizationKey: {},
        joinFinalSample: async () => {
            events.push('final-sample:start');
            await finalSampleGate.promise;
            events.push('final-sample:joined');
        },
        probePostGc: async () => {
            probeCalls += 1;
            events.push('post-gc-probe');
            return successfulPostGc;
        },
        reportAncillaryFailure: () => {
            assert.fail('the successful path has no ancillary failures');
        },
        stopProfile: async () => {
            events.push('profile-stop');
        },
        stopSampling: () => {
            events.push('sampling-stop');
        },
        takeHeapSnapshot: async () => {
            events.push('heap-snapshot');
        },
    };

    const firstFinalization = api.finalize(input);
    const concurrentFinalization = api.finalize(input);
    await Promise.resolve();

    assert.deepEqual(events, ['sampling-stop', 'final-sample:start']);
    assert.equal(probeCalls, 0);

    finalSampleGate.resolve();
    const [firstResult, concurrentResult] = await Promise.all([
        firstFinalization,
        concurrentFinalization,
    ]);

    assert.deepEqual(events, [
        'sampling-stop',
        'final-sample:start',
        'final-sample:joined',
        'profile-stop',
        'post-gc-probe',
        'heap-snapshot',
    ]);
    assert.equal(probeCalls, 1);
    assert.deepEqual(firstResult, successfulPostGc);
    assert.deepEqual(concurrentResult, successfulPostGc);
});

test('reports profile and snapshot failures without erasing successful post-GC', async () => {
    const api = await restoreSerializableApi();
    const events: string[] = [];
    const profileError = new Error('profile-stop-failed');
    const snapshotError = new Error('heap-snapshot-failed');
    const failures: {
        readonly error: unknown;
        readonly stage: AncillaryFailureStage;
    }[] = [];

    const result = await api.finalize({
        finalizationKey: {},
        joinFinalSample: async () => {
            events.push('final-sample:joined');
        },
        probePostGc: async () => {
            events.push('post-gc-probe');
            return {
                postGcHeapUsedBytes: 131_072,
                unavailableReason: null,
            };
        },
        reportAncillaryFailure: (stage, error) => {
            failures.push({ error, stage });
        },
        stopProfile: async () => {
            events.push('profile-stop');
            throw profileError;
        },
        stopSampling: () => {
            events.push('sampling-stop');
        },
        takeHeapSnapshot: async () => {
            events.push('heap-snapshot');
            throw snapshotError;
        },
    });

    assert.deepEqual(events, [
        'sampling-stop',
        'final-sample:joined',
        'profile-stop',
        'post-gc-probe',
        'heap-snapshot',
    ]);
    assert.deepEqual(failures, [
        { error: profileError, stage: 'profile-stop' },
        { error: snapshotError, stage: 'heap-snapshot' },
    ]);
    assert.deepEqual(result, {
        postGcHeapUsedBytes: 131_072,
        unavailableReason: null,
    });
});

test('fails closed when the post-GC probe throws without relabelling profile artifacts', async () => {
    const api = await restoreSerializableApi();
    const probeError = new Error('probe-failed');
    const failures: {
        readonly error: unknown;
        readonly stage: AncillaryFailureStage;
    }[] = [];

    const result = await api.finalize({
        finalizationKey: {},
        joinFinalSample: async () => undefined,
        probePostGc: async () => {
            throw probeError;
        },
        reportAncillaryFailure: (stage, error) => {
            failures.push({ error, stage });
        },
        stopProfile: async () => undefined,
        stopSampling: () => undefined,
    });

    assert.deepEqual(result, {
        postGcHeapUsedBytes: null,
        unavailableReason: 'capture-failed',
    });
    assert.deepEqual(failures, [{ error: probeError, stage: 'post-gc-probe' }]);
});

test('the Electron main capture wires exact DB selection and explicit-GC finalization', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );

    assert.match(
        source,
        /databaseWorkerPostGcSelectionApiFactorySource:\s+createDatabaseWorkerPostGcSelectionApi\.toString\(\)/
    );
    assert.match(
        source,
        /databaseWorkerPostGcProbeApiFactorySource:\s+createDatabaseWorkerPostGcProbeApi\.toString\(\)/
    );
    assert.match(
        source,
        /databaseWorkerPostGcFinalizationApiFactorySource:\s+createDatabaseWorkerPostGcFinalizationApi\.toString\(\)/
    );
    assert.match(source, /new workerThreads\.MessageChannel\(\)/);
    assert.match(
        source,
        /databaseWorkerPostGcSelectionApi\.select\(\s*currentWorkerRecords,\s*state\.captureGeneration\s*\)/
    );
    assert.match(source, /databaseWorkerPostGcFinalizationApi\s*\.finalize\(/);
    assert.match(source, /pendingCount: 0/);
    assert.match(source, /record\.pendingCount \+= 1/);
    assert.match(
        source,
        /request\.record\.pendingCount = Math\.max\(\s*0,\s*request\.record\.pendingCount - 1\s*\)/
    );
    assert.match(source, /samplePromise/);
    assert.match(source, /postGcHeapUnavailableReason/);
    assert.match(source, /ordinal: nextWorkerOrdinal/);
    assert.match(
        source,
        /`\$\{record\.kind\}-\$\{record\.ordinal\}\.cpuprofile`/
    );
    assert.doesNotMatch(source, /sampleBusy/);
    assert.doesNotMatch(source, /const postSnapshot/);
});

test('main CPU profiling stops at the operation cutoff before worker artifact finalization', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const stopStart = source.indexOf('stop: async (');
    const mainProfileStop = source.indexOf("'Profiler.stop'", stopStart);
    const databaseSelection = source.indexOf(
        'databaseWorkerPostGcSelectionApi.select',
        stopStart
    );
    const databaseFinalization = source.indexOf(
        'await finalizeDatabaseWorker',
        stopStart
    );

    assert.ok(stopStart >= 0);
    assert.ok(mainProfileStop > stopStart);
    assert.ok(mainProfileStop < databaseSelection);
    assert.ok(mainProfileStop < databaseFinalization);
});

test('worker CPU profile serialization runs only after the main CPU profiler stops', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const profileStopStart = source.indexOf('const stopWorkerProfile');
    const profileStopEnd = source.indexOf(
        'const writeWorkerProfile',
        profileStopStart
    );
    const profileStop = source.slice(profileStopStart, profileStopEnd);
    const stopStart = source.indexOf('stop: async (');
    const mainProfileStop = source.indexOf("'Profiler.stop'", stopStart);
    const workerProfileFlush = source.indexOf(
        'flushWorkerProfiles(currentWorkerRecords)',
        mainProfileStop
    );

    assert.match(profileStop, /const profileResult = await handle\.stop\(\)/);
    assert.match(profileStop, /record\.profileResult = profileResult/);
    assert.doesNotMatch(profileStop, /writeFileSync|JSON\.stringify/);
    assert.ok(mainProfileStop > stopStart);
    assert.ok(workerProfileFlush > mainProfileStop);
});

test('measured termination stays unperturbed while diagnostic capture finalizes its profile before termination', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const terminateStart = source.indexOf(
        'WorkerClass.prototype.terminate = function'
    );
    const terminateEnd = source.indexOf('const inspectorPost', terminateStart);
    const terminateBlock = source.slice(terminateStart, terminateEnd);
    const terminatingFinalizerStart = source.indexOf(
        'const finalizeTerminatingWorker'
    );
    const terminatingFinalizerEnd = source.indexOf(
        'WorkerClass.prototype.postMessage',
        terminatingFinalizerStart
    );
    const terminatingFinalizer = source.slice(
        terminatingFinalizerStart,
        terminatingFinalizerEnd
    );

    const measuredTerminate = terminateBlock.indexOf(
        'const termination = originalTerminate.call(this)'
    );
    const measuredFinalization = terminateBlock.indexOf(
        'void finalizeTerminatingWorker(record, false)'
    );
    const diagnosticFinalizationStart = terminateBlock.indexOf(
        'void finalizeTerminatingWorker(record, true)'
    );
    const diagnosticFinalizationWait = terminateBlock.indexOf(
        'await waitForTerminatingWorkerFinalization(record)'
    );
    const diagnosticTerminate = terminateBlock.indexOf(
        'return originalTerminate.call(this)',
        diagnosticFinalizationWait
    );

    assert.ok(
        diagnosticFinalizationStart >= 0 &&
            diagnosticFinalizationStart < diagnosticFinalizationWait &&
            diagnosticFinalizationWait < diagnosticTerminate,
        'diagnostic capture must start profile finalization, bound its wait, and then terminate the worker'
    );
    assert.ok(
        measuredTerminate >= 0 && measuredTerminate < measuredFinalization,
        'measured capture must initiate termination before best-effort finalization'
    );
    assert.doesNotMatch(terminatingFinalizer, /takeWorkerHeapSnapshot/);
    assert.match(
        terminatingFinalizer,
        /stopWorkerProfile\(record, waitForProfileHandle\)/
    );
    assert.match(source, /resolvedProfileHandle/);
    assert.match(source, /worker-profile-finalization-timeout/);
    assert.match(source, /finalizationTimedOut/);
    assert.match(source, /profileCaptureKey/);
    assert.match(source, /record\.profileCaptureKey !== profileCaptureKey/);
});

test('worker capture failures use an artifact-neutral timeline label', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );

    assert.match(source, /worker-artifact-error:\$\{stage\}/);
    assert.doesNotMatch(source, /worker-profile-error:\$\{stage\}/);
});

test('capture generation resets artifact paths and always emits current DB records', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const start = source.indexOf('const startCapture = async (');
    const diagnostic = source.indexOf('if (state.diagnostic)', start);
    const profileReset = source.indexOf('state.mainProfilePath = null', start);
    const snapshotReset = source.indexOf(
        'state.mainSnapshotPath = null',
        start
    );

    assert.ok(profileReset > start && profileReset < diagnostic);
    assert.ok(snapshotReset > start && snapshotReset < diagnostic);
    assert.match(
        source,
        /record\.captureGeneration === state\.captureGeneration[\s\S]*record\.kind === 'database\.worker'/
    );
});
