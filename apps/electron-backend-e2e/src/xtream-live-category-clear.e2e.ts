import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    expectWorkspaceSearchScope,
    fillWorkspaceSearch,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamCatalog,
} from './electron-test-fixtures';

for (const control of ['header', 'sidebar'] as const) {
    test(`@search @xtream clears a deep-linked live category from the ${control} without replacing the player`, async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                username: 'minimal',
                password: 'minimal',
            });
            await waitForXtreamCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Recently added');

            const liveRail = app.mainWindow
                .locator('app-recently-added app-content-rail-shell')
                .filter({
                    has: app.mainWindow.getByRole('heading', {
                        name: /^Live TV/,
                    }),
                });
            const channel = liveRail
                .locator('app-content-card .content-card__activation')
                .first();
            await expect(channel).toBeVisible({ timeout: 20000 });
            const title = await channel.getAttribute('aria-label');
            if (!title)
                throw new Error('Recently added live channel has no title.');
            await channel.click();

            await expect
                .poll(() => new URL(app.mainWindow.url()).pathname)
                .toMatch(/\/workspace\/xtreams\/[^/]+\/live\/[^/]+$/);
            const player = app.mainWindow.locator(
                'app-live-stream-layout .video-player app-web-player-view'
            );
            await expect(player).toBeVisible({ timeout: 20000 });
            await player.evaluate((element) =>
                element.setAttribute('data-e2e-playback-marker', 'original')
            );
            const originalPlayer = await player.elementHandle();
            if (!originalPlayer) throw new Error('Live player is not mounted.');

            await fillWorkspaceSearch(app.mainWindow, title);
            await expect
                .poll(() => new URL(app.mainWindow.url()).searchParams.get('q'))
                .toBe(title);

            if (control === 'header') {
                await app.mainWindow
                    .getByTestId('workspace-search-scope-clear')
                    .click();
            } else {
                await app.mainWindow
                    .locator(
                        'app-workspace-context-panel .category-item[aria-current="true"]:visible'
                    )
                    .click();
            }

            await expect
                .poll(() => new URL(app.mainWindow.url()).pathname)
                .toMatch(/\/workspace\/xtreams\/[^/]+\/live$/);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                'Live TV / All items'
            );
            expect(new URL(app.mainWindow.url()).searchParams.get('q')).toBe(
                title
            );
            await expect(player).toBeVisible();
            await expect(player).toHaveAttribute(
                'data-e2e-playback-marker',
                'original'
            );
            expect(
                await originalPlayer.evaluate((element) => element.isConnected)
            ).toBe(true);
            await expect(
                app.mainWindow
                    .getByTestId('channel-item')
                    .filter({ hasText: title })
                    .first()
            ).toHaveClass(/(^|\s)active(\s|$)/);
        } finally {
            await closeElectronApp(app);
        }
    });
}
