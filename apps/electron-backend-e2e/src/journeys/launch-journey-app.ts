import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
    _electron as electron,
    type ElectronApplication,
    type Page,
} from '@playwright/test';

import { captureElectronProcess } from '../electron-process-lifecycle';
import {
    addXtreamPortal,
    buildElectronLaunchArgs,
    buildElectronLaunchEnvironment,
    closeElectronAppAndConfirmExit,
    electronAppExitConfirmationOptions,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    waitForM3uCatalog,
    waitForXtreamCatalog,
    type LaunchElectronAppOptions,
} from '../electron-test-fixtures';
import { closeElectronApplicationAndConfirmExit } from '../electron-process-lifecycle';
import {
    installJourneyMainIpcCapture,
    JOURNEY_MAIN_IPC_STATE_KEY,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    readJourneyMainIpcCapture,
} from '../performance/journey-main-ipc-capture';
import {
    assertJourneyMainCounters,
    readJourneyMainCounters,
} from '../performance/journey-main-counters';
import {
    journeyLaunchEnvironment,
    type JourneyLaunchInstrumentation,
} from '../performance/journey-launch-environment';
import {
    createLaunchJourneyProbeOptions,
    installJourneyRendererProbe,
    JOURNEY_IDLE_WINDOW_MS,
    waitForJourneyRendererProbe,
} from '../performance/journey-renderer-probe';
import {
    assertJourneyRendererGate,
    JOURNEY_RENDERER_GATE_KEY,
    readJourneyRendererGate,
} from './journey-renderer-gate-client';
import type { LaunchJourneyMeasurement } from '../performance/launch-journey-record';

/**
 * Process lifecycle for J1 "Launch to usable": one seeded profile template,
 * then a fresh Electron process on a fresh copy of that template per
 * iteration. Mirrors `xtream-benchmark-app-startup.ts` without the import
 * scaffolding that journey does not need.
 */
export const LAUNCH_JOURNEY_XTREAM_MOCK_PORT =
    process.env['IPTVNATOR_JOURNEY_XTREAM_MOCK_PORT'] ?? '3231';
export const LAUNCH_JOURNEY_MOCK_ORIGIN = `http://127.0.0.1:${LAUNCH_JOURNEY_XTREAM_MOCK_PORT}`;
/** Main-process hook loaded with `-r`; see journey-renderer-gate.cjs. */
export const JOURNEY_RENDERER_GATE_PATH = resolve(
    __dirname,
    '../performance/journey-renderer-gate.cjs'
);

function launchOptions(
    env: Record<string, string> = {}
): LaunchElectronAppOptions {
    return {
        env: { IPTVNATOR_TRACE_RENDERER_CONSOLE: '0', ...env },
        environmentInheritance: 'runtime-only',
        omitEnvKeys: [
            'IPTVNATOR_XTREAM_MOCK_CONTROL',
            'IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN',
        ],
    };
}

function removeDirectory(directory: string): Promise<void> {
    return rm(directory, {
        force: true,
        maxRetries: 20,
        recursive: true,
        retryDelay: 250,
    });
}

/** What a journey changes in the seeded profile; J1 and J2 use neither. */
export interface LaunchJourneySeedOptions {
    /** Portal credentials; default: the mock's default account. */
    readonly portal?: Parameters<typeof addXtreamPortal>[1];
    /** Runs after both sources are imported, e.g. to change settings. */
    readonly configure?: (page: Page) => Promise<void>;
}

/**
 * Seeds one M3U source and one Xtream portal through the app's own dialogs
 * and returns the data directory to copy for every measured launch.
 */
export async function seedLaunchJourneyProfile(
    mockOrigin: string,
    options: LaunchJourneySeedOptions = {}
): Promise<string> {
    const templateDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-journey-launch-seed-')
    );
    try {
        const app = await launchElectronApp(templateDirectory, launchOptions());
        try {
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                `${mockOrigin}/playlist.m3u`
            );
            await waitForM3uCatalog(app.mainWindow);
            await addXtreamPortal(app.mainWindow, {
                ...options.portal,
                serverUrl: mockOrigin,
            });
            await waitForXtreamCatalog(app.mainWindow);
            await options.configure?.(app.mainWindow);
        } finally {
            await closeElectronAppAndConfirmExit(app);
        }
        return templateDirectory;
    } catch (failure) {
        await removeDirectory(templateDirectory);
        throw failure;
    }
}

export function removeLaunchJourneyProfile(directory: string): Promise<void> {
    return removeDirectory(directory);
}

/**
 * How a journey launch is instrumented: the process flags, plus J1's idle
 * window after the settle point (null skips it, so a journey that continues
 * from the launch does not wait 30 s before its own start).
 */
export interface LaunchJourneyOptions extends JourneyLaunchInstrumentation {
    readonly idleWindowMs: number | null;
}

/** The running app after J1 ended, for journeys that continue from there. */
export interface LaunchJourneySession {
    readonly electronApp: ElectronApplication;
    readonly launch: LaunchJourneyMeasurement;
    readonly mainWindow: Page;
}

