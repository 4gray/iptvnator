/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type IterationKind = 'diagnostic' | 'measured' | 'warmup';
type WorkerKind = 'database.worker' | 'playlist-refresh.worker';

interface TestWorkerCapture {
    readonly kind: WorkerKind;
    readonly postGcHeapUnavailableReason: string | null;
    readonly postGcHeapUsedBytes: number | null;
}

interface TestIteration {
    readonly cancellationEffectObserved: boolean;
    readonly kind: IterationKind;
    readonly main: {
        readonly timeline: readonly {
            readonly type: string;
        }[];
        readonly workers: readonly TestWorkerCapture[];
    };
    readonly runId: string;
}

interface InvalidMeasuredRun {
    readonly databaseWorkerCount: number;
    readonly reason: string;
    readonly runId: string;
}

interface DatabaseWorkerPostGcValidity {
    readonly applicableMeasuredRunCount: number;
    readonly invalidMeasuredRuns: readonly InvalidMeasuredRun[];
    readonly measuredRunCount: number;
    readonly notApplicableMeasuredRuns: readonly {
        readonly reason: string;
        readonly runId: string;
    }[];
    readonly validForBenchmark: boolean;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
}

interface ValidityModule {
    assessDatabaseWorkerPostGcValidity?: (
        iterations: readonly TestIteration[]
    ) => DatabaseWorkerPostGcValidity;
}

const validityModulePromise = import(
    new URL('./database-worker-post-gc-validity.ts', import.meta.url).href
)
    .then((module) => module as ValidityModule)
    .catch(() => null);

function worker(
    postGcHeapUsedBytes: number | null,
    postGcHeapUnavailableReason: string | null,
    kind: WorkerKind = 'database.worker'
): TestWorkerCapture {
    return {
        kind,
        postGcHeapUnavailableReason,
        postGcHeapUsedBytes,
    };
}

function iteration(
    runId: string,
    kind: IterationKind,
    workers: readonly TestWorkerCapture[],
    timeline: readonly { readonly type: string }[] = [],
    cancellationEffectObserved = false
): TestIteration {
    return {
        cancellationEffectObserved,
        kind,
        main: { timeline, workers },
        runId,
    };
}

test('validates database post-GC heap per measured iteration without losing raw reasons', async () => {
    const module = await validityModulePromise;
    assert.ok(module, 'database worker post-GC validity helper must exist');
    const assess = module.assessDatabaseWorkerPostGcValidity;
    assert.equal(typeof assess, 'function');

    const valid = assess([
        iteration('warmup-broken', 'warmup', []),
        iteration('diagnostic-broken', 'diagnostic', [
            worker(null, 'gc-unavailable'),
            worker(100, null),
        ]),
        iteration('measured-valid', 'measured', [
            worker(4_096, null),
            worker(
                null,
                'worker-force-terminated-before-gc',
                'playlist-refresh.worker'
            ),
        ]),
    ]);
    assert.deepEqual(valid, {
        applicableMeasuredRunCount: 1,
        invalidMeasuredRuns: [],
        measuredRunCount: 1,
        notApplicableMeasuredRuns: [],
        validForBenchmark: true,
        validForComparison: true,
        validMeasuredRunCount: 1,
    });

    const compensatingCardinality = assess([
        iteration('measured-duplicate', 'measured', [
            worker(1_024, null),
            worker(2_048, null),
        ]),
        iteration(
            'measured-missing',
            'measured',
            [worker(3_072, null, 'playlist-refresh.worker')],
            [{ type: 'db-request' }]
        ),
    ]);
    assert.deepEqual(compensatingCardinality, {
        applicableMeasuredRunCount: 2,
        invalidMeasuredRuns: [
            {
                databaseWorkerCount: 2,
                reason: 'multiple-database-workers',
                runId: 'measured-duplicate',
            },
            {
                databaseWorkerCount: 0,
                reason: 'database-worker-missing',
                runId: 'measured-missing',
            },
        ],
        measuredRunCount: 2,
        notApplicableMeasuredRuns: [],
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });

    const unavailableWorker = worker(null, 'post-gc-probe-timeout');
    const unavailableAndIncoherent = assess([
        iteration('measured-unavailable', 'measured', [unavailableWorker]),
        iteration('measured-incoherent', 'measured', [
            worker(8_192, 'gc-unavailable'),
        ]),
    ]);
    assert.deepEqual(unavailableAndIncoherent, {
        applicableMeasuredRunCount: 2,
        invalidMeasuredRuns: [
            {
                databaseWorkerCount: 1,
                reason: 'post-gc-probe-timeout',
                runId: 'measured-unavailable',
            },
            {
                databaseWorkerCount: 1,
                reason: 'post-gc-capture-invalid',
                runId: 'measured-incoherent',
            },
        ],
        measuredRunCount: 2,
        notApplicableMeasuredRuns: [],
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });
    assert.equal(
        unavailableWorker.postGcHeapUnavailableReason,
        'post-gc-probe-timeout'
    );
});

