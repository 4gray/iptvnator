import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    channelItemByTitle,
    contentCardByTitle,
    expect,
    launchElectronApp,
    openGlobalFavorites,
    openGlobalRecent,
    openSourceEditor,
    openSources,
    refreshSource,
    restartElectronApp,
    saveSourceDialog,
    switchUnifiedCollectionScope,
    switchUnifiedCollectionContent,
    test,
} from './electron-test-fixtures';
import { createLocalMediaServer } from './embedded-mpv-frame-copy-packaged-fixtures';
import { startDownload } from './downloads.e2e-support';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';
import {
    catalogActions,
    persistedHistoryCount,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

const sourceName = 'Preserved Xtream';
const clip = readFileSync(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
);

test('disabled catalogs preserve playable saved items, resume progress, downloaded files and history beyond 100 rows', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    const media = await createLocalMediaServer({
        body: clip,
        resourcePath: '/movie.webm',
        contentType: 'video/webm',
    });
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    try {
        await addXtreamPortal(page, {
            name: sourceName,
            serverUrl: recorder.url,
            contentTypes: ['movie'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (name) => {
                    const playlist = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === name);
                    return playlist
                        ? window.electron.dbGetAppState(
                              `xtream-import-status:${playlist._id}:movie`
                          )
                        : null;
                }, sourceName)
            )
            .toBe('completed');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();

        const saved = await page.evaluate(async (name) => {
            const playlist = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === name
            );
            if (!playlist) throw new Error('Missing isolated source');
            const movies = (
                await window.electron.dbGetContent(playlist._id, 'movie')
            ).slice(0, 105);
            if (movies.length !== 105)
                throw new Error('Fixture needs more than 100 movies');
            for (const movie of movies)
                await window.electron.dbAddRecentItem(movie.id, playlist._id);
            const movie = movies[104];
            await window.electron.dbAddFavorite(movie.id, playlist._id);
            await window.electron.dbSavePlaybackPosition(playlist._id, {
                contentXtreamId: movie.xtream_id,
                contentType: 'vod',
                positionSeconds: 9,
                durationSeconds: 30,
            });
            return {
                playlistId: playlist._id,
                xtreamId: movie.xtream_id,
                title: movie.title,
                downloadXtreamId: movies[0].xtream_id,
            };
        }, sourceName);
        expect(
            await persistedHistoryCount(app, dataDir, saved.playlistId)
        ).toBe(105);
        expect(
            await page.evaluate(
                (id) =>
                    window.electron
                        .dbGetRecentItems(id)
                        .then((rows) => rows.length),
                saved.playlistId
            )
        ).toBe(100);

        const folder = join(dataDir, 'preserved-downloads');
        mkdirSync(folder, { recursive: true });
        await app.electronApp.evaluate(({ dialog }, folder) => {
            dialog.showOpenDialog = async () =>
                ({ canceled: false, filePaths: [folder] }) as Awaited<
                    ReturnType<typeof dialog.showOpenDialog>
                >;
        }, folder);
        await page.evaluate(() => window.electron.downloadsSelectFolder());
        const downloadId = await startDownload(page, {
            playlistId: saved.playlistId,
            xtreamId: saved.downloadXtreamId,
            contentType: 'vod',
            title: 'Preserved offline movie',
            url: media.url,
            downloadFolder: folder,
        });
        await expect
            .poll(() =>
                page.evaluate(
                    async (id) =>
                        (await window.electron.downloadsGetList()).find(
                            (row) => row.id === id
                        )?.status,
                    downloadId
                )
            )
            .toBe('completed');
        const download = await page.evaluate(
            async (id) =>
                (await window.electron.downloadsGetList()).find(
                    (row) => row.id === id
                ),
            downloadId
        );
        const filePath = download?.filePath;
        if (!filePath) throw new Error('Download has no finalized path');
        expect(readFileSync(filePath)).toEqual(clip);

        await openSources(page);
        let dialog = await openSourceEditor(page, sourceName);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        recorder.actions.length = 0;
        await saveSourceDialog(page, dialog);
        await refreshSource(page, sourceName, { confirm: true });
        await page.waitForURL(/\/workspace\/xtreams\//);
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        expect(
            await persistedHistoryCount(app, dataDir, saved.playlistId)
        ).toBe(105);
        expect(catalogActions(recorder.actions)).toEqual([]);

        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await routePlayableStreams(page, [recorder.url]);
        expect(
            await persistedHistoryCount(app, dataDir, saved.playlistId)
        ).toBe(105);
        const position = await page.evaluate(
            ({ playlistId, xtreamId }) =>
                window.electron.dbGetPlaybackPosition(
                    playlistId,
                    xtreamId,
                    'vod'
                ),
            saved
        );
        expect(position).toEqual(
            expect.objectContaining({ positionSeconds: 9, durationSeconds: 30 })
        );
        expect(readFileSync(filePath)).toEqual(clip);

        // A disabled badge is informational: both collections must still start real media.
        for (const origin of ['favorites', 'history']) {
            if (origin === 'favorites') await openGlobalFavorites(page);
            else await openGlobalRecent(page);
            await switchUnifiedCollectionScope(page, 'All playlists');
            const card = contentCardByTitle(page, saved.title).first();
            await expect(card).toContainText('Disabled');
            await card.click();
            await expect(page.locator('app-content-hero')).toContainText(
                saved.title
            );
            await startAndConfirmPlayback(
                page,
                () =>
                    page
                        .getByRole('button', { name: /^Continue/ })
                        .first()
                        .click(),
                origin === 'favorites' ? 2.5 : 0.75
            );
            expect(
                await page
                    .locator('app-portal-inline-player video')
                    .first()
                    .evaluate((video: HTMLVideoElement) => video.currentTime)
            ).toBeGreaterThanOrEqual(9);
            await page
                .getByRole('button', { name: 'Close player', exact: true })
                .click();
            await page.getByTestId('workspace-header-back').click();
        }

        // Keep the real DOWNLOADS_PLAY_FILE validation; stub only the final OS opener.
        await app.electronApp.evaluate(({ shell }) => {
            const state = globalThis as typeof globalThis & {
                selectiveOpenedFiles?: string[];
            };
            state.selectiveOpenedFiles = [];
            shell.openPath = async (path: string) => {
                state.selectiveOpenedFiles?.push(path);
                return '';
            };
        });
        await page
            .getByRole('button', { name: 'Open downloads', exact: true })
            .click();
        const downloadedCard = page.getByTestId(
            `download-library-movie-${downloadId}`
        );
        await downloadedCard
            .getByRole('button', {
                name: 'Open details: Preserved offline movie',
                exact: true,
            })
            .click();
        await page
            .getByRole('button', { name: 'Play offline', exact: true })
            .click();
        await expect
            .poll(() =>
                app.electronApp.evaluate(
                    () =>
                        (
                            globalThis as typeof globalThis & {
                                selectiveOpenedFiles?: string[];
                            }
                        ).selectiveOpenedFiles
                )
            )
            .toEqual([filePath]);
        expect(catalogActions(recorder.actions)).toEqual([]);
        const resumed = await page.evaluate(
            ({ playlistId, xtreamId }) =>
                window.electron.dbGetPlaybackPosition(
                    playlistId,
                    xtreamId,
                    'vod'
                ),
            saved
        );
        expect(resumed?.positionSeconds).toBeGreaterThanOrEqual(9);

        // Re-enabling replaces this catalog. Its recovery snapshot must include all 105 rows.
        await openSources(page);
        dialog = await openSourceEditor(page, sourceName);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        recorder.actions.length = 0;
        await saveSourceDialog(page, dialog);
        await expect(page).toHaveURL(/\/vod(?:\?.*)?$/);
        expect(catalogActions(recorder.actions)).toEqual([
            'get_vod_categories',
            'get_vod_streams',
        ]);
        expect(
            await persistedHistoryCount(app, dataDir, saved.playlistId)
        ).toBe(105);
        expect(
            await page.evaluate(
                ({ playlistId, xtreamId }) =>
                    window.electron.dbGetPlaybackPosition(
                        playlistId,
                        xtreamId,
                        'vod'
                    ),
                saved
            )
        ).toEqual(resumed);
        expect(
            await page.evaluate(
                async ({ playlistId, xtreamId }) =>
                    (await window.electron.dbGetFavorites(playlistId)).some(
                        (row) => row.xtream_id === xtreamId
                    ),
                saved
            )
        ).toBe(true);
        expect(
            await page.evaluate(
                async (id) =>
                    (await window.electron.downloadsGetList()).find(
                        (row) => row.id === id
                    ),
                downloadId
            )
        ).toEqual(
            expect.objectContaining({
                filePath,
                status: 'completed',
                fileAvailability: 'available',
            })
        );
        expect(readFileSync(filePath)).toEqual(clip);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
        await media.close();
    }
});

