import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    closeElectronApp,
    expect,
    launchElectronApp,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';
import { validateInitialImportDiagnosticArtifacts } from './initial-import-diagnostic-artifacts';
import {
    assertRendererCdpTarget,
    assertTcpPortAvailable,
    type M3uImportBenchmarkConfiguration,
    resolveM3uImportBenchmarkConfiguration,
    resolveRendererWindowIdentity,
    writeM3uImportJson as writeJson,
} from './m3u-import-benchmark-support';
import {
    assertSyntheticM3uImportUrl,
    createM3uImportIterationDefinitions,
    listM3uImportScenarios,
    type M3uImportIterationDefinition,
    type M3uImportScenario,
} from './m3u-import-benchmark-contract';
import {
    createM3uImportBenchmarkSummary,
    createM3uImportIterationResult,
    type M3uImportBenchmarkManifest,
    type M3uImportBenchmarkSummary,
    type M3uImportIterationResult,
} from './m3u-import-summary';
import {
    startM3uImportRendererCapture,
    type RunningM3uImportRendererCapture,
} from './m3u-import-renderer-capture';
import {
    installMainCapture,
    readMainCaptureStatus,
    startMainCapture,
    stopMainCapture,
} from './m3u-refresh-main-capture';
import { PERFORMANCE_ITERATION_KIND } from './m3u-refresh-cancellation-contract';
import { assertPerformanceArtifactCapacity } from './performance-artifact-preflight';
import {
    startSyntheticM3uServer,
    type SyntheticM3uServer,
} from './synthetic-m3u-server';
import {
    createSyntheticM3uFixture,
    SYNTHETIC_M3U_SEED,
    type SyntheticM3uFixture,
} from './synthetic-m3u';

export async function runM3uImportBenchmark(): Promise<void> {
    const config = await resolveM3uImportBenchmarkConfiguration();
    const definitions = createM3uImportIterationDefinitions(config.smoke);

    for (const scenario of listM3uImportScenarios()) {
        await runScenario(
            config,
            scenario,
            definitions.filter(
                (definition) => definition.scenarioId === scenario.id
            )
        );
    }
}

async function runScenario(
    config: M3uImportBenchmarkConfiguration,
    scenario: M3uImportScenario,
    definitions: readonly M3uImportIterationDefinition[]
): Promise<void> {
    const fixture = createSyntheticM3uFixture(scenario.channelCount);
    const server = await startSyntheticM3uServer(fixture);
    const scenarioDirectory = join(config.variantDirectory, scenario.id);
    const iterations: M3uImportIterationResult[] = [];

    try {
        assertSyntheticM3uImportUrl(server.resourceUrl);
        await server.prime();
        await assertPerformanceArtifactCapacity(scenarioDirectory);
        await mkdir(scenarioDirectory, {
            mode: 0o700,
            recursive: false,
        });
        for (const definition of definitions) {
            console.log(
                `[performance] ${config.variant}/${scenario.id}/${definition.runId} starting`
            );
            const result = await runIteration(
                config,
                definition,
                fixture,
                server,
                scenarioDirectory
            );
            iterations.push(result);
            console.log(
                `[performance] ${definition.runId} total=${result.phases.totalMs.toFixed(3)}ms`
            );
        }
    } finally {
        await server.close();
    }

    if (server.requestCount() !== definitions.length + 1) {
        throw new Error('Synthetic M3U server request total is invalid');
    }
    const manifest = createManifest(config, scenario, fixture);
    const summary = createM3uImportBenchmarkSummary(manifest, iterations);
    await writeJson(join(scenarioDirectory, 'manifest.json'), manifest);
    await writeJson(join(scenarioDirectory, 'summary.json'), summary);
    const diagnostic = requireDiagnosticIteration(iterations);
    await validateInitialImportDiagnosticArtifacts(
        { main: diagnostic.main, renderer: diagnostic.renderer },
        join(scenarioDirectory, diagnostic.runId)
    );
    assertM3uImportComparisonValidity(summary);
    console.log(
        `[performance] completed: ${join(scenarioDirectory, 'summary.json')}`
    );
}

