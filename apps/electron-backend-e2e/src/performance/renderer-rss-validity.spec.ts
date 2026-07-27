/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface TestIteration {
    readonly kind: 'diagnostic' | 'measured' | 'warmup';
    readonly main: {
        readonly rendererWindow: {
            readonly rss: {
                readonly identity: {
                    readonly creationTime: number;
                    readonly pid: number;
                } | null;
                readonly missingSampleCount: number;
                readonly peakRssBytes: number | null;
                readonly unavailableReason: string | null;
                readonly validSampleCount: number;
            };
        };
    };
    readonly runId: string;
}

interface RendererRssValidity {
    readonly invalidMeasuredRuns: readonly {
        readonly missingSampleCount: number;
        readonly reason: string;
        readonly runId: string;
        readonly validSampleCount: number;
    }[];
    readonly measuredRunCount: number;
    readonly validForBenchmark: boolean;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
}

interface RendererRssValidityModule {
    assessRendererRssValidity?: (
        iterations: readonly TestIteration[]
    ) => RendererRssValidity;
}

const validityModulePromise = import(
    new URL('./renderer-rss-validity.ts', import.meta.url).href
)
    .then((module) => module as RendererRssValidityModule)
    .catch(() => null);

function iteration(
    runId: string,
    kind: TestIteration['kind'],
    input: Partial<TestIteration['main']['rendererWindow']['rss']> = {}
): TestIteration {
    return {
        kind,
        main: {
            rendererWindow: {
                rss: {
                    identity: {
                        creationTime: 1_721_234_567_890,
                        pid: 42,
                    },
                    missingSampleCount: 0,
                    peakRssBytes: 4_096,
                    unavailableReason: null,
                    validSampleCount: 3,
                    ...input,
                },
            },
        },
        runId,
    };
}

test('validates only measured renderer RSS runs and preserves the exact summary shape', async () => {
    const module = await validityModulePromise;
    assert.ok(module, 'generic renderer RSS validity helper must exist');
    const assess = module.assessRendererRssValidity;
    assert.equal(typeof assess, 'function');

    const result = assess([
        iteration('warmup-invalid', 'warmup', { identity: null }),
        iteration('run-01', 'measured'),
        iteration('diagnostic-invalid', 'diagnostic', {
            unavailableReason: 'renderer-process-gone',
        }),
    ]);

    assert.deepEqual(result, {
        invalidMeasuredRuns: [],
        measuredRunCount: 1,
        validForBenchmark: true,
        validForComparison: true,
        validMeasuredRunCount: 1,
    });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.invalidMeasuredRuns));
});

test('fails every incomplete measured capture without losing its raw reason and counts', async () => {
    const module = await validityModulePromise;
    assert.ok(module);
    const assess = module.assessRendererRssValidity;
    assert.equal(typeof assess, 'function');

    const result = assess([
        iteration('run-no-identity', 'measured', { identity: null }),
        iteration('run-missing-sample', 'measured', {
            missingSampleCount: 1,
            peakRssBytes: null,
            unavailableReason: 'renderer-process-metric-missing-during-capture',
            validSampleCount: 2,
        }),
        iteration('run-zero-peak', 'measured', { peakRssBytes: 0 }),
    ]);

    assert.deepEqual(result, {
        invalidMeasuredRuns: [
            {
                missingSampleCount: 0,
                reason: 'renderer-rss-capture-invalid',
                runId: 'run-no-identity',
                validSampleCount: 3,
            },
            {
                missingSampleCount: 1,
                reason: 'renderer-process-metric-missing-during-capture',
                runId: 'run-missing-sample',
                validSampleCount: 2,
            },
            {
                missingSampleCount: 0,
                reason: 'renderer-rss-capture-invalid',
                runId: 'run-zero-peak',
                validSampleCount: 3,
            },
        ],
        measuredRunCount: 3,
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });
});

test('requires at least one measured run', async () => {
    const module = await validityModulePromise;
    assert.ok(module);
    const assess = module.assessRendererRssValidity;
    assert.equal(typeof assess, 'function');

    assert.deepEqual(assess([iteration('warmup-01', 'warmup')]), {
        invalidMeasuredRuns: [],
        measuredRunCount: 0,
        validForBenchmark: false,
        validForComparison: false,
        validMeasuredRunCount: 0,
    });
});

test('the cancellation report delegates renderer RSS validity to the generic helper', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation-report.ts', import.meta.url),
        'utf8'
    );

    assert.match(
        source,
        /import \{ assessRendererRssValidity \} from '\.\/renderer-rss-validity';/
    );
    assert.doesNotMatch(source, /function assessRendererRssValidity\(/);
});
