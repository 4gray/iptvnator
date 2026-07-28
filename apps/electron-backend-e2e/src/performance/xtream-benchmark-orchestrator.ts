import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
    createXtreamIterationDefinitions,
    listXtreamBenchmarkScenarios,
} from './xtream-benchmark-contract';
import {
    assertXtreamBenchmarkBuildUnchanged,
    createXtreamBenchmarkManifest,
    resolveXtreamBenchmarkConfiguration,
} from './xtream-benchmark-configuration';
import {
    createXtreamArtifactSafetyContext,
    writeXtreamSafeJson,
} from './xtream-benchmark-artifacts';
import { runXtreamBenchmarkIteration } from './xtream-benchmark-iteration';
import { createXtreamBenchmarkSummary } from './xtream-benchmark-report';
import {
    assertXtreamControlReadyAfterObservationReset,
    createXtreamControlClient,
} from './xtream-control-client';
import type { XtreamDiagnosticArtifactEvidence } from './xtream-diagnostic-artifacts';
import type { XtreamValidatedIterationResult } from './xtream-summary-contract';

export async function runXtreamBenchmark(): Promise<void> {
    const configuration = await resolveXtreamBenchmarkConfiguration();
    const safety = createXtreamArtifactSafetyContext(
        configuration.controlToken
    );
    const control = createXtreamControlClient({
        origin: configuration.mockOrigin,
        token: configuration.controlToken,
    });
    const iterations: XtreamValidatedIterationResult[] = [];
    const diagnosticEvidence = new Map<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >();
    const seenElectronPids = new Set<number>();
    try {
        await control.resetAll();
        const expectedFixture = await control.prepare();
        await control.resetObservations();
        assertXtreamControlReadyAfterObservationReset(
            await control.state(),
            expectedFixture
        );
        const manifest = createXtreamBenchmarkManifest(
            configuration,
            expectedFixture
        );
        await writeXtreamSafeJson(
            join(configuration.outputDirectory, 'manifest.json'),
            manifest,
            safety
        );
        const definitions = createXtreamIterationDefinitions(
            configuration.smoke
        );
        for (const scenario of listXtreamBenchmarkScenarios()) {
            const scenarioDirectory = join(
                configuration.outputDirectory,
                scenario.id
            );
            await mkdir(scenarioDirectory, {
                mode: 0o700,
                recursive: false,
            });
            for (const definition of definitions.filter(
                ({ scenarioId }) => scenarioId === scenario.id
            )) {
                console.log(
                    `[performance] ${configuration.variant}/${scenario.id}/${definition.runId} starting`
                );
                const persisted = await runXtreamBenchmarkIteration({
                    configuration,
                    control,
                    definition,
                    expectedFixture,
                    scenarioDirectory,
                    seenElectronPids,
                });
                iterations.push(persisted.iteration);
                if (persisted.diagnosticEvidence) {
                    diagnosticEvidence.set(
                        persisted.iteration,
                        persisted.diagnosticEvidence
                    );
                }
                console.log(
                    `[performance] ${scenario.id}/${definition.runId} total=${persisted.iteration.phases.totalMs.toFixed(3)}ms`
                );
            }
        }
        await assertXtreamBenchmarkBuildUnchanged(configuration);
        const summary = createXtreamBenchmarkSummary(
            manifest,
            iterations,
            diagnosticEvidence
        );
        await writeXtreamSafeJson(
            join(configuration.outputDirectory, 'summary.json'),
            summary,
            safety
        );
        if (summary.validForComparison !== (configuration.mode === 'formal')) {
            throw new Error('xtream-benchmark-comparison-validity-invalid');
        }
        console.log(
            `[performance] completed: ${join(
                configuration.outputDirectory,
                'summary.json'
            )}`
        );
    } finally {
        await control.resetAll().catch(() => undefined);
    }
}
