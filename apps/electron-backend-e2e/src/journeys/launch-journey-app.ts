import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron } from '@playwright/test';

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
 * Spawns a fresh Electron process on a copy of the seeded profile, installs
 * the renderer probe before the window exists and the main-process IPC
 * capture before the renderer runs any script, then waits for the journey's
 * terminal condition.
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
        const args = buildElectronLaunchArgs();
        const spawnEpochMs = Date.now();
        const electronApp = await electron.launch({ args, env });
        captureElectronProcess(electronApp);
        try {
            const probeOptions = createLaunchJourneyProbeOptions();
            await installJourneyRendererProbe(
                electronApp.context(),
                probeOptions
            );
            await installJourneyMainIpcCapture(electronApp, {
                channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
                sentinelId: probeOptions.sentinelId,
                sentinelMethod: probeOptions.sentinelMethod,
                stateKey: JOURNEY_MAIN_IPC_STATE_KEY,
            });
            const mainWindow = await electronApp.firstWindow();
            const renderer = await waitForJourneyRendererProbe(
                mainWindow,
                probeOptions.stateKey,
                timeoutMs
            );
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
