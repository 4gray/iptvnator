import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createXtreamIterationDefinitions } from './xtream-benchmark-contract';
import { createXtreamBenchmarkSummary } from './xtream-benchmark-report';
import {
    MANIFEST,
    clearXtreamReportFixtureDirectories,
    iteration,
    persist,
    persistWith,
    sha256,
} from './xtream-benchmark-report.fixtures';
import { toXtreamRawIteration } from './xtream-exact-schema';
import {
    clearXtreamProvenanceFixtureDirectories,
    formalReportFixture,
} from './xtream-benchmark-report-provenance.fixtures';
import type {
    XtreamBenchmarkManifest,
    XtreamPersistenceReceipt,
} from './xtream-summary-contract';

describe('Xtream benchmark integrity boundaries', () => {
    it('uses one intrinsic snapshot instead of caller-owned array methods', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        const adversarial = [...iterations];
        const invoked: string[] = [];
        for (const method of ['filter', 'find', 'map'] as const) {
            Object.defineProperty(adversarial, method, {
                value() {
                    invoked.push(method);
                    throw new Error(`caller-owned-${method}`);
                },
            });
        }
        Object.defineProperty(adversarial, Symbol.iterator, {
            value() {
                invoked.push('iterator');
                throw new Error('caller-owned-iterator');
            },
        });

        try {
            assert.doesNotThrow(() =>
                createXtreamBenchmarkSummary(
                    MANIFEST,
                    adversarial,
                    diagnosticEvidence
                )
            );
            assert.deepEqual(invoked, []);
        } finally {
            await clearXtreamProvenanceFixtureDirectories();
        }
    });

    it('cannot hide a reused process identity behind caller-owned map', async () => {
        const fixture = await formalReportFixture();
        const definitions = createXtreamIterationDefinitions(false);
        const iterations = [...fixture.iterations];
        const sourceDuplicate = iteration(required(definitions, 1), 9_999);
        const duplicate = {
            ...sourceDuplicate,
            processIdentity: {
                ...sourceDuplicate.processIdentity,
                electronPid: required(iterations, 0).processIdentity
                    .electronPid,
            },
        };
        iterations[1] = await persist(duplicate, 9_999);
        Object.defineProperty(iterations, 'map', {
            value() {
                return Array.from(
                    { length: iterations.length },
                    (_, index) => index
                );
            },
        });

        try {
            assert.throws(
                () =>
                    createXtreamBenchmarkSummary(
                        MANIFEST,
                        iterations,
                        fixture.diagnosticEvidence
                    ),
                /fresh process identity/
            );
        } finally {
            await Promise.all([
                clearXtreamReportFixtureDirectories(),
                clearXtreamProvenanceFixtureDirectories(),
            ]);
        }
    });

    it('uses native Map entries after validating diagnostic evidence', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        const entries = [...diagnosticEvidence.entries()];
        const [firstIteration, firstEvidence] = required(entries, 0);
        const [, secondEvidence] = required(entries, 1);
        const adversarial = new Map(entries);
        Object.defineProperty(adversarial, 'get', {
            value(key: (typeof entries)[number][0]) {
                return key === firstIteration
                    ? secondEvidence
                    : Map.prototype.get.call(this, key);
            },
        });

        try {
            const summary = createXtreamBenchmarkSummary(
                MANIFEST,
                iterations,
                adversarial
            );
            const scenario = summary.scenarios.find(
                ({ scenarioId }) => scenarioId === firstIteration.scenarioId
            );
            assert.equal(
                scenario?.diagnosticProfiles.artifactProvenance.directorySha256,
                firstEvidence.directorySha256
            );
        } finally {
            await clearXtreamProvenanceFixtureDirectories();
        }
    });

    it('snapshots every persistence receipt accessor exactly once', async () => {
        const definition = required(createXtreamIterationDefinitions(false), 1);
        const raw = iteration(definition, 1);
        const directory = await mkdtemp(
            join(tmpdir(), 'iptvnator-xtream-receipt-accessor-')
        );
        const regularPath = join(directory, 'raw.json');
        const symlinkPath = join(directory, 'raw-link.json');
        try {
            await assert.rejects(
                () =>
                    persistWith(raw, async (serialized) => {
                        await writeFile(regularPath, serialized);
                        await symlink(regularPath, symlinkPath);
                        let pathReads = 0;
                        return {
                            get absolutePath() {
                                pathReads += 1;
                                return pathReads === 1
                                    ? symlinkPath
                                    : regularPath;
                            },
                            bytes: Buffer.byteLength(serialized),
                            sha256: sha256(serialized),
                        } as XtreamPersistenceReceipt;
                    }),
                /persistence receipt/
            );

            let stablePathReads = 0;
            await persistWith(raw, async (serialized) => ({
                get absolutePath() {
                    stablePathReads += 1;
                    return regularPath;
                },
                bytes: Buffer.byteLength(serialized),
                sha256: sha256(serialized),
            }));
            assert.equal(stablePathReads, 1);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    it('uses one canonical manifest snapshot for validation and output', async () => {
        const { diagnosticEvidence, iterations } = await formalReportFixture();
        let variantReads = 0;
        const manifest = {
            ...MANIFEST,
            get variant() {
                variantReads += 1;
                return variantReads <= 3 ? 'baseline' : 'CON.json';
            },
        } as XtreamBenchmarkManifest;

        try {
            const summary = createXtreamBenchmarkSummary(
                manifest,
                iterations,
                diagnosticEvidence
            );
            assert.equal(summary.manifest.variant, 'baseline');
            assert.equal(variantReads, 1);
        } finally {
            await clearXtreamProvenanceFixtureDirectories();
        }
    });

    it('binds diagnostic profile durations and worker ordinal to artifact evidence', async () => {
        const fixture = await formalReportFixture();
        const [diagnostic, evidence] = required(
            [...fixture.diagnosticEvidence.entries()],
            0
        );
        const diagnosticIndex = fixture.iterations.indexOf(diagnostic);
        assert.notEqual(diagnosticIndex, -1);
        const raw = toXtreamRawIteration(diagnostic);
        const mismatches = [
            {
                ...raw,
                renderer: {
                    ...raw.renderer,
                    cpuProfileDurationMicros: 2_001,
                },
            },
            {
                ...raw,
                main: {
                    ...raw.main,
                    cpuProfileDurationMicros: 2_001,
                },
            },
            {
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    cpuProfileDurationMicros: 2_001,
                },
            },
            {
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    ordinal: raw.databaseWorker.ordinal + 1,
                },
            },
        ];

        try {
            for (const [index, mismatch] of mismatches.entries()) {
                const replacement = await persist(mismatch, 20_000 + index);
                const iterations = [...fixture.iterations];
                iterations[diagnosticIndex] = replacement;
                const diagnosticEvidence = new Map(fixture.diagnosticEvidence);
                diagnosticEvidence.delete(diagnostic);
                diagnosticEvidence.set(replacement, evidence);

                assert.throws(
                    () =>
                        createXtreamBenchmarkSummary(
                            MANIFEST,
                            iterations,
                            diagnosticEvidence
                        ),
                    /diagnostic artifact evidence binding/
                );
            }
        } finally {
            await Promise.all([
                clearXtreamReportFixtureDirectories(),
                clearXtreamProvenanceFixtureDirectories(),
            ]);
        }
    });
});

function required<T>(values: readonly T[], index: number): T {
    const value = values[index];
    assert.ok(value);
    return value;
}
