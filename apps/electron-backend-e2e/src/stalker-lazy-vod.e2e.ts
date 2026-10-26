import {
    addStalkerPortal,
    closeElectronApp,
    expect,
    fillWorkspaceSearch,
    launchElectronApp,
    restartElectronApp,
    openGlobalFavorites,
    openGlobalRecent,
    switchUnifiedCollectionScope,
    stalkerMockServer,
    test,
} from './electron-test-fixtures';

const mac = '00:1A:79:18:44:01';
for (const [title, movie, season] of [
    ['Fixture Alpha', '10', '11'],
    ['Fixture Beta', '20', '21'],
]) {
    test(`@stalker @electron regression #1844: ${title} plays its own episode files`, async ({
        dataDir,
        request,
    }, testInfo) => {
        const app = await launchElectronApp(dataDir);
        const mediaRequests: string[] = [];
        app.mainWindow.on('request', (req) => {
            if (req.url().includes('/stream/issue1844/'))
                mediaRequests.push(req.url());
        });
        try {
            // A correct protocol traversal resolves the selected show's files.
            const query = new URLSearchParams({
                action: 'get_ordered_list',
                type: 'vod',
                movie_id: movie,
                season_id: season,
                episode_id: movie === '10' ? '101' : '201',
            });
            const files = await request.get(
                `${stalkerMockServer}/portal.php?${query}`,
                { headers: { Cookie: `mac=${mac}` } }
            );
            const file = (await files.json()).js.data[0];
            const link = await request.get(
                `${stalkerMockServer}/portal.php?${new URLSearchParams({ action: 'create_link', type: 'vod', cmd: file.cmd, series: '1' })}`,
                { headers: { Cookie: `mac=${mac}` } }
            );
            expect((await link.json()).js.cmd).toBe(
                `${stalkerMockServer}/stream/issue1844/${movie}/1.mp4`
            );

            await addStalkerPortal(app.mainWindow, {
                macAddress: mac,
                name: 'Issue 1844 local fixture',
            });
            await expect(
                app.mainWindow.getByRole('button', { name: title, exact: true })
            ).toBeVisible({ timeout: 20000 });
            // Dedicated portal search is another independent entry point.
            await app.mainWindow
                .getByRole('link', { name: 'Advanced search', exact: true })
                .click();
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Search for content',
                    exact: true,
                })
            ).toBeVisible();
            await fillWorkspaceSearch(app.mainWindow, title);
            await expect(
                app.mainWindow.getByRole('button', { name: title, exact: true })
            ).toBeVisible();
            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            // Wildcard category search, then the explicit category: separate from playback.
            await fillWorkspaceSearch(app.mainWindow, title);
            await expect(
                app.mainWindow.getByRole('button', { name: title, exact: true })
            ).toBeVisible();
            await fillWorkspaceSearch(app.mainWindow, '');
            await app.mainWindow
                .locator('.category-item')
                .filter({ hasText: 'Fixture shows' })
                .click();
            await fillWorkspaceSearch(app.mainWindow, title);
            await app.mainWindow
                .getByRole('button', { name: title, exact: true })
                .click();
            const episodes = app.mainWindow.locator('.episode-item');
            await expect(episodes).toHaveCount(2, { timeout: 20000 });
            for (let index = 0; index < 2; index++) {
                await episodes.nth(index).click();
                const expectedUrl = `${stalkerMockServer}/stream/issue1844/${movie}/${index + 1}.mp4`;
                await expect
                    .poll(() => mediaRequests.includes(expectedUrl))
                    .toBe(true);
                await expect
                    .poll(() =>
                        app.mainWindow.locator('video').evaluateAll((videos) =>
                            videos.map((video) => ({
                                src: (video as HTMLVideoElement).currentSrc,
                                ready: (video as HTMLVideoElement).readyState,
                            }))
                        )
                    )
                    .toContainEqual({ src: expectedUrl, ready: 4 });
                await testInfo.attach(`${title}-episode-${index + 1}`, {
                    body: JSON.stringify({
                        selected: `${movie}/${index + 1}`,
                        loaded: expectedUrl,
                    }),
                    contentType: 'application/json',
                });
            }
            await app.mainWindow.screenshot({
                path: testInfo.outputPath('correct-episode.png'),
            });
        } finally {
            await closeElectronApp(app);
        }
    });
}

for (const collection of ['favorites', 'recentlyViewed'] as const) {
    test(`@stalker @persistence @electron regression #1844: old ${collection} snapshot plays correct files after restart`, async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        try {
            await addStalkerPortal(app.mainWindow, {
                macAddress: mac,
                name: 'Old lazy VOD source',
            });
            // Closing the add dialog precedes the router navigation on slower hosts.
            await app.mainWindow.waitForURL(/\/workspace\/stalker\/[^/]+\//);
            const playlistId = /\/stalker\/([^/]+)/.exec(
                new URL(app.mainWindow.url()).pathname
            )?.[1];
            if (!playlistId) throw new Error('Fixture playlist route missing');
            const saved = {
                id: '10',
                name: 'Fixture Alpha',
                title: 'Fixture Alpha',
                category_id: '2001',
                is_series: 1,
                has_files: 1,
                // Old recent rows can contain the wrong synthesized episode command.
                cmd: '/media/file_101.mpg',
                added_at: 1720000000000,
            };
            await app.mainWindow.evaluate(
                async ({ id, collection, saved }) => {
                    const row = await window.electron.dbGetAppPlaylist(id);
                    if (!row) throw new Error('Fixture playlist missing');
                    const result = await window.electron.dbUpsertAppPlaylist({
                        ...row,
                        [collection]: [saved],
                    });
                    if (!result.success)
                        throw new Error('Unable to save old snapshot');
                },
                { id: playlistId, collection, saved }
            );
            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;
            // Startup must not require or rewrite the old saved entry.
            const stored = await app.mainWindow.evaluate(
                async ({ id, collection }) =>
                    (await window.electron.dbGetAppPlaylist(id))?.[collection],
                { id: playlistId, collection }
            );
            expect(stored).toEqual([saved]);
            if (collection === 'favorites')
                await openGlobalFavorites(app.mainWindow);
            else await openGlobalRecent(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await app.mainWindow
                .getByRole('button', { name: 'Fixture Alpha', exact: true })
                .click();
            const episodes = app.mainWindow.locator('.episode-item');
            await expect(episodes).toHaveCount(2);
            await episodes.first().click();
            await expect
                .poll(() =>
                    app.mainWindow.locator('video').evaluateAll((videos) =>
                        videos.map((video) => ({
                            src: (video as HTMLVideoElement).currentSrc,
                            ready: (video as HTMLVideoElement).readyState,
                        }))
                    )
                )
                .toContainEqual({
                    src: `${stalkerMockServer}/stream/issue1844/10/1.mp4`,
                    ready: 4,
                });
        } finally {
            await closeElectronApp(app);
        }
    });
}
