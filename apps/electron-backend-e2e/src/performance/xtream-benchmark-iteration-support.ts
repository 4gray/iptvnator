import { join } from 'node:path';

import {
    ELECTRON_RUNTIME_ENVIRONMENT_KEYS,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';
import {
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
    type XtreamPerformanceManifest,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { writeXtreamSafeJson } from './xtream-benchmark-artifacts';
import type { XtreamControlClient } from './xtream-control-client';
import { assertXtreamControlStateForScenario } from './xtream-control-client';
import {
    validateXtreamDiagnosticArtifacts,
    type XtreamDiagnosticArtifactEvidence,
} from './xtream-diagnostic-artifacts';
import {
    readXtreamMainCaptureStatus,
    startMainCapture,
    type MainCaptureStartOptions,
    type XtreamMainCaptureResult,
    type XtreamMainCaptureStatus,
} from './m3u-refresh-main-capture';
import { isXtreamMainCaptureSettled } from './xtream-main-settlement';
import type { XtreamRendererCaptureMetrics } from './xtream-renderer-capture';
import {
    assertCompleteXtreamRendererProbe,
    beginXtreamRendererOperation,
    stopXtreamRendererProbe,
    waitForXtreamRendererTerminal,
} from './xtream-renderer-probe-control';
import { installXtreamRendererProbe } from './xtream-renderer-probe';
import { prepareXtreamScenario } from './xtream-scenario-driver';
import type { XtreamArtifactSafetyContext } from './xtream-summary-contract';

export interface SeedXtreamExistingPortalOptions {
    readonly app: LaunchedElectronApp;
    readonly captureOptions: MainCaptureStartOptions;
    readonly control: XtreamControlClient;
    readonly fixture: XtreamPerformanceManifest;
    readonly iterationDirectory: string;
    readonly safety: XtreamArtifactSafetyContext;
    readonly serverUrl: string;
    readonly sourceTitle: string;
}

export async function prearmXtreamDatabaseWorker(
    app: LaunchedElectronApp
): Promise<void> {
    // Main owns schema creation but loads the renderer first. Fence that
    // startup promise before the independent worker opens the fresh database.
    const downloads = await app.mainWindow.evaluate(() =>
        window.electron.downloadsGetList()
    );
    if (!Array.isArray(downloads)) {
        throw new Error('xtream-main-database-readiness-invalid');
    }
    const playlists = await app.mainWindow.evaluate(() =>
        window.electron.dbGetAppPlaylists()
    );
    if (!Array.isArray(playlists)) {
        throw new Error('xtream-database-worker-prearm-invalid');
    }
}

export async function seedXtreamExistingPortal(
    options: SeedXtreamExistingPortalOptions
): Promise<void> {
    const seed = await prepareXtreamScenario(options.app.mainWindow, {
        scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
        serverUrl: options.serverUrl,
        sourceTitle: options.sourceTitle,
    });
    let rendererProbeInstalled = false;
    try {
        await installXtreamRendererProbe(options.app.mainWindow, {
            scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            sourceTitle: options.sourceTitle,
        });
        rendererProbeInstalled = true;
        await startMainCapture(options.app.electronApp, {
            ...options.captureOptions,
            deferMeasurement: false,
            diagnostic: false,
        });
        const captureGeneration = (
            await readXtreamMainCaptureStatus(options.app.electronApp)
        ).captureGeneration;
        await beginXtreamRendererOperation(options.app.mainWindow);
        await seed.trigger();
        const driverTerminal = seed.waitForTerminal();
        await waitForXtreamRendererTerminal(options.app.mainWindow);
        const rendererProbe = await stopXtreamRendererProbe(
            options.app.mainWindow
        );
        rendererProbeInstalled = false;
        assertCompleteXtreamRendererProbe(rendererProbe);
        await assertXtreamSettlementAfterTerminal({
            captureGeneration,
            readStatus: () =>
                readXtreamMainCaptureStatus(options.app.electronApp),
            scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            terminal: driverTerminal,
        });
        const state = await options.control.state();
        await writeXtreamSafeJson(
            join(options.iterationDirectory, 'seed-control-state.json'),
            state,
            options.safety
        );
        assertXtreamControlStateForScenario(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            state,
            options.fixture
        );
    } finally {
        await Promise.allSettled([
            rendererProbeInstalled
                ? stopXtreamRendererProbe(options.app.mainWindow)
                : Promise.resolve(),
            seed.dispose(),
        ]);
    }
}

export interface AssertXtreamSettlementAfterTerminalOptions {
    readonly captureGeneration: number;
    readonly readStatus: () => Promise<XtreamMainCaptureStatus>;
    readonly scenarioId: XtreamScenarioId;
    readonly terminal: Promise<unknown>;
}

export async function assertXtreamSettlementAfterTerminal(
    options: AssertXtreamSettlementAfterTerminalOptions
): Promise<void> {
    await options.terminal;
    const status = await options.readStatus();
    if (status.captureGeneration !== options.captureGeneration) {
        throw new Error('xtream-measured-capture-generation-changed');
    }
    if (!isXtreamMainCaptureSettled(status, options.scenarioId)) {
        throw new Error('xtream-main-not-settled-after-terminal');
    }
}

export interface FinalizeXtreamCaptureAfterRendererTerminalOptions<
    DriverTerminal,
    MainCapture,
    RendererCapture,
> extends Omit<AssertXtreamSettlementAfterTerminalOptions, 'terminal'> {
    readonly driverTerminal: Promise<DriverTerminal>;
    readonly rendererTerminal: Promise<unknown>;
    readonly stopMain: () => Promise<MainCapture>;
    readonly stopRenderer: () => Promise<RendererCapture>;
}

export interface FinalizedXtreamCapture<
    DriverTerminal,
    MainCapture,
    RendererCapture,
> {
    readonly driverTerminal: DriverTerminal;
    readonly mainCapture: MainCapture;
    readonly rendererCapture: RendererCapture;
}

export async function finalizeXtreamCaptureAfterRendererTerminal<
    DriverTerminal,
    MainCapture,
    RendererCapture,
>(
    options: FinalizeXtreamCaptureAfterRendererTerminalOptions<
        DriverTerminal,
        MainCapture,
        RendererCapture
    >
): Promise<
    FinalizedXtreamCapture<DriverTerminal, MainCapture, RendererCapture>
> {
    await assertXtreamSettlementAfterTerminal({
        captureGeneration: options.captureGeneration,
        readStatus: options.readStatus,
        scenarioId: options.scenarioId,
        terminal: options.rendererTerminal,
    });
    const rendererCapture = options.stopRenderer();
    const mainCapture = options.stopMain();
    const [resolvedRenderer, resolvedMain, driverTerminal] = await Promise.all([
        rendererCapture,
        mainCapture,
        options.driverTerminal,
    ]);
    return Object.freeze({
        driverTerminal,
        mainCapture: resolvedMain,
        rendererCapture: resolvedRenderer,
    });
}

export async function assertXtreamBenchmarkEnvironmentIsolated(
    app: LaunchedElectronApp
): Promise<void> {
    const keys = await app.electronApp.evaluate(() => Object.keys(process.env));
    const allowed = new Set(
        [
            ...ELECTRON_RUNTIME_ENVIRONMENT_KEYS,
            'ELECTRON_IS_DEV',
            'IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS',
            'IPTVNATOR_DB_WORKER_BATCH_DELAY_MS',
            'IPTVNATOR_E2E_DATA_DIR',
            'IPTVNATOR_PERF_CAPTURE',
            'IPTVNATOR_PERF_WORKER_PROFILING',
            'IPTVNATOR_TRACE_RENDERER_CONSOLE',
            'NODE_ENV',
        ].map((key) => key.toUpperCase())
    );
    if (
        !Array.isArray(keys) ||
        keys.some(
            (key) => typeof key !== 'string' || !allowed.has(key.toUpperCase())
        )
    ) {
        throw new Error('xtream-benchmark-environment-reached-electron');
    }
}

export function createXtreamSourceTitle(
    definition: XtreamIterationDefinition
): string {
    return `Synthetic Xtream 100k ${definition.scenarioId} ${definition.runId}`;
}

export async function createXtreamDiagnosticEvidence(
    kind: XtreamIterationDefinition['kind'],
    main: XtreamMainCaptureResult,
    renderer: XtreamRendererCaptureMetrics,
    iterationDirectory: string
): Promise<XtreamDiagnosticArtifactEvidence | null> {
    if (kind !== 'diagnostic') return null;
    return validateXtreamDiagnosticArtifacts(
        {
            main: {
                cpuProfilePath: main.capture.cpuProfilePath,
                heapSnapshotPath: main.capture.heapSnapshotPath,
                workers: main.workers.map(
                    ({
                        kind: workerKind,
                        ordinal,
                        profilePath,
                        snapshotPath,
                    }) => ({
                        kind: workerKind,
                        ordinal,
                        profilePath,
                        snapshotPath,
                    })
                ),
            },
            renderer: {
                cpuProfilePath: renderer.cpuProfilePath,
                heapSnapshotPath: renderer.heapSnapshotPath,
                tracePath: renderer.tracePath,
            },
        },
        iterationDirectory
    );
}
