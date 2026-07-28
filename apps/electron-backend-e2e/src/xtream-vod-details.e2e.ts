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
    xtreamMockServer,
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
    test('keeps a sparse VOD playable inside the curated fallback', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(
            request,
            emptyMetadataCredentials
        );
        const [movieTitle] = pickDistinctTitles(
            vodFixture.items,
            getXtreamTitle
        );
        const movieItem = vodFixture.items.find(
            (item) => getXtreamTitle(item) === movieTitle
        );
        const streamId = Number(movieItem?.stream_id);
        const containerExtension = movieItem?.container_extension?.trim();
        if (
            !Number.isInteger(streamId) ||
            streamId <= 0 ||
            !containerExtension
        ) {
            throw new Error(
                'Xtream VOD fixture returned an invalid playback source.'
            );
        }
        const expectedMovieUrl =
            `${xtreamMockServer}/movie/` +
            `${emptyMetadataCredentials.username}/` +
            `${emptyMetadataCredentials.password}/` +
            `${streamId}.${containerExtension}`;
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
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await clickGridListCardByTitle(app.mainWindow, movieTitle);

            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );
            await expect(
                app.mainWindow.locator('app-content-hero')
            ).toContainText(movieTitle);
            await expect(
                app.mainWindow.locator(
                    '[data-testid="xtream-vod-fallback-status"]'
                )
            ).toContainText('Portal metadata unavailable');
            await expect(
                app.mainWindow.locator('[data-testid="xtream-vod-fallback"]')
            ).toContainText(
                'Extended metadata was not provided by this portal.'
            );

            const playButton = app.mainWindow
                .locator('button.play-btn')
                .first();
            await expect(playButton).toBeVisible();
            await expect(
                app.mainWindow.locator('button.favorite-btn').first()
            ).toBeVisible();
            await expect(
                app.mainWindow.locator('button.download-btn').first()
            ).toBeVisible();

            const movieResponsePromise = app.mainWindow.waitForResponse(
                (response) =>
                    response.url() === expectedMovieUrl &&
                    response.request().method() === 'GET',
                { timeout: 20_000 }
            );
            await playButton.click();

            const movieResponse = await movieResponsePromise;
            expect(movieResponse.status()).toBe(302);
            await expect(
                app.mainWindow.locator('app-portal-detail-shell')
            ).toHaveClass(/shell-host--watch/);
            await expect(
                app.mainWindow
                    .locator('app-portal-inline-player app-web-player-view')
                    .first()
            ).toBeVisible({ timeout: 20_000 });
            await expect(
                app.mainWindow.locator(
                    'app-portal-inline-player .player-shell__title'
                )
            ).toContainText(movieTitle);
        } finally {
            await closeElectronApp(app);
        }
    });
});
