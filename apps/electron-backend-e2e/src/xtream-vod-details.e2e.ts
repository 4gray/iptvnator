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
            // Both secondaries are icon-only on the movie detail now.
            await expect(
                app.mainWindow
                    .locator('[data-testid="vod-favorite-toggle"]')
                    .first()
            ).toBeVisible();
            await expect(
                app.mainWindow
                    .locator('[data-testid="vod-download-start"]')
                    .first()
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

for (const theme of ['light', 'dark']) {
    test(`supports keyboard and mouse scrolling in portal details (${theme})`, async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        try {
            const page = app.mainWindow;
            await page.setViewportSize({ width: 1200, height: 540 });
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            for (const section of ['Movies', 'Series']) {
                await page
                    .getByRole('link', { name: section, exact: true })
                    .click();
                await page.locator('app-grid-list mat-card').first().click();
                const shell = page.locator('app-portal-detail-shell');
                await expect(shell).toBeFocused();
                await page.evaluate(
                    (dark) =>
                        document.body.classList.toggle('dark-theme', dark),
                    theme === 'dark'
                );
                await expect
                    .poll(() =>
                        shell.evaluate(
                            (el) => el.scrollHeight - el.clientHeight
                        )
                    )
                    .toBeGreaterThan(0);
                expect(
                    await shell.evaluate(
                        (el) => getComputedStyle(el).scrollbarWidth
                    )
                ).not.toBe('none');
                await page.keyboard.press('PageDown');
                await expect
                    .poll(() => shell.evaluate((el) => el.scrollTop))
                    .toBeGreaterThan(0);
                await page.keyboard.press('Home');
                await expect
                    .poll(() => shell.evaluate((el) => el.scrollTop))
                    .toBe(0);
                const box = (await shell.boundingBox())!;
                await page.mouse.move(
                    box.x + box.width / 2,
                    box.y + box.height / 2
                );
                await page.mouse.wheel(0, 300);
                await expect
                    .poll(() => shell.evaluate((el) => el.scrollTop))
                    .toBeGreaterThan(0);
                await page.keyboard.press('Tab');
                await expect(shell.locator('.hero__back-button')).toBeFocused();
                await page.keyboard.press('Enter');
                await expect(shell).toHaveCount(0);
            }
        } finally {
            await closeElectronApp(app);
        }
    });
}
