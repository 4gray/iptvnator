import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { _electron as electron, type Page } from '@playwright/test';

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
    createLaunchJourneyProbeOptions,
    installJourneyRendererProbe,
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

/**
 * Seeds one M3U source and one Xtream portal through the app's own dialogs
 * and returns the data directory to copy for every measured launch.
 */
export async function seedLaunchJourneyProfile(
    mockOrigin: string
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
            await addXtreamPortal(app.mainWindow, { serverUrl: mockOrigin });
            await waitForXtreamCatalog(app.mainWindow);
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
 * Spawns a fresh Electron process on a copy of the seeded profile. The gate
 * hook parks the first renderer load on `about:blank`, which gives Playwright
 * a page to attach the renderer probe to; the main-process IPC capture is
 * installed next, and only then is the real load released. Both captures are
 * therefore in place before the renderer runs any script, and the probe,
 * capture and gate records still prove it.
 */
export async function measureLaunchJourney(
    templateDirectory: string,
    timeoutMs: number
): Promise<LaunchJourneyMeasurement> {
    const dataDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-journey-launch-')
    );
    try {
        await cp(templateDirectory, dataDirectory, { recursive: true });
        const env = buildElectronLaunchEnvironment(
            dataDirectory,
            launchOptions({ IPTVNATOR_TRACE_IPC: '1' })
        );
        const args = buildElectronLaunchArgs([
            '-r',
            JOURNEY_RENDERER_GATE_PATH,
        ]);
        const spawnEpochMs = Date.now();
        const electronApp = await electron.launch({ args, env });
        captureElectronProcess(electronApp);
        try {
            const probeOptions = createLaunchJourneyProbeOptions();
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
            const gate = await readJourneyRendererGate(
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
            assertJourneyRendererGate(gate, renderer.installed.epochMs);
            const ipc = await readJourneyMainIpcCapture(
                electronApp,
                JOURNEY_MAIN_IPC_STATE_KEY,
                10_000
            );
            if (ipc.installedEpochMs > renderer.installed.epochMs) {
                throw new Error('journey-main-ipc-capture-installed-late');
            }
            const electronVersion = await electronApp.evaluate(
                () => process.versions.electron
            );
            return {
                electronVersion,
                gate,
                ipc,
                pid: electronApp.process().pid ?? -1,
                renderer,
                spawnEpochMs,
            };
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
