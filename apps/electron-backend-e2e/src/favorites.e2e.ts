import { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryById,
    clickGridListCardByTitle,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    contentCardByTitle,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expectVisibleContentCardTitle,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openWorkspaceSection,
    openPlaylistFavorites,
    openSources,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    switchUnifiedCollectionContent,
    switchUnifiedCollectionScope,
    test,
    waitForM3uCatalog,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
    getStalkerTitle,
    getXtreamTitle,
    pickDistinctTitles,
} from './portal-mock-fixtures';

test.describe('Electron Favorites', () => {
    test('shows M3U favorites in playlist and all-playlists scope, and preserves them after restart', async ({
        dataDir,
    }) => {
        const playlistTitle = 'm3u-favorites-source.m3u';
        const playlistSourceTitle = 'm3u-favorites-source';
        const filePath = writeTemporaryM3uFile(dataDir, playlistTitle, [
            {
                groupTitle: 'News',
                name: 'M3U Favorite One',
                url: 'https://streams.example.test/m3u-favorite-one.m3u8',
            },
            {
                groupTitle: 'News',
                name: 'M3U Favorite Two',
                url: 'https://streams.example.test/m3u-favorite-two.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            await toggleFavoriteForChannel(app.mainWindow, 'M3U Favorite One');
            await toggleFavoriteForChannel(app.mainWindow, 'M3U Favorite Two');
            await openPlaylistFavorites(app.mainWindow);

            await expect(channelItemByTitle(app.mainWindow, 'M3U Favorite One')).toHaveCount(
                1
            );
            await expect(channelItemByTitle(app.mainWindow, 'M3U Favorite Two')).toHaveCount(
                1
            );

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await expect(channelItemByTitle(app.mainWindow, 'M3U Favorite One')).toHaveCount(
                1
            );
            await expect(channelItemByTitle(app.mainWindow, 'M3U Favorite Two')).toHaveCount(
                1
            );

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, playlistSourceTitle)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);
            await switchUnifiedCollectionScope(
                app.mainWindow,
                'All playlists'
            );
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Favorite One')
            ).toHaveCount(1);
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Favorite Two')
            ).toHaveCount(1);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('shows Xtream live, movie, and series favorites in playlist and all-playlists scope, and preserves them after restart', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const liveFixture = await fetchXtreamLiveFixture(request, xtreamCredentials);
        const vodFixture = await fetchXtreamVodFixture(request, xtreamCredentials);
        const seriesFixture = await fetchXtreamSeriesFixture(
            request,
            xtreamCredentials
        );
        const [liveTitle] = pickDistinctTitles(liveFixture.items, getXtreamTitle);
        const portalTitle = 'Xtream Favorites Source';
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: portalTitle,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await clickCategoryByNameExact(
                app.mainWindow,
                liveFixture.categoryName
            );
            await toggleFavoriteForChannel(app.mainWindow, liveTitle);

            await app.mainWindow.getByRole('link', { name: 'Movies', exact: true }).click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            // Use clickFirstGridListCard: grid sorts by date-desc so fixture order ≠
            // display order; this atomically reads the first card's title and clicks
            // it, avoiding a race where the grid re-renders between the title read
            // and a separate search-by-title click.
            const movieTitle = await clickFirstGridListCard(app.mainWindow);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Series', exact: true }).click();
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            const seriesTitle = await clickFirstGridListCard(app.mainWindow);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(1);

            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);

            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalTitle).first().click();
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);
            await switchUnifiedCollectionScope(
                app.mainWindow,
                'All playlists'
            );
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(
                channelItemByTitle(app.mainWindow, liveTitle)
            ).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('shows Stalker live, movie, and series favorites in playlist and all-playlists scope, and preserves them after restart', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const liveFixture = await fetchStalkerCategoryFixture(request, 'itv');
        const vodFixture = await fetchStalkerCategoryFixture(request, 'vod');
        const seriesFixture = await fetchStalkerCategoryFixture(request, 'series');
        const [liveTitle] = pickDistinctTitles(liveFixture.items, getStalkerTitle);
        const [movieTitle] = pickDistinctTitles(vodFixture.items, getStalkerTitle);
        const [seriesTitle] = pickDistinctTitles(seriesFixture.items, getStalkerTitle);
        const portalTitle = 'Stalker Favorites Source';
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                name: portalTitle,
            });
            await waitForStalkerCatalog(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Live TV', exact: true }).click();
            await clickCategoryById(app.mainWindow, liveFixture.categoryId);
            await toggleFavoriteForChannel(app.mainWindow, liveTitle);

            await app.mainWindow.getByRole('link', { name: 'Movies', exact: true }).click();
            await clickCategoryById(app.mainWindow, vodFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Series', exact: true }).click();
            await clickCategoryById(app.mainWindow, seriesFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, seriesTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(1);

            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expect(contentCardByTitle(app.mainWindow, movieTitle)).toHaveCount(1);

            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expect(contentCardByTitle(app.mainWindow, seriesTitle)).toHaveCount(1);

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expect(contentCardByTitle(app.mainWindow, movieTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expect(contentCardByTitle(app.mainWindow, seriesTitle)).toHaveCount(1);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalTitle).first().click();
            await waitForStalkerCatalog(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);
            await switchUnifiedCollectionScope(
                app.mainWindow,
                'All playlists'
            );
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(
                channelItemByTitle(app.mainWindow, liveTitle)
            ).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expect(
                contentCardByTitle(app.mainWindow, movieTitle)
            ).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expect(
                contentCardByTitle(app.mainWindow, seriesTitle)
            ).toHaveCount(1);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('opens Stalker favorite movies and series in source detail routes and returns back to favorites', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const vodFixture = await fetchStalkerCategoryFixture(request, 'vod');
        const seriesFixture = await fetchStalkerCategoryFixture(request, 'series');
        const [movieTitle] = pickDistinctTitles(vodFixture.items, getStalkerTitle);
        const [seriesTitle] = pickDistinctTitles(seriesFixture.items, getStalkerTitle);
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                name: 'Stalker Favorite Detail Source',
            });
            await waitForStalkerCatalog(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Movies', exact: true }).click();
            await clickCategoryById(app.mainWindow, vodFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Series', exact: true }).click();
            await clickCategoryById(app.mainWindow, seriesFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, seriesTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);

            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);
            await contentCardByTitle(app.mainWindow, movieTitle).first().click();
            await app.mainWindow.waitForURL(/\/workspace\/stalker\/[^/]+\/vod\/[^/]+$/);
            await expect(app.mainWindow.locator('app-content-hero')).toContainText(
                movieTitle
            );

            await goBackFromDetail(app.mainWindow);
            await expect
                .poll(() => new URL(app.mainWindow.url()).pathname)
                .toMatch(/\/favorites$/);
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);

            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);
            await contentCardByTitle(app.mainWindow, seriesTitle).first().click();
            await app.mainWindow.waitForURL(/\/workspace\/stalker\/[^/]+\/series\/[^/]+$/);
            await expect(app.mainWindow.locator('app-content-hero')).toContainText(
                seriesTitle
            );

            await goBackFromDetail(app.mainWindow);
            await expect
                .poll(() => new URL(app.mainWindow.url()).pathname)
                .toMatch(/\/favorites$/);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);
        } finally {
            await closeElectronApp(app);
        }
    });
});

const xtreamCredentials = {
    username: defaultXtreamUsername,
    password: defaultXtreamPassword,
};

async function addCurrentDetailToFavorites(page: Page): Promise<void> {
    const addButton = page.locator('button.favorite-btn').first();

    await expect(addButton).toBeVisible({ timeout: 20000 });
    await addButton.click();
    await expect(page.locator('button.favorite-btn--active').first()).toBeVisible({
        timeout: 20000,
    });
}

async function goBackFromDetail(page: Page): Promise<void> {
    const backButton = page.locator('app-content-hero .hero__back-button').first();

    await expect(backButton).toBeVisible({ timeout: 20000 });
    await backButton.click();
}

async function toggleFavoriteForChannel(page: Page, title: string): Promise<void> {
    const item = channelItemByTitle(page, title).first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
    await expect(item.locator('.favorite-button mat-icon').first()).toHaveText(/star/);
}
