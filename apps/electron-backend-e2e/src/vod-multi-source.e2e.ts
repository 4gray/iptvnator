import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchXtreamVodFixture,
    getXtreamTitle,
    pickDistinctTitles,
} from './portal-mock-fixtures';

/**
 * `multisrc1` and `multisrc2` are two distinct credential pairs that share one
 * faker seed, so both portals generate an IDENTICAL catalog. That overlap is
 * the whole premise of this feature: the same movie in two playlists.
 */
const portalA = { username: 'multisrc1', password: 'multisrc1' };
const portalB = { username: 'multisrc2', password: 'multisrc2' };

test.describe('VOD multi-source', () => {
    test('offers the same movie from another playlist and switches to it', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(request, portalA);
        const [movieTitle] = pickDistinctTitles(
            vodFixture.items,
            getXtreamTitle
        );
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                ...portalA,
                name: 'Multi Source A',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            // The second portal is what makes an alternative exist at all.
            await addXtreamPortal(app.mainWindow, {
                ...portalB,
                name: 'Multi Source B',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );

            // Discovery is lazy, so the "Other sources" row of the "…" menu
            // appears after the detail view.
            const more = app.mainWindow.locator('[data-testid="vod-more-menu"]');
            await expect(more).toBeVisible({ timeout: 20000 });
            await more.click();
            const sourcesRow = app.mainWindow.locator(
                '[data-test-id="vod-menu-sources"]'
            );
            await expect(sourcesRow).toBeVisible({ timeout: 20000 });
            // The hint counts the alternatives: the same film in the other
            // portal, not the route's own copy.
            await expect(sourcesRow).toContainText('1');

            await sourcesRow.click();

            // Both the playing source and the alternative are listed.
            const rows = app.mainWindow.locator('app-vod-source-row');
            await expect(rows).toHaveCount(2);
            // Portal B was added last and is active, so A is the alternative.
            await expect(
                rows.filter({ hasText: 'Multi Source A' })
            ).toHaveCount(1);
            // The playing row must name its playlist, never a raw UUID.
            await expect(
                rows.filter({ hasText: 'Multi Source B' })
            ).toHaveCount(1);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('offers no other sources when only one playlist has the movie', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(request, portalA);
        const [movieTitle] = pickDistinctTitles(
            vodFixture.items,
            getXtreamTitle
        );
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                ...portalA,
                name: 'Multi Source A',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );

            // The action row must look exactly as it did before this feature.
            await expect(
                app.mainWindow.locator('.play-btn').first()
            ).toBeVisible({ timeout: 20000 });
            await app.mainWindow
                .locator('[data-testid="vod-more-menu"]')
                .click();
            await expect(
                app.mainWindow.locator('[data-test-id="vod-menu-copy-url"]')
            ).toBeVisible();
            await expect(
                app.mainWindow.locator('[data-test-id="vod-menu-sources"]')
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });
});