export function assertM3uImportComparisonValidity(
    summary: M3uImportBenchmarkSummary
): void {
    if (!summary.validity.rendererRss.validForComparison) {
        throw new Error(
            `Renderer RSS capture is invalid for comparison: ${JSON.stringify(
                summary.validity.rendererRss.invalidMeasuredRuns
            )}`
        );
    }
    if (!summary.validity.databaseWorkerPostGc.validForComparison) {
        throw new Error(
            `Database worker post-GC capture is invalid for comparison: ${JSON.stringify(
                summary.validity.databaseWorkerPostGc.invalidMeasuredRuns
            )}`
        );
    }
    if (!summary.validity.databaseWorkerPeakMemory.validForComparison) {
        throw new Error(
            `Database worker peak-memory capture is invalid for comparison: ${JSON.stringify(
                summary.validity.databaseWorkerPeakMemory.invalidMeasuredRuns
            )}`
        );
    }
    if (!summary.validity.databaseWorkerRequestMetrics.validForComparison) {
        throw new Error(
            `Database worker request metrics are invalid for comparison: ${JSON.stringify(
                summary.validity.databaseWorkerRequestMetrics.invalidRequests
            )}`
        );
    }
}

async function runIteration(
    config: M3uImportBenchmarkConfiguration,
    definition: M3uImportIterationDefinition,
    fixture: SyntheticM3uFixture,
    server: SyntheticM3uServer,
    scenarioDirectory: string
): Promise<M3uImportIterationResult> {
    const iterationDirectory = join(scenarioDirectory, definition.runId);
    await assertPerformanceArtifactCapacity(iterationDirectory);
    await mkdir(iterationDirectory, {
        mode: 0o700,
        recursive: false,
    });
    const dataDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-m3u-import-performance-')
    );
    let app: LaunchedElectronApp | null = null;
    let renderer: RunningM3uImportRendererCapture | null = null;

    try {
        await assertTcpPortAvailable(config.rendererCdpPort);
        app = await launchElectronApp(dataDirectory, {
            args: [
                '--js-flags=--expose-gc',
                '--remote-debugging-address=127.0.0.1',
                `--remote-debugging-port=${config.rendererCdpPort}`,
                `--user-data-dir=${join(dataDirectory, 'user-data')}`,
            ],
            environmentInheritance: 'runtime-only',
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: '0',
                IPTVNATOR_PERF_CAPTURE: '1',
                IPTVNATOR_PERF_WORKER_PROFILING: '1',
                IPTVNATOR_TRACE_RENDERER_CONSOLE:
                    process.env['IPTVNATOR_TRACE_RENDERER_CONSOLE'] ?? '0',
            },
        });
        app.mainWindow.setDefaultTimeout(120_000);
        await assertRendererCdpTarget(app.mainWindow, config.rendererCdpPort);
        await installMainCapture(app.electronApp);
        const rendererWindowIdentity = await resolveRendererWindowIdentity(app);
        const requestsBefore = server.requestCount();
        const diagnostic =
            definition.kind === PERFORMANCE_ITERATION_KIND.DIAGNOSTIC;
        renderer = await startM3uImportRendererCapture(app.mainWindow, {
            diagnostic,
            outputDirectory: iterationDirectory,
            playlistTitle: `Synthetic M3U import ${definition.channelCount}`,
            playlistUrl: server.resourceUrl,
        });

        await startMainCapture(app.electronApp, {
            diagnostic,
            outputDirectory: iterationDirectory,
            rendererWindowIdentity,
        });
        await renderer.triggerImport();
        await renderer.waitForTerminal();
        await waitForDatabaseSettlement(app);
        assertM3uImportRequestDelta(requestsBefore, server.requestCount());

        const [rendererMetrics, mainMetrics] = await Promise.all([
            renderer.stop(),
            stopMainCapture(app.electronApp),
        ]);
        await Promise.all([
            writeJson(
                join(iterationDirectory, 'main-capture.json'),
                mainMetrics
            ),
            writeJson(
                join(iterationDirectory, 'renderer-capture.json'),
                rendererMetrics
            ),
        ]);
        const result = createM3uImportIterationResult({
            channelCount: definition.channelCount,
            fixtureBytes: fixture.bytes,
            kind: definition.kind,
            main: mainMetrics,
            renderer: rendererMetrics,
            runId: definition.runId,
            scenarioId: definition.scenarioId,
        });
        await writeJson(join(iterationDirectory, 'result.json'), result);
        return result;
    } finally {
        if (renderer) {
            await renderer.dispose().catch((error: unknown) => {
                console.error(
                    '[performance] Renderer capture cleanup failed',
                    error
                );
            });
        }
        if (app) {
            await closeElectronApp(app).catch((error: unknown) => {
                console.error('[performance] Electron cleanup failed', error);
            });
        }
        await rm(dataDirectory, { force: true, recursive: true });
    }
}

