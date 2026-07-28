import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    closeElectronApp,
    launchElectronApp,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';
import {
    type XtreamIterationDefinition,
    type XtreamPerformanceManifest,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';
import type { XtreamBenchmarkConfiguration } from './xtream-benchmark-configuration';
import type { XtreamControlClient } from './xtream-control-client';
import {
    assertXtreamControlReadyAfterObservationReset,
    assertXtreamControlStateForScenario,
    assertXtreamManifestIdentity,
} from './xtream-control-client';
import { createXtreamCatalogVerification } from './xtream-catalog-database-verification';
import { readXtreamCatalogDatabaseSnapshot } from './xtream-catalog-database-reader';
import { assembleXtreamRawIteration } from './xtream-iteration-assembler';
import {
    beginXtreamMainMeasurement,
    installMainCapture,
    readXtreamMainCaptureStatus,
    rolloverXtreamMainCapture,
    startMainCapture,
    stopXtreamMainCapture,
    type MainCaptureStartOptions,
} from './m3u-refresh-main-capture';
import {
    assertRendererCdpTarget,
    assertTcpPortAvailable,
    resolveRendererWindowIdentity,
} from './m3u-import-benchmark-support';
import { assertPerformanceArtifactCapacity } from './performance-artifact-preflight';
import {
    createXtreamArtifactSafetyContext,
    persistXtreamIteration,
    writeXtreamSafeJson,
    type PersistedXtreamIteration,
} from './xtream-benchmark-artifacts';
import {
    createXtreamSingleAttemptCapture,
    persistXtreamIterationFailureEvidenceAndThrow,
    type XtreamBenchmarkFailureStage,
} from './xtream-benchmark-lifecycle';
import {
    assertXtreamBenchmarkEnvironmentIsolated,
    createXtreamDiagnosticEvidence,
    createXtreamSourceTitle,
    finalizeXtreamCaptureAfterRendererTerminal,
    prearmXtreamDatabaseWorker,
    seedXtreamExistingPortal,
} from './xtream-benchmark-iteration-support';
import {
    deriveXtreamMeasuredPlaylistId,
    disableGenericElectronFixtureProbes,
    xtreamScenarioRequiresSeed,
} from './xtream-benchmark-runtime';
import {
    captureXtreamLaunchIdentity,
    createXtreamIterationProcessEvidence,
} from './xtream-process-evidence';
import {
    startXtreamRendererCapture,
    type RunningXtreamRendererCapture,
} from './xtream-renderer-capture';
import {
    prepareXtreamScenario,
    type PreparedXtreamScenario,
    type XtreamScenarioTerminalEvidence,
    type XtreamScenarioTriggerEvidence,
} from './xtream-scenario-driver';
import { runXtreamBackgroundUiActions } from './xtream-ui-action-probe';

export interface XtreamBenchmarkIterationContext {
    readonly configuration: XtreamBenchmarkConfiguration;
    readonly control: XtreamControlClient;
    readonly definition: XtreamIterationDefinition;
    readonly expectedFixture: XtreamPerformanceManifest;
    readonly scenarioDirectory: string;
    readonly seenElectronPids: Set<number>;
}
export async function runXtreamBenchmarkIteration(
    context: XtreamBenchmarkIterationContext
): Promise<PersistedXtreamIteration> {
    const { configuration, control, definition, scenarioDirectory } = context;
    const iterationDirectory = join(scenarioDirectory, definition.runId);
    await assertPerformanceArtifactCapacity(iterationDirectory);
    await mkdir(iterationDirectory, {
        mode: 0o700,
        recursive: false,
    });
    const dataDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-xtream-performance-')
    );
    const safety = createXtreamArtifactSafetyContext(
        configuration.controlToken
    );
    let app: LaunchedElectronApp | null = null;
    let renderer: RunningXtreamRendererCapture | null = null;
    let prepared: PreparedXtreamScenario | null = null;
    let controlState: Awaited<ReturnType<XtreamControlClient['state']>> | null =
        null;
    let failureStage: XtreamBenchmarkFailureStage = 'capture-setup';
    let stopMainCaptureOnce:
        (() => ReturnType<typeof stopXtreamMainCapture>) | null = null;
    let stopRendererCaptureOnce: RunningXtreamRendererCapture['stop'] | null =
        null;
    let terminal: XtreamScenarioTerminalEvidence | null = null;
    let trigger: XtreamScenarioTriggerEvidence | null = null;
    try {
        await control.resetAll();
        const fixture = await control.prepare();
        assertXtreamManifestIdentity(context.expectedFixture, fixture);
        await assertTcpPortAvailable(configuration.cdpPort);
        app = await launchElectronApp(dataDirectory, {
            args: [
                '--js-flags=--expose-gc',
                '--remote-debugging-address=127.0.0.1',
                `--remote-debugging-port=${configuration.cdpPort}`,
                `--user-data-dir=${join(dataDirectory, 'user-data')}`,
            ],
            environmentInheritance: 'runtime-only',
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: '0',
                IPTVNATOR_PERF_CAPTURE: '1',
                IPTVNATOR_PERF_WORKER_PROFILING: '1',
                IPTVNATOR_TRACE_RENDERER_CONSOLE: '0',
            },
            omitEnvKeys: [
                'IPTVNATOR_XTREAM_MOCK_CONTROL',
                'IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN',
            ],
        });
        app.mainWindow.setDefaultTimeout(10 * 60 * 1_000);
        await assertXtreamBenchmarkEnvironmentIsolated(app);
        await disableGenericElectronFixtureProbes(app.mainWindow);
        await assertRendererCdpTarget(app.mainWindow, configuration.cdpPort);
        await installMainCapture(app.electronApp);
        await prearmXtreamDatabaseWorker(app);
        const electronApp = app.electronApp;
        const launch = await captureXtreamLaunchIdentity(
            app.electronApp,
            app.electronApp.process().pid,
            context.seenElectronPids
        );
        const rendererWindowIdentity = await resolveRendererWindowIdentity(app);
        const captureOptions: MainCaptureStartOptions = {
            deferMeasurement: true,
            diagnostic: definition.kind === 'diagnostic',
            outputDirectory: iterationDirectory,
            rendererWindowIdentity,
        };
        const sourceTitle = createXtreamSourceTitle(definition);
        const seeded = xtreamScenarioRequiresSeed(definition.scenarioId);
        if (seeded) {
            failureStage = 'seed';
            stopMainCaptureOnce = createXtreamSingleAttemptCapture(() =>
                stopXtreamMainCapture(electronApp)
            );
            await seedXtreamExistingPortal({
                app,
                captureOptions,
                control,
                fixture,
                iterationDirectory,
                safety,
                serverUrl: configuration.mockOrigin,
                sourceTitle,
            });
        }
        failureStage = 'scenario-preparation';
        prepared = await prepareXtreamScenario(app.mainWindow, {
            scenarioId: definition.scenarioId,
            serverUrl: configuration.mockOrigin,
            sourceTitle,
        });
        await control.resetObservations();
        assertXtreamControlReadyAfterObservationReset(
            await control.state(),
            fixture
        );
        let captureGeneration: number;
        failureStage = 'measured-capture-start';
        if (seeded) {
            const rolloverOnce = createXtreamSingleAttemptCapture(() =>
                rolloverXtreamMainCapture(electronApp, captureOptions)
            );
            stopMainCaptureOnce = rolloverOnce;
            const rollover = await rolloverOnce();
            stopMainCaptureOnce = createXtreamSingleAttemptCapture(() =>
                stopXtreamMainCapture(electronApp)
            );
            if (
                !rollover.rollover?.nextCaptureStarted ||
                rollover.rollover.nextCaptureUnavailableReason !== null
            ) {
                throw new Error('xtream-measured-capture-rollover-failed');
            }
            await writeXtreamSafeJson(
                join(iterationDirectory, 'seed-main-capture.json'),
                rollover,
                safety
            );
            captureGeneration = rollover.captureGeneration + 1;
            if (
                (await readXtreamMainCaptureStatus(app.electronApp))
                    .captureGeneration !== captureGeneration
            ) {
                throw new Error('xtream-measured-capture-generation-changed');
            }
        } else {
            stopMainCaptureOnce = createXtreamSingleAttemptCapture(() =>
                stopXtreamMainCapture(electronApp)
            );
            await startMainCapture(app.electronApp, captureOptions);
            captureGeneration = (
                await readXtreamMainCaptureStatus(app.electronApp)
            ).captureGeneration;
        }
        failureStage = 'renderer-capture-start';
        renderer = await startXtreamRendererCapture(app.mainWindow, {
            diagnostic: definition.kind === 'diagnostic',
            outputDirectory: iterationDirectory,
            scenarioId: definition.scenarioId,
            sourceTitle,
        });
        const runningRenderer = renderer;
        stopRendererCaptureOnce = createXtreamSingleAttemptCapture(() =>
            runningRenderer.stop()
        );
        await beginXtreamMainMeasurement(app.electronApp);
        await renderer.beginOperation();
        failureStage = 'operation-trigger';
        trigger = await prepared.trigger();
        if (definition.scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI) {
            failureStage = 'background-ui';
            await prepared.runBackgroundProbe(
                ({ operationId, page, playlistId }) =>
                    runXtreamBackgroundUiActions(page, {
                        operationId,
                        playlistId,
                        searchTerm: 'Performance',
                    })
            );
        }
        failureStage = 'terminal-settlement';
        const terminalPromise = prepared.waitForTerminal().then((value) => {
            terminal = value;
            return value;
        });
        if (!stopRendererCaptureOnce || !stopMainCaptureOnce) {
            throw new Error('xtream-measured-capture-lifecycle-invalid');
        }
        const finalized = await finalizeXtreamCaptureAfterRendererTerminal({
            captureGeneration,
            driverTerminal: terminalPromise,
            readStatus: () => readXtreamMainCaptureStatus(app.electronApp),
            rendererTerminal: renderer.waitForTerminal(),
            scenarioId: definition.scenarioId,
            stopMain: stopMainCaptureOnce,
            stopRenderer: stopRendererCaptureOnce,
        });
        terminal = finalized.driverTerminal;
        const { mainCapture, rendererCapture } = finalized;
        if (!terminal) {
            throw new Error('xtream-measured-capture-lifecycle-invalid');
        }
        if (mainCapture.captureGeneration !== captureGeneration) {
            throw new Error('xtream-measured-capture-generation-changed');
        }
        controlState = await control.state();
        failureStage = 'evidence-validation';
        await Promise.all([
            writeXtreamSafeJson(
                join(iterationDirectory, 'main-capture.json'),
                mainCapture,
                safety
            ),
            writeXtreamSafeJson(
                join(iterationDirectory, 'renderer-capture.json'),
                rendererCapture,
                safety
            ),
            writeXtreamSafeJson(
                join(iterationDirectory, 'terminal-evidence.json'),
                terminal,
                safety
            ),
            writeXtreamSafeJson(
                join(iterationDirectory, 'trigger-evidence.json'),
                trigger,
                safety
            ),
            writeXtreamSafeJson(
                join(iterationDirectory, 'control-state.json'),
                controlState,
                safety
            ),
        ]);
        assertXtreamControlStateForScenario(
            definition.scenarioId,
            controlState,
            fixture
        );
        const playlistId = deriveXtreamMeasuredPlaylistId(mainCapture.requests);
        const catalogSnapshot = await readXtreamCatalogDatabaseSnapshot(
            app.electronApp,
            {
                captureStoppedEpochMs: mainCapture.captureStoppedEpochMs,
                dataDirectory,
                playlistId,
                requireFromPath: join(
                    configuration.workspaceRoot,
                    'dist/apps/electron-backend/main.js'
                ),
            }
        );
        await writeXtreamSafeJson(
            join(iterationDirectory, 'catalog-snapshot.json'),
            catalogSnapshot,
            safety
        );
        const catalogVerification = createXtreamCatalogVerification(
            catalogSnapshot,
            fixture,
            definition.scenarioId
        );
        const diagnosticEvidence = await createXtreamDiagnosticEvidence(
            definition.kind,
            mainCapture,
            rendererCapture,
            iterationDirectory
        );
        const processEvidence = await createXtreamIterationProcessEvidence({
            ...launch,
            diagnosticDirectorySha256:
                diagnosticEvidence?.directorySha256 ?? null,
            iterationDirectory,
        });
        const raw = assembleXtreamRawIteration({
            catalogVerification,
            definition,
            diagnosticArtifacts: diagnosticEvidence,
            mainCapture,
            process: processEvidence,
            rendererCapture,
            terminal,
            trigger,
        });
        failureStage = 'result-persistence';
        return persistXtreamIteration(
            iterationDirectory,
            raw,
            diagnosticEvidence,
            safety
        );
    } catch (failure) {
        const electronApp = app?.electronApp;
        await persistXtreamIterationFailureEvidenceAndThrow(failure, {
            evidence: {
                control: async () => controlState ?? control.state(),
                ...(electronApp
                    ? {
                          mainStatus: () =>
                              readXtreamMainCaptureStatus(electronApp),
                      }
                    : {}),
                ...(stopMainCaptureOnce
                    ? { mainCapture: stopMainCaptureOnce }
                    : {}),
                ...(stopRendererCaptureOnce
                    ? { rendererCapture: stopRendererCaptureOnce }
                    : {}),
                ...(terminal ? { terminal: async () => terminal } : {}),
                ...(trigger ? { trigger: async () => trigger } : {}),
            },
            persist: (filename, value) =>
                writeXtreamSafeJson(
                    join(iterationDirectory, filename),
                    value,
                    safety
                ),
            stage: failureStage,
        });
    } finally {
        await prepared?.dispose().catch(() => undefined);
        await renderer?.dispose().catch(() => undefined);
        if (app) await closeElectronApp(app);
        await rm(dataDirectory, { force: true, recursive: true }).catch(
            () => undefined
        );
    }
}
