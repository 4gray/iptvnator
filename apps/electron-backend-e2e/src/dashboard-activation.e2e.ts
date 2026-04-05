import { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    goToDashboard,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getXtreamTitle,
    pickDistinctTitles,
} from './portal-mock-fixtures';

test.describe('Dashboard Activation', () => {
    test('opens live favorites in the collection route and movies/series in source detail routes from the dashboard', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const liveFixture = await fetchXtreamLiveFixture(
            request,
            xtreamCredentials
        );
        const vodFixture = await fetchXtreamVodFixture(
            request,
            xtreamCredentials
        );
        const seriesFixture = await fetchXtreamSeriesFixture(
            request,
            xtreamCredentials
        );
        const [liveTitle] = pickDistinctTitles(
            liveFixture.items,
            getXtreamTitle
        );
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Xtream Dashboard Activation Source',
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                liveFixture.categoryName
            );
            await toggleFavoriteForChannel(app.mainWindow, liveTitle);

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            const movieTitle = await clickFirstGridListCard(app.mainWindow);
            await playCurrentDetail(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            const seriesTitle = await clickFirstGridListCard(app.mainWindow);
            await playFirstSeriesEpisode(app.mainWindow);

            await goToDashboard(app.mainWindow);

            await dashboardActivityItemByTitle(
                app.mainWindow,
                'Global Favorites',
                liveTitle
            ).click();
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/favorites$/
            );
            await expect(
                app.mainWindow.locator('.player-toolbar .close-btn').first()
            ).toBeVisible({ timeout: 20000 });

            await app.mainWindow.goBack();
            await app.mainWindow.waitForURL(/\/workspace\/dashboard$/);

            await dashboardActivityItemByTitle(
                app.mainWindow,
                'Recently Watched',
                movieTitle
            ).click();
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );
            await expect(
                app.mainWindow.locator('app-content-hero')
            ).toContainText(movieTitle);

            await app.mainWindow.goBack();
            await app.mainWindow.waitForURL(/\/workspace\/dashboard$/);

            await dashboardActivityItemByTitle(
                app.mainWindow,
                'Recently Watched',
                seriesTitle
            ).click();
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/
            );
            await expect(
                app.mainWindow.locator('app-content-hero')
            ).toContainText(seriesTitle);
        } finally {
            await closeElectronApp(app);
        }
    });
});

const xtreamCredentials = {
    username: defaultXtreamUsername,
    password: defaultXtreamPassword,
};

function dashboardActivityItemByTitle(
    page: Page,
    widgetTitle: string,
    title: string
) {
    return page
        .locator('.widget-slot')
        .filter({ hasText: widgetTitle })
        .first()
        .locator('.activity-item')
        .filter({ hasText: title })
        .first();
}

async function goBackFromDetail(page: Page): Promise<void> {
    const backButton = page
        .locator('app-content-hero .hero__back-button')
        .first();

    await expect(backButton).toBeVisible({ timeout: 20000 });
    await backButton.click();
}

async function playCurrentDetail(page: Page): Promise<void> {
    const playButton = page.locator('button.play-btn').first();

    await expect(playButton).toBeVisible({ timeout: 20000 });
    await playButton.click();
}

async function playFirstSeriesEpisode(page: Page): Promise<void> {
    const seasonCard = page.locator('.season-card').first();
    const episodeCard = page
        .locator('.episode-card, .episode-list-item')
        .first();

    await expect
        .poll(
            async () =>
                (await seasonCard.count()) + (await episodeCard.count()),
            { timeout: 20000 }
        )
        .toBeGreaterThan(0);

    if ((await seasonCard.count()) > 0) {
        await seasonCard.scrollIntoViewIfNeeded();
        await expect(seasonCard).toBeVisible({ timeout: 20000 });
        await seasonCard.click();
    }

    await episodeCard.scrollIntoViewIfNeeded();
    await expect(episodeCard).toBeVisible({ timeout: 20000 });
    await episodeCard.click();
}

async function toggleFavoriteForChannel(
    page: Page,
    title: string
): Promise<void> {
    const item = page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: title })
        .first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
    await expect(item.locator('.favorite-button mat-icon').first()).toHaveText(
        /star/
    );
}
