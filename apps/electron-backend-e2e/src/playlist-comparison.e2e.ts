import {
    closeElectronApp,
    expect,
    launchElectronApp,
    restartElectronApp,
    test,
} from './electron-test-fixtures';

const comparisonPath = '/workspace/playlist-comparison';

const snapshot = async () => {
    const catalogueTypes = ['movie', 'series', 'live'];
    return {
        content: await Promise.all(
            ['comparison-a', 'comparison-b'].flatMap((id) =>
                catalogueTypes.map(async (type) => [
                    id,
                    type,
                    await window.electron.dbGetContent(id, type),
                ])
            )
        ),
        statuses: await Promise.all(
            ['comparison-a', 'comparison-b'].flatMap((id) =>
                catalogueTypes.map(async (type) => [
                    id,
                    type,
                    await window.electron.dbGetAppState(
                        `xtream-import-status:${id}:${type}`
                    ),
                ])
            )
        ),
    };
};

test.describe('Xtream playlist comparison', () => {
    test('@electron @sqlite compares imported local catalogues without provider requests or writes', async ({
        dataDir,
    }) => {
        let app = await launchElectronApp(dataDir);
        try {
            await app.mainWindow.evaluate(async () => {
                for (const id of ['comparison-a', 'comparison-b']) {
                    await window.electron.dbUpsertAppPlaylist({
                        _id: id,
                        title: id,
                        serverUrl: `https://${id}.invalid`,
                        username: 'user',
                        password: 'pass',
                        importDate: '',
                        lastUsage: '',
                        count: 0,
                        autoRefresh: false,
                    });
                    for (const type of ['movie', 'series', 'live'] as const) {
                        const common =
                            type === 'live'
                                ? {
                                      stream_id: 1,
                                      name: 'Common Live',
                                      category_id: '1',
                                      epg_channel_id: 'common.live',
                                  }
                                : type === 'series'
                                  ? {
                                        series_id: 1,
                                        name: 'Common Series',
                                        category_id: '1',
                                        tmdb_id: 1,
                                    }
                                  : {
                                        stream_id: 1,
                                        name: id.endsWith('a')
                                            ? 'TMDB Movie A'
                                            : 'TMDB Movie B',
                                        category_id: '1',
                                    };
                        const unique =
                            type === 'live'
                                ? {
                                      stream_id: id.endsWith('a') ? 2 : 3,
                                      name: id.endsWith('a')
                                          ? 'Only A Live'
                                          : 'Only B Live',
                                      category_id: '1',
                                  }
                                : type === 'series'
                                  ? {
                                        series_id: id.endsWith('a') ? 2 : 3,
                                        name: id.endsWith('a')
                                            ? 'Only A Series'
                                            : 'Only B Series',
                                        category_id: '1',
                                    }
                                  : {
                                        stream_id: id.endsWith('a') ? 2 : 3,
                                        name: id.endsWith('a')
                                            ? 'Only A Movie'
                                            : 'Only B Movie',
                                        category_id: '1',
                                    };
                        await window.electron.dbSaveCategories(
                            id,
                            [{ category_id: '1', category_name: type }],
                            type === 'movie' ? 'movies' : type
                        );
                        await window.electron.dbSaveContent(
                            id,
                            [common, unique],
                            type
                        );
                        if (type === 'movie') {
                            const movie = (
                                await window.electron.dbGetContent(id, type)
                            ).find((item) => item.xtream_id === 1);
                            if (!movie) throw new Error('Missing common movie');
                            await window.electron.dbSetContentMetadataIfMissing(
                                movie.id,
                                { tmdbId: 1, releaseYear: 2024 }
                            );
                        }
                        await window.electron.dbSetAppState(
                            `xtream-import-status:${id}:${type}`,
                            'completed'
                        );
                    }
                }
                await window.electron.dbUpsertAppPlaylist({
                    _id: 'comparison-empty',
                    title: 'comparison-empty',
                    serverUrl: 'https://empty.invalid',
                    username: 'user',
                    password: 'pass',
                    importDate: '',
                    lastUsage: '',
                    count: 0,
                    autoRefresh: false,
                });
                await window.electron.dbSetAppState(
                    'xtream-import-status:comparison-empty:live',
                    'completed'
                );
            });

            const before = await app.mainWindow.evaluate(snapshot);
            expect(before.content).toEqual(
                expect.arrayContaining([
                    [
                        'comparison-a',
                        'movie',
                        expect.arrayContaining([
                            expect.objectContaining({
                                tmdb_id: 1,
                                release_year: 2024,
                            }),
                        ]),
                    ],
                ])
            );
            app = await restartElectronApp(app, dataDir);
            await app.mainWindow.evaluate(() => {
                window.__portalDebugEvents = [];
                window.__portalDebugUnsubscribe?.();
                if (window.electron.onPortalDebugEvent) {
                    window.__portalDebugUnsubscribe =
                        window.electron.onPortalDebugEvent((event) =>
                            window.__portalDebugEvents?.push(event)
                        );
                }
                window.__dbOperationEvents = [];
                window.__dbOperationUnsubscribe?.();
                if (window.electron.onDbOperationEvent) {
                    window.__dbOperationUnsubscribe =
                        window.electron.onDbOperationEvent((event) =>
                            window.__dbOperationEvents?.push(event)
                        );
                }
            });
            await app.mainWindow.evaluate((path) => {
                const targetUrl = new URL(window.location.href);
                const workspaceIndex =
                    targetUrl.pathname.lastIndexOf('/workspace');
                const rendererPath =
                    workspaceIndex >= 0
                        ? targetUrl.pathname.slice(0, workspaceIndex)
                        : targetUrl.pathname.replace(/\/$/, '');
                targetUrl.pathname = `${rendererPath}${path}`;
                window.history.pushState(null, '', targetUrl);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }, comparisonPath);
            await expect(
                app.mainWindow.getByText('Compare playlists')
            ).toBeVisible();
            const selects = app.mainWindow.locator(
                'app-playlist-comparison select'
            );
            await selects.nth(0).selectOption('comparison-a');
            await selects.nth(1).selectOption('comparison-b');

            for (const [type, commonA, commonB, onlyA, onlyB] of [
                [
                    'Movies',
                    'TMDB Movie A',
                    'TMDB Movie B',
                    'Only A Movie',
                    'Only B Movie',
                ],
                [
                    'Series',
                    'Common Series',
                    'Common Series',
                    'Only A Series',
                    'Only B Series',
                ],
                [
                    'Live TV',
                    'Common Live',
                    'Common Live',
                    'Only A Live',
                    'Only B Live',
                ],
            ]) {
                await app.mainWindow
                    .getByRole('button', { name: type })
                    .click();
                await expect(
                    app.mainWindow.getByText('Common: 1')
                ).toBeVisible();
                await app.mainWindow
                    .getByRole('button', { name: 'Common' })
                    .click();
                const commonRows = app.mainWindow.locator('.comparison__rows');
                if (commonA === commonB) {
                    await expect(
                        commonRows.getByText(commonA, { exact: true })
                    ).toHaveCount(2);
                } else {
                    await expect(
                        commonRows.getByText(commonA, { exact: true })
                    ).toBeVisible();
                    await expect(
                        commonRows.getByText(commonB, { exact: true })
                    ).toBeVisible();
                }
                await app.mainWindow
                    .getByRole('button', { name: 'Only A' })
                    .click();
                await expect(
                    app.mainWindow.getByText(onlyA, { exact: true })
                ).toBeVisible();
                await app.mainWindow
                    .getByRole('button', { name: 'Only B' })
                    .click();
                await expect(
                    app.mainWindow.getByText(onlyB, { exact: true })
                ).toBeVisible();
            }

            await selects.nth(0).selectOption('comparison-empty');
            await app.mainWindow
                .getByRole('button', { name: 'Live TV' })
                .click();
            await expect(
                app.mainWindow.getByText('Playlist A: 0')
            ).toBeVisible();
            await expect(app.mainWindow.getByText('Only B: 2')).toBeVisible();

            await app.mainWindow.evaluate(() =>
                window.electron.dbSetAppState(
                    'xtream-import-status:comparison-b:series',
                    'idle'
                )
            );
            await app.mainWindow.evaluate(() => {
                window.__dbOperationEvents = [];
            });
            await selects.nth(0).selectOption('comparison-a');
            await app.mainWindow
                .getByRole('button', { name: 'Series' })
                .click();
            await expect(
                app.mainWindow.getByText(/has not been imported locally/)
            ).toBeVisible();

            const after = {
                ...(await app.mainWindow.evaluate(snapshot)),
                ...(await app.mainWindow.evaluate(() => ({
                    portalEvents: window.__portalDebugEvents ?? [],
                    dbOperations: window.__dbOperationEvents ?? [],
                }))),
            };
            expect(after.content).toEqual(before.content);
            expect(
                after.statuses.filter(
                    ([id, type]) =>
                        !(id === 'comparison-b' && type === 'series')
                )
            ).toEqual(
                before.statuses.filter(
                    ([id, type]) =>
                        !(id === 'comparison-b' && type === 'series')
                )
            );
            expect(after.portalEvents).toEqual([]);
            expect(after.dbOperations).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    });
});
