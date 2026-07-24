import { mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
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

interface RangeServerRequest {
    ifRange?: string;
    range?: string;
}

interface ThrottledRangeServer {
    close: () => Promise<void>;
    payload: Buffer;
    requests: RangeServerRequest[];
    url: string;
}

const RANGE_SERVER_ETAG = '"e2e-range-etag"';

/**
 * Serves a payload slowly on the first (full) request so the UI has a wide
 * window to pause mid-transfer, and answers Range requests with an immediate
 * 206 so the resumed transfer finishes fast. Records Range/If-Range headers.
 */
async function createThrottledRangeServer(): Promise<ThrottledRangeServer> {
    const payload = Buffer.from(
        Array.from({ length: 96 * 1024 }, (_, index) =>
            String(index % 10)
        ).join('')
    );
    const requests: RangeServerRequest[] = [];

    const server = createServer((req, res) => {
        const range = req.headers.range;
        const ifRange = req.headers['if-range'];
        requests.push({
            ifRange: typeof ifRange === 'string' ? ifRange : undefined,
            range: typeof range === 'string' ? range : undefined,
        });

        const offset = range
            ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? Number.NaN)
            : 0;
        if (range && Number.isFinite(offset)) {
            res.writeHead(206, {
                'Content-Length': payload.length - offset,
                'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}`,
                'Content-Type': 'video/mp4',
                ETag: RANGE_SERVER_ETAG,
            });
            res.end(payload.subarray(offset));
            return;
        }

        res.writeHead(200, {
            'Content-Length': payload.length,
            'Content-Type': 'video/mp4',
            ETag: RANGE_SERVER_ETAG,
        });
        // First 16 KiB immediately, then a trickle: the transfer stays alive
        // for tens of seconds unless it is paused or resumed via Range.
        let sent = 16 * 1024;
        res.write(payload.subarray(0, sent));
        const timer = setInterval(() => {
            if (sent >= payload.length) {
                clearInterval(timer);
                res.end();
                return;
            }
            res.write(payload.subarray(sent, sent + 2 * 1024));
            sent += 2 * 1024;
        }, 150);
        res.on('close', () => clearInterval(timer));
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        payload,
        requests,
        url: `http://127.0.0.1:${port}/media/e2e-pause-movie.mp4`,
    };
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

    test('@downloads @electron pauses a download, retains the partial, and resumes it with an HTTP Range request', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const rangeServer = await createThrottledRangeServer();
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Pause Portal',
                username: 'user1',
                password: 'pass1',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openDownloadsPage(app.mainWindow);

            const downloadsDir = join(dataDir, 'e2e-pause-downloads');
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
            ).toContainText('e2e-pause-downloads');

            const startResult = await app.mainWindow.evaluate(
                async ({ url, folder }) =>
                    window.electron?.downloadsStart?.({
                        playlistId: 'e2e-playlist',
                        xtreamId: 7373,
                        contentType: 'vod',
                        title: 'E2E Pause Movie',
                        url,
                        downloadFolder: folder,
                    }),
                { url: rangeServer.url, folder: downloadsDir }
            );
            expect(startResult?.error ?? null).toBeNull();

            const item = app.mainWindow.locator('.downloads__item');
            await expect(item).toHaveCount(1, { timeout: 20000 });
            await expect(item.locator('.downloads__item-status')).toContainText(
                'Downloading',
                { timeout: 20000 }
            );

            // Pause mid-transfer: the row flips to Paused and only a .part
            // file exists on disk (final file absent, progress retained).
            await item
                .getByRole('button')
                .filter({ hasText: 'pause' })
                .click();
            await expect(item.locator('.downloads__item-status')).toContainText(
                'Paused',
                { timeout: 20000 }
            );
            const pausedFiles = readdirSync(downloadsDir);
            expect(pausedFiles).toEqual(['E2E Pause Movie.mp4.part']);
            const pausedBytes = statSync(
                join(downloadsDir, 'E2E Pause Movie.mp4.part')
            ).size;
            expect(pausedBytes).toBeGreaterThan(0);
            expect(pausedBytes).toBeLessThan(rangeServer.payload.length);

            // Resume: the runtime must continue via Range/If-Range instead of
            // restarting, and the assembled file must match the payload.
            await item
                .getByRole('button')
                .filter({ hasText: 'play_arrow' })
                .click();
            await expect(item.locator('.downloads__item-status')).toContainText(
                'Completed',
                { timeout: 30000 }
            );

            const resumeRequest = rangeServer.requests.find(
                (entry) => entry.range
            );
            expect(resumeRequest?.range).toMatch(/^bytes=\d+-$/);
            expect(resumeRequest?.ifRange).toBe(RANGE_SERVER_ETAG);

            expect(readdirSync(downloadsDir)).toEqual(['E2E Pause Movie.mp4']);
            const finalFile = readFileSync(
                join(downloadsDir, 'E2E Pause Movie.mp4')
            );
            expect(finalFile.equals(rangeServer.payload)).toBe(true);
        } finally {
            await closeElectronApp(app);
            await rangeServer.close();
        }
    });
});
