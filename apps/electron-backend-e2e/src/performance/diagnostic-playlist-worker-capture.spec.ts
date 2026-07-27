/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { MainCaptureMetrics } from './m3u-refresh-cancellation-contract';

interface DiagnosticCaptureModule {
    validateDiagnosticPlaylistWorkerCapture?: (
        main: MainCaptureMetrics,
        iterationDirectory: string
    ) => Promise<void>;
}

const diagnosticCaptureModulePromise = import(
    new URL('./diagnostic-playlist-worker-capture.ts', import.meta.url).href
)
    .then((module) => module as DiagnosticCaptureModule)
    .catch(() => null);

function mainCapture(input: {
    readonly profilePath: string | null;
    readonly snapshotPath?: string | null;
    readonly timelineType?: string;
}): MainCaptureMetrics {
    return {
        timeline: input.timelineType
            ? [{ epochMs: 1, type: input.timelineType }]
            : [],
        workers: [
            {
                kind: 'playlist-refresh.worker',
                ordinal: 2,
                postGcHeapUnavailableReason:
                    'worker-force-terminated-before-gc',
                postGcHeapUsedBytes: null,
                profilePath: input.profilePath,
                snapshotPath: input.snapshotPath ?? null,
                terminatedEpochMs: 2,
            },
        ],
    } as unknown as MainCaptureMetrics;
}

test('accepts one parseable diagnostic playlist-worker profile inside the iteration directory', async () => {
    const module = await diagnosticCaptureModulePromise;
    assert.ok(
        module,
        'diagnostic playlist worker capture validator must exist'
    );
    const validate = module.validateDiagnosticPlaylistWorkerCapture;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-diagnostic-worker-')
    );

    try {
        const profilePath = join(
            directory,
            'playlist-refresh.worker-2.cpuprofile'
        );
        await writeFile(
            profilePath,
            JSON.stringify({ nodes: [{ id: 1 }], samples: [1] })
        );
        await assert.doesNotReject(() =>
            validate?.(mainCapture({ profilePath }), directory)
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('fails closed for missing, escaped, malformed, or contaminated diagnostic artifacts', async () => {
    const module = await diagnosticCaptureModulePromise;
    assert.ok(module);
    const validate = module.validateDiagnosticPlaylistWorkerCapture;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-diagnostic-worker-invalid-')
    );

    try {
        await assert.rejects(
            () => validate?.(mainCapture({ profilePath: null }), directory),
            /diagnostic-playlist-worker-profile-missing/
        );
        await assert.rejects(
            () =>
                validate?.(
                    mainCapture({
                        profilePath: join(
                            directory,
                            '..',
                            'escaped.cpuprofile'
                        ),
                    }),
                    directory
                ),
            /diagnostic-playlist-worker-profile-path-invalid/
        );
        const malformedPath = join(
            directory,
            'playlist-refresh.worker-2.cpuprofile'
        );
        await writeFile(malformedPath, '{"nodes":[]}');
        await assert.rejects(
            () =>
                validate?.(
                    mainCapture({ profilePath: malformedPath }),
                    directory
                ),
            /diagnostic-playlist-worker-profile-invalid/
        );
        await assert.rejects(
            () =>
                validate?.(
                    mainCapture({
                        profilePath: malformedPath,
                        timelineType:
                            'worker-artifact-error:profile-stop:failed',
                    }),
                    directory
                ),
            /diagnostic-playlist-worker-artifact-error/
        );
        await assert.rejects(
            () =>
                validate?.(
                    mainCapture({
                        profilePath: malformedPath,
                        snapshotPath: join(
                            directory,
                            'playlist-refresh.worker-2.heapsnapshot'
                        ),
                    }),
                    directory
                ),
            /diagnostic-playlist-worker-snapshot-unexpected/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('the benchmark persists diagnostic raw metrics before requiring a parseable playlist-worker profile', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const resultWrite = source.indexOf(
        "writeJson(join(iterationDirectory, 'result.json'), result)"
    );
    const summaryWrite = source.indexOf(
        "writeJson(join(config.outputDirectory, 'summary.json'), summary)"
    );
    const diagnosticValidation = source.indexOf(
        'await validateDiagnosticPlaylistWorkerCapture('
    );

    assert.ok(resultWrite >= 0);
    assert.ok(summaryWrite >= 0);
    assert.ok(diagnosticValidation > summaryWrite);
});

test('the benchmark requires the diagnostic worker profile to come from an observed cancellation', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const summaryWrite = source.indexOf(
        "writeJson(join(config.outputDirectory, 'summary.json'), summary)"
    );
    const diagnosticCancellationGuard = source.indexOf(
        'if (!diagnosticIteration.cancellationEffectObserved)'
    );
    const diagnosticValidation = source.indexOf(
        'await validateDiagnosticPlaylistWorkerCapture('
    );

    assert.ok(summaryWrite >= 0);
    assert.ok(
        diagnosticCancellationGuard > summaryWrite,
        'raw manifest and summary must remain durable when the diagnostic cancellation is invalid'
    );
    assert.ok(
        diagnosticCancellationGuard < diagnosticValidation,
        'the cancellation guard must reject a normal-completion worker profile before artifact validation'
    );
});