export async function measureLaunchJourney(
    templateDirectory: string,
    timeoutMs: number
): Promise<LaunchJourneyMeasurement> {
    const { launch } = await runLaunchJourney(
        templateDirectory,
        timeoutMs,
        { idleWindowMs: JOURNEY_IDLE_WINDOW_MS, mainCounters: true },
        async () => undefined
    );
    return launch;
}

/**
 * Spawns a fresh Electron process on a copy of the seeded profile. The gate
 * hook parks the first renderer load on `about:blank`, which gives Playwright
 * a page to attach the renderer probe to; the main-process IPC capture is
 * installed next, and only then is the real load released. Both captures are
 * therefore in place before the renderer runs any script, and the probe,
 * capture and gate records still prove it. `continueJourney` runs in the
 * same process after J1's counters are final (and after its idle window,
 * when one is requested), before the app is closed.
 * Without `instrumentation.mainCounters` the main-process counters and SQL
 * counting stay off and `launch.mainCounters` is null.
 */
export async function runLaunchJourney<T>(
    templateDirectory: string,
    timeoutMs: number,
    instrumentation: LaunchJourneyOptions,
    continueJourney: (session: LaunchJourneySession) => Promise<T>
): Promise<{
    readonly continuation: T;
    readonly launch: LaunchJourneyMeasurement;
}> {
    const dataDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-journey-launch-')
    );
    try {
        await cp(templateDirectory, dataDirectory, { recursive: true });
        const env = buildElectronLaunchEnvironment(
            dataDirectory,
            launchOptions(journeyLaunchEnvironment(instrumentation))
        );
        const args = buildElectronLaunchArgs([
            '-r',
            JOURNEY_RENDERER_GATE_PATH,
        ]);
        const spawnEpochMs = Date.now();
        const electronApp = await electron.launch({ args, env });
        captureElectronProcess(electronApp);
        try {
            const probeOptions = createLaunchJourneyProbeOptions(
                instrumentation.idleWindowMs
            );
            // The gate parks the window on about:blank, so this resolves
            // before the real document exists.
            const mainWindow = await electronApp.firstWindow();
            if (mainWindow.url() !== 'about:blank') {
                throw new Error(
                    `journey-renderer-gate-missing: first document is ${mainWindow.url()}`
                );
            }
            await installJourneyRendererProbe(mainWindow, probeOptions);
            await installJourneyMainIpcCapture(electronApp, {
                channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
                sentinelId: probeOptions.sentinelId,
                sentinelMethod: probeOptions.sentinelMethod,
                stateKey: JOURNEY_MAIN_IPC_STATE_KEY,
            });
            await readJourneyRendererGate(
                electronApp,
                JOURNEY_RENDERER_GATE_KEY,
                'release'
            );
            // The page object is still on about:blank; wait for the real
            // document to commit before touching its execution context.
            await mainWindow.waitForURL((url) => url.href !== 'about:blank', {
                timeout: timeoutMs,
                waitUntil: 'commit',
            });
            await assertJourneyRendererProbeInstalled(
                mainWindow,
                probeOptions.stateKey
            );
            const renderer = await waitForJourneyRendererProbe(
                mainWindow,
                probeOptions.stateKey,
                timeoutMs
            );
            // Re-read after the probe finished: a reload or recovery
            // navigation during startup shows up as a pass-through load
            // only in the live state, and such an iteration is invalid.
            const gate = assertJourneyRendererGate(
                await readJourneyRendererGate(
                    electronApp,
                    JOURNEY_RENDERER_GATE_KEY,
                    'read'
                ),
                renderer.installed.epochMs
            );
            const ipc = await readJourneyMainIpcCapture(
                electronApp,
                JOURNEY_MAIN_IPC_STATE_KEY,
                10_000
            );
            // Read after the probe finished, so both frozen counters exist.
            const mainCounters = instrumentation.mainCounters
                ? assertJourneyMainCounters(
                      await readJourneyMainCounters(
                          electronApp,
                          JOURNEY_RENDERER_GATE_KEY
                      ),
                      gate
                  )
                : null;
            if (ipc.installedEpochMs > renderer.installed.epochMs) {
                throw new Error('journey-main-ipc-capture-installed-late');
            }
            const electronVersion = await electronApp.evaluate(
                () => process.versions.electron
            );
            const launch: LaunchJourneyMeasurement = {
                electronVersion,
                gate,
                ipc,
                mainCounters,
                pid: electronApp.process().pid ?? -1,
                renderer,
                spawnEpochMs,
            };
            const continuation = await continueJourney({
                electronApp,
                launch,
                mainWindow,
            });
            return { continuation, launch };
        } finally {
            await closeElectronApplicationAndConfirmExit(
                electronApp,
                electronAppExitConfirmationOptions()
            );
        }
    } finally {
        await removeDirectory(dataDirectory);
    }
}

async function assertJourneyRendererProbeInstalled(
    mainWindow: Page,
    stateKey: string
): Promise<void> {
    const installed = await mainWindow.evaluate(
        (key) =>
            (globalThis as unknown as Record<string, unknown>)[key] !==
            undefined,
        stateKey
    );
    if (!installed) {
        throw new Error('journey-renderer-probe-not-installed');
    }
}