test('marks parsing cancellation before persistence as DB N/A without accepting late or missing captured DB work', async () => {
    const module = await validityModulePromise;
    assert.ok(module);
    const assess = module.assessDatabaseWorkerPostGcValidity;
    assert.equal(typeof assess, 'function');

    const noDatabasePhase = assess([
        iteration(
            'run-01',
            'measured',
            [
                worker(
                    null,
                    'worker-force-terminated-before-gc',
                    'playlist-refresh.worker'
                ),
            ],
            [],
            true
        ),
        iteration(
            'run-02',
            'measured',
            [
                worker(
                    null,
                    'worker-force-terminated-before-gc',
                    'playlist-refresh.worker'
                ),
            ],
            [],
            true
        ),
    ]);
    assert.deepEqual(noDatabasePhase, {
        applicableMeasuredRunCount: 0,
        invalidMeasuredRuns: [],
        measuredRunCount: 2,
        notApplicableMeasuredRuns: [
            {
                reason: 'operation-cancelled-before-database-phase',
                runId: 'run-01',
            },
            {
                reason: 'operation-cancelled-before-database-phase',
                runId: 'run-02',
            },
        ],
        validForBenchmark: true,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });

    const mixedApplicability = assess([
        iteration('run-cancelled', 'measured', [], [], true),
        iteration('run-persisted', 'measured', [worker(4_096, null)]),
    ]);
    assert.deepEqual(mixedApplicability, {
        applicableMeasuredRunCount: 1,
        invalidMeasuredRuns: [],
        measuredRunCount: 2,
        notApplicableMeasuredRuns: [
            {
                reason: 'operation-cancelled-before-database-phase',
                runId: 'run-cancelled',
            },
        ],
        validForBenchmark: true,
        validForComparison: false,
        validMeasuredRunCount: 1,
    });

    const lateDatabaseWork = assess([
        iteration(
            'run-late',
            'measured',
            [],
            [{ type: 'db-request-after-capture-cutoff' }],
            true
        ),
    ]);
    assert.deepEqual(lateDatabaseWork, {
        applicableMeasuredRunCount: 1,
        invalidMeasuredRuns: [
            {
                databaseWorkerCount: 0,
                reason: 'database-worker-activity-after-cutoff',
                runId: 'run-late',
            },
        ],
        measuredRunCount: 1,
        notApplicableMeasuredRuns: [],
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });

    const unrelatedDatabaseWorker = assess([
        iteration(
            'run-unrelated-db',
            'measured',
            [worker(4_096, null)],
            [{ type: 'db-request' }],
            true
        ),
    ]);
    assert.deepEqual(unrelatedDatabaseWorker, {
        applicableMeasuredRunCount: 1,
        invalidMeasuredRuns: [
            {
                databaseWorkerCount: 1,
                reason: 'database-worker-unexpected-activity',
                runId: 'run-unrelated-db',
            },
        ],
        measuredRunCount: 1,
        notApplicableMeasuredRuns: [],
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });

    const nonCancelLateRequest = assess([
        iteration(
            'run-non-cancel-late',
            'measured',
            [worker(8_192, null)],
            [{ type: 'db-request-after-capture-cutoff' }]
        ),
    ]);
    assert.deepEqual(nonCancelLateRequest, {
        applicableMeasuredRunCount: 1,
        invalidMeasuredRuns: [
            {
                databaseWorkerCount: 1,
                reason: 'database-worker-activity-after-cutoff',
                runId: 'run-non-cancel-late',
            },
        ],
        measuredRunCount: 1,
        notApplicableMeasuredRuns: [],
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });
});

test('the benchmark preserves raw artifacts before rejecting an invalid formal comparison', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const summaryWrite = source.indexOf(
        "writeJson(join(config.outputDirectory, 'summary.json'), summary)"
    );
    const validityGuard = source.indexOf(
        'summary.validity.databaseWorkerPostGc.validForBenchmark'
    );
    const cancellationEffectGuard = source.indexOf(
        'summary.cancellationEffectRate !== 1'
    );

    assert.ok(summaryWrite >= 0, 'summary artifact write must exist');
    assert.ok(
        cancellationEffectGuard >= 0,
        'formal cancellation-effect guard must exist'
    );
    assert.ok(validityGuard >= 0, 'formal validity guard must exist');
    assert.ok(
        summaryWrite < cancellationEffectGuard && summaryWrite < validityGuard,
        'raw summary must be durable before either formal guard fails'
    );
    assert.match(source, /Cancellation effect was not observed/);
    assert.match(source, /Database worker post-GC capture is invalid/);
});

test('the benchmark persists the real seed DB lifecycle and atomically arms the measured generation', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const seedCaptureStart = source.indexOf(
        'await startMainCapture(app.electronApp',
        source.indexOf('const rendererWindowIdentity')
    );
    const seedPlaylist = source.indexOf('await seedPlaylist');
    const seedSettlement = source.indexOf('await waitForSeedSettlement');
    const seedRollover = source.indexOf(
        'await rolloverMainCapture(app.electronApp',
        seedSettlement
    );
    const seedArtifactWrite = source.indexOf(
        "'seed-main-capture.json'",
        seedRollover
    );

    assert.ok(seedCaptureStart >= 0 && seedCaptureStart < seedPlaylist);
    assert.ok(seedPlaylist < seedSettlement);
    assert.ok(seedSettlement < seedRollover);
    assert.ok(seedRollover < seedArtifactWrite);
    assert.doesNotMatch(
        source.slice(seedRollover + 1, source.indexOf('const renderer =')),
        /await startMainCapture\(app\.electronApp/
    );
    assert.match(source, /seedRollover\.nextCaptureStarted/);
    assert.match(source, /seedRollover\.nextCaptureUnavailableReason/);
    assert.match(
        source,
        /status\.databaseRequests\s*>\s*0[\s\S]*status\.databaseUpsertsCompleted\s*>\s*0[\s\S]*status\.databasePending\s*===\s*0/
    );
});
