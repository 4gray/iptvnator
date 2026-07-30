import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
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
    openSettings,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

async function openDownloadsPage(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open downloads' }).click();
    await page.waitForURL(/\/workspace\/downloads(?:\?.*)?$/);
}

async function navigateWithinWorkspace(
    page: Page,
    path: string
): Promise<void> {
    await page.evaluate((target) => {
        window.history.pushState(null, '', target);
        window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await page.waitForURL((url) => url.pathname === path);
}

async function getPlaylistId(page: Page, title: string): Promise<string> {
    const playlists = await page.evaluate(
        async () => (await window.electron?.dbGetAppPlaylistMetas?.()) ?? []
    );
    const playlist = playlists.find((entry) => entry.title === title);
    expect(playlist, `playlist "${title}" should exist`).toBeDefined();
    return playlist?._id ?? '';
}

async function getSeriesTarget(
    page: Page,
    playlistId: string
): Promise<{ categoryId: number; xtreamId: number }> {
    const target = await page.evaluate(
        async (sourceId) =>
            (await window.electron?.dbGetContent?.(sourceId, 'series'))?.[0] ??
            null,
        playlistId
    );
    expect(target, 'playlist should have an imported series target').not.toBe(
        null
    );
    if (!target) {
        throw new Error('Series target was not imported');
    }
    expect(target.xtream_id).toBeGreaterThan(0);
    expect(target.category_id).toBeGreaterThan(0);
    return {
        categoryId: target.category_id,
        xtreamId: target.xtream_id,
    };
}

async function getVodTarget(
    page: Page,
    playlistId: string
): Promise<{ categoryId: number; xtreamId: number }> {
    const target = await page.evaluate(
        async (sourceId) =>
            (await window.electron?.dbGetContent?.(sourceId, 'movie'))?.[0] ??
            null,
        playlistId
    );
    expect(target, 'playlist should have an imported VOD target').not.toBe(
        null
    );
    if (!target) {
        throw new Error('VOD target was not imported');
    }
    expect(target.xtream_id).toBeGreaterThan(0);
    expect(target.category_id).toBeGreaterThan(0);
    return {
        categoryId: target.category_id,
        xtreamId: target.xtream_id,
    };
}

async function selectDownloadCoverSize(
    page: Page,
    size: 'small' | 'medium' | 'large'
): Promise<void> {
    await openSettings(page);
    await page.getByTestId(`cover-size-${size}`).click();
    await expect
        .poll(() =>
            page.evaluate(
                () => document.documentElement.dataset.coverSize ?? null
            )
        )
        .toBe(size);
    await saveSettings(page);
    await openDownloadsPage(page);
}

async function measureLibraryCard(
    page: Page
): Promise<{ gap: number; width: number }> {
    return page
        .locator('article[data-test-id^="download-library-"]')
        .first()
        .evaluate((card) => {
            const grid = card.parentElement;
            if (!grid) {
                throw new Error('Download library card has no grid parent');
            }
            return {
                gap: Number.parseFloat(getComputedStyle(grid).columnGap),
                width: card.getBoundingClientRect().width,
            };
        });
}

interface DownloadSeed {
    contentType: 'episode' | 'vod';
    downloadFolder: string;
    episodeNumber?: number;
    playlistId: string;
    seasonNumber?: number;
    seriesXtreamId?: number;
    title: string;
    url: string;
    xtreamId: number;
}

async function startDownload(page: Page, seed: DownloadSeed): Promise<number> {
    const result = await page.evaluate(
        async (payload) => window.electron?.downloadsStart?.(payload),
        seed
    );
    expect(result?.error ?? null).toBeNull();
    expect(result?.id).toEqual(expect.any(Number));
    if (typeof result?.id !== 'number') {
        throw new Error(`Download did not return an id: ${seed.title}`);
    }
    return result.id;
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

interface TruncatedDownloadServer {
    close: () => Promise<void>;
    payload: Buffer;
    totalBytes: number;
    url: string;
}

const RANGE_SERVER_ETAG = '"e2e-range-etag"';

/**
 * Serves a payload slowly on the first (full) request so the UI has a wide
 * window to pause mid-transfer, and answers Range requests with an immediate
 * 206 so the resumed transfer finishes fast. Records Range/If-Range headers.
 */
async function createThrottledRangeServer(
    chunkIntervalMs = 150
): Promise<ThrottledRangeServer> {
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
        }, chunkIntervalMs);
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
 * Ends a chunked response cleanly while Content-Range advertises a larger
 * representation. The runtime therefore retains the valid .part for a Range
 * retry instead of treating it as an unusable transport failure.
 */
async function createTruncatedDownloadServer(): Promise<TruncatedDownloadServer> {
    const payload = Buffer.alloc(16 * 1024, 7);
    const totalBytes = payload.length * 4;
    const server = createServer((_req, res) => {
        res.writeHead(200, {
            'Content-Range': `bytes 0-${payload.length - 1}/${totalBytes}`,
            'Content-Type': 'video/mp4',
            ETag: '"e2e-truncated-etag"',
        });
        res.end(payload);
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        payload,
        totalBytes,
        url: `http://127.0.0.1:${port}/media/e2e-truncated-movie.mp4`,
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
                app.mainWindow.getByText('Add a playlist to start downloading')
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
                app.mainWindow.getByTestId('downloads-folder')
            ).toContainText('e2e-downloads');

            // Enqueue a download through the same renderer bridge the app uses.
            const playlistId = await getPlaylistId(
                app.mainWindow,
                'Download Portal'
            );
            const startResult = await app.mainWindow.evaluate(
                async ({ url, folder, sourceId }) =>
                    window.electron?.downloadsStart?.({
                        playlistId: sourceId,
                        xtreamId: 4242,
                        contentType: 'vod',
                        title: 'E2E Movie',
                        url,
                        downloadFolder: folder,
                    }),
                {
                    url: fileServer.resourceUrl,
                    folder: downloadsDir,
                    sourceId: playlistId,
                }
            );
            expect(startResult?.error ?? null).toBeNull();
            expect(startResult?.id).toEqual(expect.any(Number));

            const card = app.mainWindow.getByTestId(
                `download-library-movie-${startResult?.id}`
            );
            await expect(card).toBeVisible({ timeout: 20000 });
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Ready to watch',
                })
            ).toBeVisible();

            // The file landed in the authorized folder.
            const finalPath = join(downloadsDir, 'E2E Movie.mp4');
            expect(readdirSync(downloadsDir)).toEqual(['E2E Movie.mp4']);
            expect(readFileSync(finalPath, 'utf8')).toBe(
                'e2e download payload'
            );

            // Completed items expose play / reveal / remove actions.
            await expect(
                card.getByRole('button', { name: 'Play: E2E Movie' }).last()
            ).toBeVisible();
            await expect(
                card.getByRole('button', {
                    name: 'Show in Folder: E2E Movie',
                })
            ).toBeVisible();

            await card
                .getByRole('button', {
                    name: 'More actions: E2E Movie',
                })
                .click();
            await app.mainWindow
                .getByRole('menuitem', {
                    name: 'Remove from manager: E2E Movie',
                })
                .click();
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Remove from manager?',
                })
            ).toBeVisible();
            await app.mainWindow
                .getByRole('button', {
                    name: 'Remove from manager',
                    exact: true,
                })
                .click();
            await expect(
                app.mainWindow.getByText('No downloads yet')
            ).toBeVisible();
            expect(readFileSync(finalPath, 'utf8')).toBe(
                'e2e download payload'
            );
        } finally {
            await closeElectronApp(app);
            await fileServer.close();
        }
    });

    test('@downloads @electron keeps global and scoped libraries truthful while filters, search, grouping, and scrolling stay functional', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const fileServer = await createMutableTextServer('library payload', {
            contentType: 'video/mp4',
            resourcePath: '/media/library-item.mp4',
        });
        // Keep one real transfer alive while route scope changes prove that
        // the shell badge remains global.
        const activeServer = await createThrottledRangeServer(5000);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Library Source A',
                username: 'multisrc1',
                password: 'multisrc1',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await addXtreamPortal(app.mainWindow, {
                name: 'Library Source B',
                username: 'multisrc2',
                password: 'multisrc2',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            const sourceA = await getPlaylistId(
                app.mainWindow,
                'Library Source A'
            );
            const sourceB = await getPlaylistId(
                app.mainWindow,
                'Library Source B'
            );
            const { categoryId: seriesCategoryId, xtreamId: seriesXtreamId } =
                await getSeriesTarget(app.mainWindow, sourceA);
            const { categoryId: vodCategoryId, xtreamId: vodXtreamId } =
                await getVodTarget(app.mainWindow, sourceA);
            await navigateWithinWorkspace(
                app.mainWindow,
                `/workspace/xtreams/${sourceB}/downloads`
            );

            const downloadsDir = join(dataDir, 'e2e-library-downloads');
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
                app.mainWindow.getByTestId('downloads-folder')
            ).toContainText('e2e-library-downloads');

            const common = {
                downloadFolder: downloadsDir,
                url: fileServer.resourceUrl,
            };
            const alphaMovieId = await startDownload(app.mainWindow, {
                ...common,
                playlistId: sourceA,
                xtreamId: vodXtreamId,
                contentType: 'vod',
                title: 'Alpha Movie',
            });
            await startDownload(app.mainWindow, {
                ...common,
                playlistId: sourceA,
                xtreamId: 8201,
                contentType: 'episode',
                seriesXtreamId,
                seasonNumber: 1,
                episodeNumber: 1,
                title: 'Aurora - S01E01 - Arrival',
            });
            await startDownload(app.mainWindow, {
                ...common,
                playlistId: sourceA,
                xtreamId: 8202,
                contentType: 'episode',
                seriesXtreamId,
                seasonNumber: 1,
                episodeNumber: 2,
                title: 'Aurora - S01E02 - Signal',
            });
            for (let index = 0; index < 6; index += 1) {
                await startDownload(app.mainWindow, {
                    ...common,
                    playlistId: sourceA,
                    xtreamId: 8300 + index,
                    contentType: 'vod',
                    title: `Alpha Archive ${index + 1}`,
                });
            }
            const betaMovieId = await startDownload(app.mainWindow, {
                ...common,
                playlistId: sourceB,
                xtreamId: 9101,
                contentType: 'vod',
                title: 'Beta Movie',
            });
            for (let index = 0; index < 4; index += 1) {
                await startDownload(app.mainWindow, {
                    ...common,
                    playlistId: sourceB,
                    xtreamId: 9300 + index,
                    contentType: 'vod',
                    title: `Beta Archive ${index + 1}`,
                });
            }

            const cards = app.mainWindow.locator(
                'article[data-test-id^="download-library-"]'
            );
            await expect(cards).toHaveCount(5, { timeout: 30000 });
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${betaMovieId}`
                )
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${alphaMovieId}`
                )
            ).toHaveCount(0);

            const activeMovieId = await startDownload(app.mainWindow, {
                downloadFolder: downloadsDir,
                playlistId: sourceA,
                xtreamId: 8401,
                contentType: 'vod',
                title: 'Alpha Active Movie',
                url: activeServer.url,
            });
            const activeItem = app.mainWindow.getByTestId(
                `download-queue-item-${activeMovieId}`
            );
            const globalBadge = app.mainWindow.getByTestId(
                'global-download-count'
            );
            await expect(globalBadge).toHaveText('1', { timeout: 20000 });
            await expect(activeItem).toHaveCount(0);

            await navigateWithinWorkspace(
                app.mainWindow,
                `/workspace/xtreams/${sourceA}/downloads`
            );
            await expect(globalBadge).toHaveText('1');
            await expect(cards).toHaveCount(8);
            await expect(activeItem).toBeVisible();
            await expect(
                activeItem.locator('.download-queue__status')
            ).toContainText('Downloading', { timeout: 20000 });
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${alphaMovieId}`
                )
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${betaMovieId}`
                )
            ).toHaveCount(0);

            const alphaMovieCard = app.mainWindow.getByTestId(
                `download-library-movie-${alphaMovieId}`
            );
            await alphaMovieCard
                .locator('.download-library__artwork-button')
                .click();
            const expectedVodPath = `/workspace/xtreams/${sourceA}/vod/${vodCategoryId}/${vodXtreamId}`;
            await app.mainWindow.waitForURL((url) =>
                url.pathname.endsWith(expectedVodPath)
            );
            await expect(
                app.mainWindow.getByText('Offline', { exact: true })
            ).toBeVisible();
            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Play Local',
                    exact: true,
                })
            ).toBeVisible();
            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Play from this source',
                    exact: true,
                })
            ).toBeVisible();

            await openDownloadsPage(app.mainWindow);
            await expect(globalBadge).toHaveText('1');
            await expect(cards).toHaveCount(13);

            await selectDownloadCoverSize(app.mainWindow, 'small');
            await expect(cards).toHaveCount(13);
            const smallCover = await measureLibraryCard(app.mainWindow);
            await selectDownloadCoverSize(app.mainWindow, 'medium');
            await expect(cards).toHaveCount(13);
            const mediumCover = await measureLibraryCard(app.mainWindow);
            await selectDownloadCoverSize(app.mainWindow, 'large');
            await expect(cards).toHaveCount(13);
            const largeCover = await measureLibraryCard(app.mainWindow);

            expect(smallCover.gap).toBe(12);
            expect(mediumCover.gap).toBe(16);
            expect(largeCover.gap).toBe(20);
            expect(mediumCover.width).toBeGreaterThan(smallCover.width);
            expect(largeCover.width).toBeGreaterThan(mediumCover.width);

            const seriesCard = app.mainWindow.getByTestId(
                `download-library-series-${sourceA}-${seriesXtreamId}`
            );
            await expect(seriesCard).toContainText('2 episodes');
            await expect(seriesCard).toContainText('Library Source A');

            await app.mainWindow
                .getByTestId('downloads-filter-in-progress')
                .click();
            await expect(cards).toHaveCount(0);
            await expect(activeItem).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('downloads-filter-in-progress')
            ).toContainText('1');
            await app.mainWindow.getByTestId('downloads-filter-all').click();
            await expect(cards).toHaveCount(13);

            await seriesCard
                .getByRole('button', {
                    name: 'Open details: Aurora',
                    exact: true,
                })
                .click();
            const expectedSeriesPath = `/workspace/xtreams/${sourceA}/series/${seriesCategoryId}/${seriesXtreamId}`;
            await app.mainWindow.waitForURL((url) =>
                url.pathname.endsWith(expectedSeriesPath)
            );
            await openDownloadsPage(app.mainWindow);
            await expect(seriesCard).toBeVisible();

            const episodeButton = seriesCard.getByRole('button', {
                name: 'Open downloaded episodes: Aurora',
            });
            await episodeButton.focus();
            await episodeButton.press('Enter');
            await expect(
                app.mainWindow.getByRole('heading', { name: 'Aurora' })
            ).toBeVisible();
            await expect(
                app.mainWindow.locator(
                    '[data-test-id^="downloaded-series-episode-"]'
                )
            ).toHaveCount(2);
            const closeDialog = app.mainWindow.getByTestId(
                'downloaded-series-close'
            );
            await expect(closeDialog).toHaveAccessibleName('Close');
            await closeDialog.click();

            await activeItem
                .getByRole('button', { name: 'Pause Alpha Active Movie' })
                .click();
            await expect(
                activeItem.locator('.download-queue__status')
            ).toContainText('Paused', { timeout: 20000 });
            await expect(globalBadge).toHaveCount(0);

            await app.mainWindow.getByTestId('downloads-filter-series').click();
            await expect(cards).toHaveCount(1);
            await expect(seriesCard).toBeVisible();
            await app.mainWindow.getByTestId('downloads-filter-movie').click();
            await expect(cards).toHaveCount(12);
            await expect(seriesCard).toHaveCount(0);
            await app.mainWindow.getByTestId('downloads-filter-all').click();

            const search = app.mainWindow.getByRole('searchbox', {
                name: 'Search',
            });
            await search.fill('Beta Movie');
            await expect
                .poll(
                    () => new URL(app.mainWindow.url()).searchParams.get('q'),
                    { timeout: 10000 }
                )
                .toBe('Beta Movie');
            await expect(cards).toHaveCount(1);
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${betaMovieId}`
                )
            ).toBeVisible();
            await search.fill('');
            await expect
                .poll(
                    () => new URL(app.mainWindow.url()).searchParams.get('q'),
                    { timeout: 10000 }
                )
                .toBeNull();
            await expect(cards).toHaveCount(13);

            const header = app.mainWindow.getByTestId('downloads-header');
            const filters = app.mainWindow.getByTestId('downloads-filters');
            const content = app.mainWindow.getByTestId('downloads-content');
            const headerBefore = await header.boundingBox();
            const filtersBefore = await filters.boundingBox();
            const scroll = await content.evaluate((element) => {
                const outer =
                    element.closest<HTMLElement>('.workspace-content');
                element.scrollTop = element.scrollHeight;
                return {
                    clientHeight: element.clientHeight,
                    outerScrollTop: outer?.scrollTop ?? -1,
                    scrollHeight: element.scrollHeight,
                    scrollTop: element.scrollTop,
                };
            });
            const headerAfter = await header.boundingBox();
            const filtersAfter = await filters.boundingBox();

            expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
            expect(scroll.scrollTop).toBeGreaterThan(0);
            expect(scroll.outerScrollTop).toBe(0);
            expect(headerAfter?.y).toBe(headerBefore?.y);
            expect(filtersAfter?.y).toBe(filtersBefore?.y);
        } finally {
            await closeElectronApp(app);
            await activeServer.close();
            await fileServer.close();
        }
    });

    test('@downloads @electron deletes retained failed partials when removing one item or clearing finished downloads', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const truncatedServer = await createTruncatedDownloadServer();
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Partial Cleanup Portal',
                username: 'user1',
                password: 'pass1',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openDownloadsPage(app.mainWindow);

            const downloadsDir = join(dataDir, 'e2e-partial-cleanup');
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
                app.mainWindow.getByTestId('downloads-folder')
            ).toContainText('e2e-partial-cleanup');

            const playlistId = await getPlaylistId(
                app.mainWindow,
                'Partial Cleanup Portal'
            );
            const removeId = await startDownload(app.mainWindow, {
                playlistId,
                xtreamId: 9501,
                contentType: 'vod',
                title: 'Remove Retained Partial',
                url: truncatedServer.url,
                downloadFolder: downloadsDir,
            });
            const clearId = await startDownload(app.mainWindow, {
                playlistId,
                xtreamId: 9502,
                contentType: 'vod',
                title: 'Clear Retained Partial',
                url: truncatedServer.url,
                downloadFolder: downloadsDir,
            });

            for (const id of [removeId, clearId]) {
                await expect
                    .poll(
                        () =>
                            app.mainWindow.evaluate(
                                async (downloadId) =>
                                    (
                                        await window.electron?.downloadsGet?.(
                                            downloadId
                                        )
                                    )?.status ?? null,
                                id
                            ),
                        { timeout: 30000 }
                    )
                    .toBe('failed');
            }

            const failedRows = await app.mainWindow.evaluate(
                async (ids) =>
                    Promise.all(
                        ids.map((id) => window.electron?.downloadsGet?.(id))
                    ),
                [removeId, clearId]
            );
            const partialPaths = failedRows.map((row) => {
                expect(row?.filePath).toEqual(expect.any(String));
                expect(row?.bytesDownloaded).toBe(
                    truncatedServer.payload.length
                );
                expect(row?.totalBytes).toBe(truncatedServer.totalBytes);
                return `${row?.filePath}.part`;
            });
            for (const partialPath of partialPaths) {
                expect(existsSync(partialPath)).toBe(true);
                expect(statSync(partialPath).size).toBe(
                    truncatedServer.payload.length
                );
            }

            const removeItem = app.mainWindow.getByTestId(
                `download-queue-item-${removeId}`
            );
            await expect(removeItem).toBeVisible();
            await removeItem
                .getByRole('button', {
                    name: 'Remove Remove Retained Partial from manager',
                })
                .click();
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Remove partial download?',
                })
            ).toBeVisible();
            await app.mainWindow
                .getByRole('button', {
                    name: 'Remove from manager',
                    exact: true,
                })
                .click();
            await expect(removeItem).toHaveCount(0);
            await expect
                .poll(() =>
                    app.mainWindow.evaluate(
                        async (id) =>
                            (await window.electron?.downloadsGet?.(id)) ?? null,
                        removeId
                    )
                )
                .toBeNull();
            expect(existsSync(partialPaths[0])).toBe(false);
            expect(existsSync(partialPaths[1])).toBe(true);

            await app.mainWindow
                .getByTestId('downloads-clear-finished')
                .click();
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Clear finished downloads?',
                })
            ).toBeVisible();
            await app.mainWindow
                .getByRole('dialog', {
                    name: 'Clear finished downloads?',
                })
                .getByRole('button', {
                    name: 'Clear finished',
                    exact: true,
                })
                .click();
            await expect(
                app.mainWindow.getByTestId(`download-queue-item-${clearId}`)
            ).toHaveCount(0);
            await expect
                .poll(() =>
                    app.mainWindow.evaluate(
                        async (id) =>
                            (await window.electron?.downloadsGet?.(id)) ?? null,
                        clearId
                    )
                )
                .toBeNull();
            expect(existsSync(partialPaths[1])).toBe(false);
            await expect(
                app.mainWindow.getByText('No downloads yet')
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
            await truncatedServer.close();
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
                app.mainWindow.getByTestId('downloads-folder')
            ).toContainText('e2e-pause-downloads');

            const playlistId = await getPlaylistId(
                app.mainWindow,
                'Pause Portal'
            );
            const startResult = await app.mainWindow.evaluate(
                async ({ url, folder, sourceId }) =>
                    window.electron?.downloadsStart?.({
                        playlistId: sourceId,
                        xtreamId: 7373,
                        contentType: 'vod',
                        title: 'E2E Pause Movie',
                        url,
                        downloadFolder: folder,
                    }),
                {
                    url: rangeServer.url,
                    folder: downloadsDir,
                    sourceId: playlistId,
                }
            );
            expect(startResult?.error ?? null).toBeNull();
            expect(startResult?.id).toEqual(expect.any(Number));

            const item = app.mainWindow.getByTestId(
                `download-queue-item-${startResult?.id}`
            );
            await expect(item).toBeVisible({ timeout: 20000 });
            await expect(item.locator('.download-queue__status')).toContainText(
                'Downloading',
                { timeout: 20000 }
            );

            // Pause mid-transfer: the row flips to Paused and only a .part
            // file exists on disk (final file absent, progress retained).
            await item
                .getByRole('button', { name: 'Pause E2E Pause Movie' })
                .click();
            await expect(item.locator('.download-queue__status')).toContainText(
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
                .getByRole('button', { name: 'Resume E2E Pause Movie' })
                .click();
            await expect(
                app.mainWindow.getByTestId(
                    `download-library-movie-${startResult?.id}`
                )
            ).toBeVisible({ timeout: 30000 });
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Ready to watch',
                })
            ).toBeVisible();

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
