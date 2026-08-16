import { mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    createInterruptedNoValidatorServer,
    createInterruptedRangeServer,
    INTERRUPTED_RANGE_SERVER_ETAG,
    startDownload,
} from './downloads.e2e-support';

async function openDownloadsPage(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open downloads' }).click();
    await page.waitForURL(/\/workspace\/downloads(?:\?.*)?$/);
}

async function getPlaylistId(page: Page, title: string): Promise<string> {
    const playlists = await page.evaluate(
        async () => (await window.electron?.dbGetAppPlaylistMetas?.()) ?? []
    );
    const playlist = playlists.find((entry) => entry.title === title);
    expect(playlist, `playlist "${title}" should exist`).toBeDefined();
    return playlist?._id ?? '';
}

async function useDownloadsFolder(
    app: Awaited<ReturnType<typeof launchElectronApp>>,
    folder: string
): Promise<void> {
    mkdirSync(folder, { recursive: true });
    await app.electronApp.evaluate(({ dialog }, target) => {
        dialog.showOpenDialog = async () =>
            ({
                canceled: false,
                filePaths: [target],
            }) as Awaited<ReturnType<typeof dialog.showOpenDialog>>;
    }, folder);
    await app.mainWindow.getByRole('button', { name: 'Change Folder' }).click();
}

test.describe('Electron download reliability', () => {
    test('@downloads @electron reconnects a network-interrupted download and resumes it with Range and If-Range', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const rangeServer = await createInterruptedRangeServer();
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Reset Portal',
                username: 'user1',
                password: 'pass1',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openDownloadsPage(app.mainWindow);

            const downloadsDir = join(dataDir, 'e2e-reset-downloads');
            await useDownloadsFolder(app, downloadsDir);

            const playlistId = await getPlaylistId(
                app.mainWindow,
                'Reset Portal'
            );
            const downloadId = await startDownload(app.mainWindow, {
                playlistId,
                xtreamId: 9801,
                contentType: 'vod',
                title: 'E2E Reset Movie',
                url: rangeServer.url,
                downloadFolder: downloadsDir,
            });

            // The interruption never surfaces as a failure: the runtime
            // reconnects on its own and finishes the transfer.
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${downloadId}`
                )
            ).toBeVisible({ timeout: 30000 });

            const resumeRequest = rangeServer.requests.find(
                (entry) => entry.range
            );
            expect(resumeRequest?.range).toBe(
                `bytes=${rangeServer.interruptedBytes}-`
            );
            expect(resumeRequest?.ifRange).toBe(INTERRUPTED_RANGE_SERVER_ETAG);
            const finalFile = readFileSync(
                join(downloadsDir, 'E2E Reset Movie.mp4')
            );
            expect(finalFile.equals(rangeServer.payload)).toBe(true);
        } finally {
            await closeElectronApp(app);
            await rangeServer.close();
        }
    });

    test('@downloads @electron resumes a validator-less download by verifying the byte overlap', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const rangeServer = await createInterruptedNoValidatorServer();
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'No Validator Portal',
                username: 'user1',
                password: 'pass1',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openDownloadsPage(app.mainWindow);

            const downloadsDir = join(dataDir, 'e2e-no-validator-downloads');
            await useDownloadsFolder(app, downloadsDir);

            const playlistId = await getPlaylistId(
                app.mainWindow,
                'No Validator Portal'
            );
            const downloadId = await startDownload(app.mainWindow, {
                playlistId,
                xtreamId: 9802,
                contentType: 'vod',
                title: 'E2E No Validator Movie',
                url: rangeServer.url,
                downloadFolder: downloadsDir,
            });

            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${downloadId}`
                )
            ).toBeVisible({ timeout: 30000 });

            // Without a validator the resume rewinds by the 256 KiB overlap
            // window instead of trusting the partial blindly — and never
            // sends If-Range.
            const resumeRequest = rangeServer.requests.find(
                (entry) => entry.range
            );
            expect(resumeRequest?.range).toBe(
                `bytes=${rangeServer.interruptedBytes - 262_144}-`
            );
            expect(resumeRequest?.ifRange).toBeUndefined();
            const finalFile = readFileSync(
                join(downloadsDir, 'E2E No Validator Movie.mp4')
            );
            expect(finalFile.equals(rangeServer.payload)).toBe(true);
        } finally {
            await closeElectronApp(app);
            await rangeServer.close();
        }
    });
});
