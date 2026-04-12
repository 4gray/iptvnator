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

const emptyMetadataCredentials = {
    password: 'emptyvod',
    username: 'emptyvod',
};

test.describe('Xtream VOD Details', () => {
    test('shows a curated fallback when the portal returns empty VOD metadata', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(
            request,
            emptyMetadataCredentials
        );
        const [movieTitle] = pickDistinctTitles(vodFixture.items, getXtreamTitle);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                ...emptyMetadataCredentials,
                name: 'Xtream Empty Metadata',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(app.mainWindow, vodFixture.categoryName);
            await clickGridListCardByTitle(app.mainWindow, movieTitle);

            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );
            await expect(app.mainWindow.locator('app-content-hero')).toContainText(
                movieTitle
            );
            await expect(
                app.mainWindow.locator('[data-testid="xtream-vod-fallback-status"]')
            ).toContainText('Portal metadata unavailable');
            await expect(
                app.mainWindow.locator('[data-testid="xtream-vod-fallback"]')
            ).toContainText(
                'Extended metadata was not provided by this portal.'
            );

            await expect(app.mainWindow.locator('button.play-btn')).toHaveCount(0);
            await expect(app.mainWindow.locator('button.favorite-btn')).toHaveCount(
                0
            );
            await expect(app.mainWindow.locator('button.download-btn')).toHaveCount(
                0
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});
