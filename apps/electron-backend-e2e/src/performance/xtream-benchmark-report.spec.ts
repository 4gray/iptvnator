import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
    createXtreamIterationDefinitions,
    type XtreamBenchmarkManifest,
} from './xtream-benchmark-contract';
import { createXtreamBenchmarkSummary } from './xtream-benchmark-report';
import {
    MANIFEST,
    TOKEN,
    clearXtreamReportFixtureDirectories,
    iteration,
    persist,
    persistWith,
    sha256,
} from './xtream-benchmark-report.fixtures';
import {
    clearXtreamProvenanceFixtureDirectories,
    formalReportFixture,
    smokeReportFixture,
} from './xtream-benchmark-report-provenance.fixtures';

afterEach(async () => {
    await Promise.all([
        clearXtreamReportFixtureDirectories(),
        clearXtreamProvenanceFixtureDirectories(),
    ]);
});

describe('Xtream benchmark report contract', () => {
    it('writes exact raw bytes before semantic validation and verifies a real receipt', async () => {
        const raw = iteration(
            itemAt(createXtreamIterationDefinitions(false), 1),
            1
        );
        const invalid = {
            ...raw,
            main: { ...raw.main, peakRssBytes: -1 },
        };
        const order: string[] = [];

        await assert.rejects(
            () =>
                persist(invalid, 1, () => {
                    order.push('raw-written');
                }),
            /invalid Xtream iteration/
        );
        order.push('validation-rejected');
        assert.deepEqual(order, ['raw-written', 'validation-rejected']);

        await assert.rejects(
            () =>
                persistWith(raw, async (serialized) => ({
                    absolutePath: join(tmpdir(), 'does-not-exist.json'),
                    bytes: Buffer.byteLength(serialized),
                    sha256: sha256(serialized),
                })),
            /persistence receipt/
        );
    });

    it('brands the exact persisted bytes when the caller mutates during write', async () => {
        const raw = iteration(
            itemAt(createXtreamIterationDefinitions(false), 1),
            1
        );
        const persistedPeakRss = raw.main.peakRssBytes;
        const validated = await persist(raw, 2, () => {
            Object.assign(raw.main, { peakRssBytes: persistedPeakRss + 1 });
        });

        assert.equal(validated.main.peakRssBytes, persistedPeakRss);
        assert.notEqual(validated.main.peakRssBytes, raw.main.peakRssBytes);
        assert.throws(
            () => Object.assign(validated.main, { peakRssBytes: 1 }),
            TypeError
        );
    });

    it('blocks exact token and credential-shaped bytes before write but permits suite labels', async () => {
        const raw = iteration(
            itemAt(createXtreamIterationDefinitions(false), 1),
            1
        );
        let writes = 0;
        for (const leaked of [
            TOKEN,
            'performance:performance',
            'http://performance:performance@127.0.0.1:43123',
            '?username=performance&password=performance',
        ]) {
            await assert.rejects(
                () =>
                    persistWith(
                        {
                            ...raw,
                            renderer: {
                                ...raw.renderer,
                                consoleErrors: [leaked],
                            },
                        },
                        async () => {
                            writes += 1;
                            throw new Error('must not write');
                        }
                    ),
                /credential-safe/
            );
        }
        assert.equal(writes, 0);
        await assert.doesNotReject(() => persist(raw, 2));
    });

    it('requires exact clean formal source, runtime, CDP, and environment evidence', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        assert.doesNotThrow(() =>
            createXtreamBenchmarkSummary(
                MANIFEST,
                iterations,
                diagnosticEvidence
            )
        );

        for (const invalid of [
            { ...MANIFEST, source: { ...MANIFEST.source, gitDirty: true } },
            {
                ...MANIFEST,
                environment: { ...MANIFEST.environment, cdpPort: 9223 },
            },
            {
                ...MANIFEST,
                environment: {
                    ...MANIFEST.environment,
                    perfWorkerProfiling: '0',
                },
            },
            {
                ...MANIFEST,
                runtime: { ...MANIFEST.runtime, electronVersion: '' },
            },
            { ...MANIFEST, variant: { length: 1 } },
        ]) {
            assert.throws(
                () =>
                    createXtreamBenchmarkSummary(
                        invalid as unknown as XtreamBenchmarkManifest,
                        iterations,
                        diagnosticEvidence
                    ),
                /invalid Xtream benchmark manifest/
            );
        }
    });

    it('requires ordered definitions and unique process/profile/generation identity', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        const shuffled = [...iterations];
        [shuffled[0], shuffled[1]] = [itemAt(shuffled, 1), itemAt(shuffled, 0)];
        assert.throws(
            () =>
                createXtreamBenchmarkSummary(
                    MANIFEST,
                    shuffled,
                    diagnosticEvidence
                ),
            /ordered Xtream benchmark schedule/
        );

        const reused = [...iterations];
        const first = itemAt(reused, 0);
        const second = itemAt(reused, 1);
        reused[1] = {
            ...second,
            processIdentity: first.processIdentity,
        };
        assert.throws(
            () =>
                createXtreamBenchmarkSummary(
                    MANIFEST,
                    reused,
                    diagnosticEvidence
                ),
            /fresh process identity/
        );
    });

    it('keeps a bounded startup retry in receipt-bound summary iterations', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture(1);
        const summary = createXtreamBenchmarkSummary(
            MANIFEST,
            iterations,
            diagnosticEvidence
        );

        const retryIdentity = itemAt(summary.iterations, 1).processIdentity;
        assert.equal(retryIdentity.startupAttemptCount, 2);
        assert.deepEqual(retryIdentity.startupRetryReasons, [
            'sqlite-database-locked',
        ]);
        assert.equal(summary.validForComparison, true);
    });

    it('rejects forged validated objects and excludes diagnostic CPU profiles from headline metrics', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        const forged = [...iterations];
        forged[0] = { ...itemAt(forged, 0) };
        assert.throws(
            () =>
                createXtreamBenchmarkSummary(
                    MANIFEST,
                    forged,
                    diagnosticEvidence
                ),
            /validated persistence evidence/
        );

        const summary = createXtreamBenchmarkSummary(
            MANIFEST,
            iterations,
            diagnosticEvidence
        );
        const background = summary.scenarios.find(
            ({ scenarioId }) => scenarioId === 'xtream-background-ui'
        );
        const initial = summary.scenarios.find(
            ({ scenarioId }) => scenarioId === 'xtream-initial-import-large'
        );
        assert.ok(background);
        assert.ok(initial);
        assert.deepEqual(background.databaseWorkerRequestInvalidReasons, [
            'overlapping-database-worker-requests',
        ]);
        assert.equal(
            background.metrics.databaseWorkerRequestInvalidSampleCount.min,
            3
        );
        assert.equal(
            background.metrics.databaseWorkerRequestInvalidSampleCount.max,
            3
        );
        assert.deepEqual(initial.databaseWorkerRequestInvalidReasons, [
            'overlapping-database-worker-requests',
        ]);
        assert.equal(
            initial.metrics.databaseWorkerRequestInvalidSampleCount.min,
            0
        );
        assert.equal(
            initial.metrics.databaseWorkerRequestInvalidSampleCount.max,
            2
        );
        assert.ok(
            summary.scenarios.every(
                ({
                    databaseWorkerEventLoopDelayMetricScope,
                    databaseWorkerRequestMetricScope,
                    databaseWorkerWholeWorkerMetricScope,
                    metrics,
                }) =>
                    databaseWorkerEventLoopDelayMetricScope ===
                        'valid-request-window-proxy' &&
                    databaseWorkerRequestMetricScope ===
                        'valid-request-window-proxy' &&
                    databaseWorkerWholeWorkerMetricScope ===
                        'whole-worker-operation-window' &&
                    metrics.databaseWorkerRequestEventLoopDelayP95Ms.count === 5
            )
        );
        assert.equal(summary.validForComparison, true);
        assert.ok(Object.isFrozen(summary));
        assert.ok(Object.isFrozen(summary.manifest));
        assert.ok(Object.isFrozen(summary.iterations));
        assert.ok(
            Object.isFrozen(
                itemAt(summary.iterations, 0).databaseWorker.requests.evidence
            )
        );
        assert.notEqual(summary.manifest, MANIFEST);
        assert.notEqual(summary.iterations, iterations);
        assert.ok(
            summary.scenarios.every(
                ({
                    diagnosticProfiles,
                    mainEventLoopUtilization,
                    measuredRuns,
                    metrics,
                    phases,
                }) =>
                    measuredRuns === 5 &&
                    metrics.totalMs.count === 5 &&
                    diagnosticProfiles.mainDurationMicros !== null &&
                    diagnosticProfiles.artifactProvenance.artifacts.length ===
                        7 &&
                    Object.isFrozen(
                        diagnosticProfiles.artifactProvenance.artifacts
                    ) &&
                    mainEventLoopUtilization.reason ===
                        'electron-main-embedded-event-loop' &&
                    mainEventLoopUtilization.value === null &&
                    phases.indexes.reason ===
                        'schema-indexes-pre-exist; operation-creates-none' &&
                    phases.restoreUserData.value === null &&
                    phases.structuredCloneAttribution ===
                        'selected-ipc-proxy-includes-queueing-and-scheduling' &&
                    !Object.prototype.hasOwnProperty.call(
                        metrics,
                        'mainCpuProfileDurationMicros'
                    )
            )
        );
        assert.equal(
            initial.phases.restoreUserData.reason,
            'not-invoked-by-scenario'
        );
        assert.equal(background.phases.restoreUserData.reason, 'no-user-data');
    });

    it('requires branded one-to-one diagnostic evidence bound to each iteration directory', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        const entries = [...diagnosticEvidence.entries()];
        const first = itemAt(entries, 0);
        const second = itemAt(entries, 1);
        const missing = new Map(entries.slice(1));
        const swapped = new Map(entries);
        swapped.set(first[0], second[1]);
        swapped.set(second[0], first[1]);
        const extra = new Map(entries);
        extra.set(itemAt(iterations, 0), first[1]);
        const forged = new Map(entries);
        forged.set(first[0], structuredClone(first[1]));
        const malformed = new Map(entries);
        malformed.set(first[0], null as unknown as (typeof entries)[number][1]);

        for (const evidence of [missing, swapped, extra, forged, malformed]) {
            assert.throws(
                () =>
                    createXtreamBenchmarkSummary(
                        MANIFEST,
                        iterations,
                        evidence
                    ),
                /diagnostic artifact evidence/
            );
        }
    });

    it('keeps one-run smoke output ineligible after all clean gates pass', async () => {
        const { diagnosticEvidence, iterations } = await smokeReportFixture();
        const summary = createXtreamBenchmarkSummary(
            { ...MANIFEST, mode: 'smoke' },
            iterations,
            diagnosticEvidence
        );

        assert.equal(summary.validForComparison, false);
    });
});

function itemAt<T>(items: readonly T[], index: number): T {
    const item = items[index];
    assert.ok(item);
    return item;
}
