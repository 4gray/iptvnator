import {
    addStalkerPortal,
    fillWorkspaceSearch,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    setSwitch,
    test,
    stalkerMockServer,
    restartElectronApp,
    openGlobalFavorites,
    switchUnifiedCollectionScope,
} from './electron-test-fixtures';
import type { Page } from '@playwright/test';
import { applyTheme } from './theme-contrast';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

for (const tmdb of [false, true]) {
    test(`@stalker @electron flat season range preserves episodes and history (TMDB ${tmdb})`, async ({
        dataDir,
    }, testInfo) => {
        const app = await launchElectronApp(dataDir);
        const seasonRequests: string[] = [];
        const details = {
            id: 777,
            name: 'Signal House',
            original_name: 'Signal House',
            original_language: 'en',
            first_air_date: '2021-01-01',
            overview: 'Fictional show-level description.',
            vote_count: 500,
            vote_average: 7,
            genres: [],
            credits: { cast: [], crew: [] },
        };
        const mockTmdb = (page: Page) =>
            page.route('https://api.themoviedb.org/**', (route) => {
                const path = new URL(route.request().url()).pathname;
                if (path.includes('/season/')) seasonRequests.push(path);
                return route.fulfill({
                    json: path.includes('/search/')
                        ? { results: [details] }
                        : details,
                });
            });
        try {
            await mockTmdb(app.mainWindow);
            const downloadsDir = join(dataDir, 'flat-series-downloads');
            mkdirSync(downloadsDir, { recursive: true });
            await app.electronApp.evaluate(({ dialog }, folder) => {
                dialog.showOpenDialog = async () =>
                    ({ canceled: false, filePaths: [folder] }) as Awaited<
                        ReturnType<typeof dialog.showOpenDialog>
                    >;
            }, downloadsDir);
            await app.mainWindow
                .getByRole('button', { name: 'Open downloads', exact: true })
                .click();
            await app.mainWindow
                .getByRole('button', { name: 'Change Folder', exact: true })
                .click();
            await expect(
                app.mainWindow.getByTestId('downloads-folder')
            ).toContainText('flat-series-downloads');
            await goToDashboard(app.mainWindow);
            if (tmdb) {
                await openSettings(app.mainWindow);
                await openSettingsSection(app.mainWindow, 'tmdb');
                await setSwitch(
                    app.mainWindow
                        .getByTestId('tmdb-enabled')
                        .getByRole('switch'),
                    true
                );
                await app.mainWindow
                    .getByTestId('tmdb-api-key')
                    .fill('fictional-e2e-key');
                await saveSettings(app.mainWindow);
                await goToDashboard(app.mainWindow);
            }
            await addStalkerPortal(app.mainWindow, {
                macAddress: '00:1A:79:18:44:03',
                name: 'Flat series fixture',
            });
            await app.mainWindow
                .getByRole('button', {
                    name: 'Signal House (1-9 season)',
                    exact: true,
                })
                .click();
            const episodes = app.mainWindow.locator('.episode-item');
            await expect(episodes).toHaveCount(189);
            await expect(app.mainWindow.locator('.season-tabs')).toHaveCount(0);
            await expect(
                app.mainWindow.locator('[data-testid="series-quick-start"]')
            ).not.toContainText(/S\d+E/);
            if (tmdb)
                await expect(
                    app.mainWindow.locator('app-content-hero')
                ).toContainText(details.overview);
            expect(seasonRequests).toEqual([]);
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(app.mainWindow, theme);
                await expect(episodes.first()).toBeVisible();
                await app.mainWindow.screenshot({
                    path: testInfo.outputPath(`flat-series-${theme}.png`),
                });
            }
            await app.mainWindow
                .getByRole('button', { name: 'Add to favorites', exact: true })
                .click();
            // Seed a legacy row whose season was incorrectly inferred as 9.
            const episodeId = Number(
                await episodes.first().getAttribute('data-episode-id')
            );
            const watchedId = Number(
                await episodes.nth(1).getAttribute('data-episode-id')
            );
            const playlistId = /\/stalker\/([^/]+)/.exec(
                new URL(app.mainWindow.url()).pathname
            )?.[1];
            if (!playlistId) throw new Error('Missing fixture source');
            await app.mainWindow
                .getByRole('button', {
                    name: 'Download Episode 189',
                    exact: true,
                })
                .click();
            const downloadedEpisode = () =>
                app.mainWindow.evaluate(async () =>
                    (await window.electron.downloadsGetList()).find(
                        (row) => row.episodeNumber === 189
                    )
                );
            await expect
                .poll(async () => (await downloadedEpisode())?.status)
                .toBe('completed');
            expect(
                (await downloadedEpisode())?.metadataSnapshot?.episode
            ).toMatchObject({
                seasonNumber: 9,
                episodeNumber: 189,
                seasonUnknown: true,
            });
            // A legacy download has the same storage coordinates but no new flag.
            const legacy = await app.mainWindow.evaluate(
                async ({ playlistId, episodeId, downloadsDir, server }) =>
                    window.electron.downloadsStart({
                        playlistId,
                        xtreamId: episodeId,
                        contentType: 'episode',
                        seriesXtreamId: 900001,
                        seasonNumber: 9,
                        episodeNumber: 1,
                        episodeIdentityScope: 'stalker-embedded-vod',
                        title: 'Signal House (1-9 season) - S09E01 - Episode 1',
                        url: `${server}/stream/issue1844/900001/1.mp4`,
                        downloadFolder: downloadsDir,
                        metadataSnapshot: {
                            version: 1,
                            language: 'en',
                            mediaKind: 'series',
                            title: 'Signal House (1-9 season)',
                            episode: { seasonNumber: 9, episodeNumber: 1 },
                        },
                    }),
                {
                    playlistId,
                    episodeId,
                    downloadsDir,
                    server: stalkerMockServer,
                }
            );
            expect(legacy.success).toBe(true);
            await expect
                .poll(() =>
                    app.mainWindow.evaluate(
                        async () =>
                            (await window.electron.downloadsGetList()).filter(
                                (row) => row.status === 'completed'
                            ).length
                    )
                )
                .toBe(2);
            await app.mainWindow.evaluate(
                async ({ playlistId, episodeId, watchedId }) => {
                    await window.electron.dbSavePlaybackPosition(playlistId, {
                        contentXtreamId: episodeId,
                        contentType: 'episode',
                        seriesXtreamId: 900001,
                        seasonNumber: 9,
                        episodeNumber: 1,
                        positionSeconds: 120,
                        durationSeconds: 1200,
                    });
                    await window.electron.dbSavePlaybackPosition(playlistId, {
                        contentXtreamId: watchedId,
                        contentType: 'episode',
                        seriesXtreamId: 900001,
                        seasonNumber: 9,
                        episodeNumber: 2,
                        positionSeconds: 1200,
                        durationSeconds: 1200,
                    });
                },
                { playlistId, episodeId, watchedId }
            );
            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;
            await mockTmdb(app.mainWindow);
            expect(
                (await downloadedEpisode())?.metadataSnapshot?.episode
                    ?.seasonUnknown
            ).toBe(true);
            await openGlobalFavorites(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await app.mainWindow
                .getByRole('button', {
                    name: 'Signal House (1-9 season)',
                    exact: true,
                })
                .click();
            await expect(
                app.mainWindow.locator('.episode-item--in-progress')
            ).toHaveCount(1);
            await expect(
                app.mainWindow.locator('.episode-item--watched')
            ).toHaveCount(1);
            await expect(
                app.mainWindow.locator('[data-testid="series-quick-start"]')
            ).toContainText('E03');
            await expect(app.mainWindow.locator('.season-tabs')).toHaveCount(0);
            await app.mainWindow.locator('.episode-item').last().click();
            await expect
                .poll(() =>
                    app.mainWindow
                        .locator('video')
                        .evaluateAll((videos) =>
                            videos.map(
                                (video) =>
                                    (video as HTMLVideoElement).currentSrc
                            )
                        )
                )
                .toContain(
                    `${stalkerMockServer}/stream/issue1844/900001/189.mp4`
                );
            await expect(
                app.mainWindow.locator('app-portal-inline-player')
            ).toContainText('E189');
            expect(seasonRequests).toEqual([]);
            await app.mainWindow.screenshot({
                path: testInfo.outputPath('flat-series.png'),
            });
            await app.mainWindow
                .getByRole('button', { name: 'Open downloads', exact: true })
                .click();
            const library = app.mainWindow.getByTestId(
                'downloads-library-section'
            );
            await expect(library).toContainText('Signal House (1-9 season)');
            await expect(library).not.toContainText('Season 9');
            await fillWorkspaceSearch(app.mainWindow, 'S09E01');
            await expect(library).not.toContainText('Season 9');
            await library.locator('.download-library__episodes-button').click();
            await expect(
                app.mainWindow.locator('.downloaded-series-dialog__number')
            ).toHaveText(['E01']);
            await app.mainWindow
                .getByRole('button', { name: 'Close dialog', exact: true })
                .click();
            await fillWorkspaceSearch(app.mainWindow, '');
            await library.locator('.download-library__episodes-button').click();
            await expect(
                app.mainWindow.locator('.downloaded-series-dialog__number')
            ).toHaveText(['E01', 'E189']);
            await app.mainWindow
                .getByRole('button', { name: 'Close dialog', exact: true })
                .click();
            await library
                .getByRole('button', {
                    name: 'Open details: Signal House (1-9 season)',
                    exact: true,
                })
                .click();
            await expect(
                app.mainWindow.locator('.offline-detail__season-tab')
            ).toHaveCount(1);
            await expect(
                app.mainWindow.locator('.offline-detail__episode')
            ).toHaveCount(2);
        } finally {
            await closeElectronApp(app);
        }
    });
}
