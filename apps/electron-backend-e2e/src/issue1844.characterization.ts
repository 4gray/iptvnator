import {
    addStalkerPortal,
    closeElectronApp,
    expect,
    fillWorkspaceSearch,
    launchElectronApp,
    stalkerMockServer,
    test,
} from './electron-test-fixtures';

const mac = '00:1A:79:18:44:01';
for (const [title, movie, season, other] of [
    ['Fixture Alpha', '10', '11', '20'],
    ['Fixture Beta', '20', '21', '10'],
]) {
    test(`@stalker @electron research #1844: ${title} loads other show's URL`, async ({
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
                const wrongUrl = `${stalkerMockServer}/stream/issue1844/${other}/${index + 1}.mp4`;
                await expect
                    .poll(() => mediaRequests.includes(wrongUrl))
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
                    .toContainEqual({ src: wrongUrl, ready: 4 });
                await testInfo.attach(`${title}-episode-${index + 1}`, {
                    body: JSON.stringify({
                        selected: `${movie}/${index + 1}`,
                        loaded: wrongUrl,
                    }),
                    contentType: 'application/json',
                });
            }
            await app.mainWindow.screenshot({
                path: testInfo.outputPath('wrong-episode.png'),
            });
        } finally {
            await closeElectronApp(app);
        }
    });
}

test('@stalker research #1844: existing is-series mock does not implement lazy season rows', async ({
    request,
}) => {
    const headers = { Cookie: 'mac=00:1A:79:00:00:04' };
    const catalog = await request.get(
        `${stalkerMockServer}/portal.php?action=get_ordered_list&type=vod&category=*`,
        { headers }
    );
    const item = (await catalog.json()).js.data.find(
        (row: { is_series: number }) => [true, 1, '1'].includes(row.is_series)
    );
    expect(item).toBeTruthy();
    const response = await request.get(
        `${stalkerMockServer}/portal.php?action=get_ordered_list&type=vod&movie_id=${item.id}`,
        { headers }
    );
    const rows = (await response.json()).js;
    expect(rows.length).toBeGreaterThan(0);
    expect(
        rows.filter((row: { is_season?: boolean }) => row.is_season === true)
    ).toEqual([]);
});
