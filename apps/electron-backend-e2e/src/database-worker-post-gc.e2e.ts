import type { ElectronApplication, Page } from '@playwright/test';

import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    installMainCapture,
    rolloverMainCapture,
    startMainCapture,
    stopMainCapture,
} from './performance/m3u-refresh-main-capture';
import type { MainCaptureMetrics } from './performance/m3u-refresh-cancellation-contract';
import type { RendererWindowIdentity } from './performance/renderer-window-rss-session';

test('captures the exact database worker post-GC heap in built Electron', async ({
    dataDir,
}) => {
    const launchedApps: LaunchedElectronApp[] = [];

    try {
        const app = await launchElectronApp(dataDir, {
            args: ['--js-flags=--expose-gc'],
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: '0',
                IPTVNATOR_PERF_CAPTURE: '1',
                IPTVNATOR_PERF_WORKER_PROFILING: '1',
            },
        });
        launchedApps.push(app);
        await installMainCapture(app.electronApp);
        const rendererWindowIdentity = await resolveRendererWindowIdentity(
            app.electronApp,
            app.mainWindow
        );
        const captureOptions = {
            diagnostic: false,
            outputDirectory: dataDir,
            rendererWindowIdentity,
        } as const;

        await startMainCapture(app.electronApp, captureOptions);
        await requestDatabaseWorker(app);
        const rollover = await rolloverMainCapture(
            app.electronApp,
            captureOptions
        );
        expect(rollover.nextCaptureStarted).toBe(true);
        expect(rollover.nextCaptureUnavailableReason).toBeNull();
        const firstDatabaseWorker = expectExactDatabaseWorker(
            rollover.completedCapture
        );

        await requestDatabaseWorker(app);
        const secondDatabaseWorker = expectExactDatabaseWorker(
            await stopMainCapture(app.electronApp)
        );
        expect(secondDatabaseWorker.ordinal).toBe(firstDatabaseWorker.ordinal);

        await startMainCapture(app.electronApp, captureOptions);
        const noDatabasePhase = await stopMainCapture(app.electronApp);
        expect(
            noDatabasePhase.workers.filter(
                (worker) => worker.kind === 'database.worker'
            )
        ).toHaveLength(0);
    } finally {
        await Promise.all(launchedApps.map((app) => closeElectronApp(app)));
    }
});

async function requestDatabaseWorker(app: LaunchedElectronApp): Promise<void> {
    await app.mainWindow.evaluate(() => window.electron.dbGetAppPlaylists());
}

function expectExactDatabaseWorker(capture: MainCaptureMetrics) {
    const databaseWorkers = capture.workers.filter(
        (worker) => worker.kind === 'database.worker'
    );

    expect(databaseWorkers).toHaveLength(1);
    const databaseWorker = databaseWorkers[0];
    expect(databaseWorker?.ordinal).toBeGreaterThan(0);
    expect(databaseWorker?.postGcHeapUnavailableReason).toBeNull();
    expect(databaseWorker?.postGcHeapUsedBytes).toBeGreaterThan(0);
    expect(databaseWorker?.requests).toHaveLength(1);
    expect(databaseWorker?.requests[0]).toEqual(
        expect.objectContaining({
            invalidReason: null,
            operation: 'DB_GET_APP_PLAYLISTS',
            performanceCaptureUnavailableReason: null,
            playlistId: null,
            requestId: expect.any(String),
            success: true,
        })
    );
    return databaseWorker;
}

async function resolveRendererWindowIdentity(
    electronApp: ElectronApplication,
    page: Page
): Promise<RendererWindowIdentity> {
    const browserWindowHandle = await electronApp.browserWindow(page);
    try {
        return await browserWindowHandle.evaluate((browserWindow) => {
            const exactWindow = browserWindow as unknown as {
                readonly id: number;
                readonly webContents: { readonly id: number };
            };
            return {
                browserWindowId: exactWindow.id,
                webContentsId: exactWindow.webContents.id,
            };
        });
    } finally {
        await browserWindowHandle.dispose();
    }
}