async function waitForDatabaseSettlement(
    app: LaunchedElectronApp
): Promise<void> {
    await expect
        .poll(
            async () => {
                const status = await readMainCaptureStatus(app.electronApp);
                return (
                    status.databaseRequests === 2 &&
                    status.databaseUpsertsCompleted === 1 &&
                    status.databaseGetsCompleted === 1 &&
                    status.databasePending === 0 &&
                    status.preloadSuccessMarkers === 2
                );
            },
            { timeout: 120_000 }
        )
        .toBe(true);
}

function createManifest(
    config: M3uImportBenchmarkConfiguration,
    scenario: M3uImportScenario,
    fixture: SyntheticM3uFixture
): M3uImportBenchmarkManifest {
    return Object.freeze({
        channelCount: fixture.channelCount,
        fixtureBytes: fixture.bytes,
        fixtureSha256: fixture.sha256,
        gitCommit: config.sourceState.commit,
        gitDiffSha256: config.sourceState.diffSha256,
        gitDirty: config.sourceState.dirty,
        measuredRuns: config.measuredRuns,
        memoryAccounting: Object.freeze({
            databaseWorkerRss: 'unavailable-per-worker-thread',
            mainRss:
                'electron-main-process-including-worker-threads-and-native-memory',
            nativeAndSqliteMemory:
                'included-in-main-rss-not-separately-attributable',
            rendererRss: 'separate-renderer-process',
            workerJsHeap: 'separate-v8-isolate',
        }),
        runtime: Object.freeze({
            arch: process.arch,
            cdpPort: config.rendererCdpPort,
            electronVersion: config.electronVersion,
            harnessNodeVersion: process.versions.node,
            platform: process.platform,
        }),
        scenario: scenario.id,
        syntheticSeed: SYNTHETIC_M3U_SEED,
        variant: config.variant,
        warmupRuns: 1,
    });
}

function requireDiagnosticIteration(
    iterations: readonly M3uImportIterationResult[]
): M3uImportIterationResult {
    const diagnostic = iterations.filter(
        (iteration) => iteration.kind === PERFORMANCE_ITERATION_KIND.DIAGNOSTIC
    );
    if (diagnostic.length !== 1 || !diagnostic[0]) {
        throw new Error('M3U import diagnostic iteration is missing');
    }
    return diagnostic[0];
}

export function assertM3uImportRequestDelta(
    before: number,
    after: number
): void {
    const oneRequest =
        Number.isSafeInteger(before) &&
        Number.isSafeInteger(after) &&
        after === before + 1;
    if (!oneRequest) {
        throw new Error(
            'Synthetic M3U import must issue exactly one application GET'
        );
    }
}
