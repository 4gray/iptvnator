import { mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    createMutableTextServer,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

async function openDownloadsPage(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open downloads' }).click();
    await page.waitForURL(/\/workspace\/downloads(?:\?.*)?$/);
}

/**
 * On a cold profile the renderer can query SQLite while the DB worker is
 * still creating tables ("database is locked" / "no such table" on slow CI
 * runners), which leaves the downloads page on its skeleton forever. Wait
 * until a playlist read succeeds before navigating.
 */
async function waitForDatabaseReady(page: Page): Promise<void> {
    await expect
        .poll(
            () =>
                page.evaluate(async () => {
                    const electron = window.electron;
                    if (!electron) {
                        return false;
                    }
                    try {
                        await (electron.dbGetAppPlaylistMetas?.() ??
                            electron.dbGetAppPlaylists?.());
                        return true;
                    } catch {
                        return false;
                    }
                }),
            { timeout: 30000 }
        )
        .toBe(true);
}

test.describe('Electron Downloads', () => {
    test('@downloads @electron shows the add-a-playlist empty state when no sources exist', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await waitForDatabaseReady(app.mainWindow);
            await openDownloadsPage(app.mainWindow);

            await expect(
                app.mainWindow.locator('.downloads__header h1')
            ).toHaveText('Downloads');
            // First launch runs the IndexedDB→SQLite playlist migration before
            // the playlists query resolves, so allow extra time here.
            await expect(
                app.mainWindow.getByText(
                    'Add a playlist to start downloading'
                )
            ).toBeVisible({ timeout: 20000 });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@downloads @electron completes a download end-to-end and manages it from the downloads page', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const fileServer = await createMutableTextServer(
            'e2e download payload',
            {
                contentType: 'video/mp4',
                resourcePath: '/media/e2e-movie.mp4',
            }
        );
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Download Portal',
                username: 'user1',
                password: 'pass1',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openDownloadsPage(app.mainWindow);
            await expect(
                app.mainWindow.getByText('No downloads yet')
            ).toBeVisible();

            // Authorize a folder inside the isolated data dir by stubbing the
            // native folder dialog in the main process, then picking it via UI.
            const downloadsDir = join(dataDir, 'e2e-downloads');
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
            await expect(
                app.mainWindow.locator('.downloads__folder-inline-path')
            ).toContainText('e2e-downloads');

            // Enqueue a download through the same renderer bridge the app uses.
            const startResult = await app.mainWindow.evaluate(
                async ({ url, folder }) =>
                    window.electron?.downloadsStart?.({
                        playlistId: 'e2e-playlist',
                        xtreamId: 4242,
                        contentType: 'vod',
                        title: 'E2E Movie',
                        url,
                        downloadFolder: folder,
                    }),
                { url: fileServer.resourceUrl, folder: downloadsDir }
            );
            expect(startResult?.error ?? null).toBeNull();

            const item = app.mainWindow.locator('.downloads__item');
            await expect(item).toHaveCount(1, { timeout: 20000 });
            await expect(
                item.locator('.downloads__item-title-text')
            ).toHaveText('E2E Movie');
            await expect(item.locator('.downloads__item-status')).toContainText(
                'Completed',
                { timeout: 20000 }
            );

            // The file landed in the authorized folder.
            expect(readdirSync(downloadsDir).length).toBeGreaterThan(0);

            // Completed items expose play / reveal / remove actions.
            await expect(
                item.getByRole('button').filter({ hasText: 'play_arrow' })
            ).toBeVisible();
            await expect(
                item.getByRole('button').filter({ hasText: 'folder_open' })
            ).toBeVisible();

            await item
                .getByRole('button')
                .filter({ hasText: 'delete' })
                .click();
            await expect(
                app.mainWindow.getByText('No downloads yet')
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
            await fileServer.close();
        }
    });
});