test('disabled Live TV and Series favorites and history remain playable without catalog requests', async ({
    dataDir,
}) => {
    test.setTimeout(90000);
    const recorder = await recordCatalogRequests();
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await addXtreamPortal(page, {
            name: sourceName,
            serverUrl: recorder.url,
            contentTypes: ['live', 'series'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (name) => {
                    const playlist = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === name);
                    return playlist
                        ? window.electron.dbGetAppState(
                              `xtream-import-status:${playlist._id}:series`
                          )
                        : null;
                }, sourceName)
            )
            .toBe('completed');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        const saved = await page.evaluate(async (name) => {
            const playlist = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === name
            );
            if (!playlist) throw new Error('Missing isolated source');
            const live = (
                await window.electron.dbGetContent(playlist._id, 'live')
            )[0];
            const series = (
                await window.electron.dbGetContent(playlist._id, 'series')
            )[0];
            if (!live || !series) throw new Error('Missing fixture content');
            for (const item of [live, series]) {
                await window.electron.dbAddFavorite(item.id, playlist._id);
                await window.electron.dbAddRecentItem(item.id, playlist._id);
            }
            return { live: live.title, series: series.title };
        }, sourceName);
        await openSources(page);
        const dialog = await openSourceEditor(page, sourceName);
        for (const type of ['live', 'series'])
            await dialog
                .getByTestId(`xtream-load-${type}`)
                .getByRole('checkbox')
                .uncheck();
        recorder.actions.length = 0;
        await saveSourceDialog(page, dialog);
        await routePlayableStreams(page, [recorder.url]);
        for (const origin of ['favorites', 'history']) {
            if (origin === 'favorites') await openGlobalFavorites(page);
            else await openGlobalRecent(page);
            await switchUnifiedCollectionScope(page, 'All playlists');
            await switchUnifiedCollectionContent(page, 'Live TV');
            const live = channelItemByTitle(page, saved.live).first();
            await expect(live).toContainText('Disabled');
            await startAndConfirmPlayback(page, () => live.dblclick());
            // Switching media type tears down the full-page Live TV player.
            await switchUnifiedCollectionContent(page, 'Series');
            const series = contentCardByTitle(page, saved.series).first();
            await expect(series).toContainText('Disabled');
            await series.click();
            await expect(page.locator('app-content-hero')).toContainText(
                saved.series
            );
            await startAndConfirmPlayback(page, async () => {
                await expect(
                    page
                        .locator(
                            '.season-card, .episode-card, .episode-list-item'
                        )
                        .first()
                ).toBeVisible();
                const season = page.locator('.season-card').first();
                if (await season.count()) await season.click();
                const episode = page
                    .locator('.episode-card, .episode-list-item')
                    .first();
                await episode.scrollIntoViewIfNeeded();
                await episode.click();
            });
            await page
                .getByRole('button', { name: 'Close player', exact: true })
                .click();
            await page.getByTestId('workspace-header-back').click();
        }
        expect(catalogActions(recorder.actions)).toEqual([]);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
