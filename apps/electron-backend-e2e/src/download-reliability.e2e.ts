import { mkdirSync, readFileSync, statSync } from 'fs';
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

test.describe('Electron download reliability', () => {
    test('@downloads @electron retains a network-interrupted partial and retries it with HTTP Range', async ({
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
            mkdirSync(downloadsDir, { recursive: true });
            await app.electronApp.evaluate(({ dialog }, folder) => {
                dialog.showOpenDialog = async () =>
                    ({
                        canceled: false,
                        filePaths: [folder],
                    }) as Awaited<ReturnType<typeof dialog.showOpenDialog>>;
            }, downloadsDir);
            await app.mainWindow
                .getByRole('button', { name: 'Change Folder' })
                .click();

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
            const item = app.mainWindow.getByTestId(
                `download-queue-item-${downloadId}`
            );
            await expect(item.locator('.download-queue__status')).toContainText(
                'Failed',
                { timeout: 30000 }
            );
            await expect(item.locator('.download-queue__error')).toContainText(
                'DOWNLOAD_NETWORK_INTERRUPTED (ECONNRESET)'
            );

            const partialPath = join(downloadsDir, 'E2E Reset Movie.mp4.part');
            expect(statSync(partialPath).size).toBe(
                rangeServer.interruptedBytes
            );

            await item
                .getByRole('button', { name: 'Retry E2E Reset Movie' })
                .click();
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
});
