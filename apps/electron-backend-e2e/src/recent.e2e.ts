import { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryById,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    contentCardByTitle,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openPlaylistFavorites,
    openPlaylistRecent,
    openWorkspaceSection,
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

test.describe('Electron Recently Viewed', () => {
    test('tracks M3U recent channels in newest-first order, supports all-playlists scope, and persists removals after restart', async ({
        dataDir,
    }) => {
        const playlistTitle = 'm3u-recent-source.m3u';
        const playlistSourceTitle = 'm3u-recent-source';
        const filePath = writeTemporaryM3uFile(dataDir, playlistTitle, [
            {
                groupTitle: 'Live',
                name: 'Recent Channel One',
                url: 'https://streams.example.test/recent-one.m3u8',
            },
            {
                groupTitle: 'Live',
                name: 'Recent Channel Two',
                url: 'https://streams.example.test/recent-two.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);

            await channelItemByTitle(app.mainWindow, 'Recent Channel One')
                .first()
                .click();
            await channelItemByTitle(app.mainWindow, 'Recent Channel Two')
                .first()
                .click();

            await openPlaylistRecent(app.mainWindow);
            await expect
                .poll(() => visibleLiveTitles(app.mainWindow))
                .toEqual(['Recent Channel Two', 'Recent Channel One']);

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await expect
                .poll(() => visibleLiveTitles(app.mainWindow))
                .toEqual(['Recent Channel Two', 'Recent Channel One']);

            await removeLiveRecentItem(app.mainWindow, 'Recent Channel Two');
            await expect
                .poll(() => visibleLiveTitles(app.mainWindow))
                .toEqual(['Recent Channel One']);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, playlistSourceTitle)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openPlaylistRecent(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await expect
                .poll(() => visibleLiveTitles(app.mainWindow))
                .toEqual(['Recent Channel One']);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('tracks Xtream live, movie, and series history across playlist and all-playlists scope, persists after restart, and supports clearing', async ({
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
        const [movieTitle] = pickDistinctTitles(vodFixture.items, getXtreamTitle);
        const [seriesTitle] = pickDistinctTitles(seriesFixture.items, getXtreamTitle);
        const portalTitle = 'Xtream Recent Source';
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
            await openPlaylistFavorites(app.mainWindow);
            await channelItemByTitle(app.mainWindow, liveTitle).first().click();
            await closeUnifiedLiveDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Movies', exact: true }).click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await playCurrentDetail(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Series', exact: true }).click();
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            await clickGridListCardByTitle(app.mainWindow, seriesTitle);
            await playFirstSeriesEpisode(app.mainWindow);

            await openPlaylistRecent(app.mainWindow);
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
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openPlaylistRecent(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expect(contentCardByTitle(app.mainWindow, movieTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expect(contentCardByTitle(app.mainWindow, seriesTitle)).toHaveCount(1);

            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await clearRecentItems(app.mainWindow);
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(0);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expect(contentCardByTitle(app.mainWindow, movieTitle)).toHaveCount(0);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expect(contentCardByTitle(app.mainWindow, seriesTitle)).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('tracks Stalker live, movie, and series history across playlist and all-playlists scope, and preserves it after restart', async ({
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
        const portalTitle = 'Stalker Recent Source';
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                name: portalTitle,
            });
            await waitForStalkerCatalog(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Live TV', exact: true }).click();
            await clickCategoryById(app.mainWindow, liveFixture.categoryId);
            await toggleFavoriteForChannel(app.mainWindow, liveTitle);
            await openPlaylistFavorites(app.mainWindow);
            await channelItemByTitle(app.mainWindow, liveTitle).first().click();
            await closeUnifiedLiveDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Movies', exact: true }).click();
            await clickCategoryById(app.mainWindow, vodFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await playCurrentDetail(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow.getByRole('link', { name: 'Series', exact: true }).click();
            await clickCategoryById(app.mainWindow, seriesFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, seriesTitle);
            await playFirstSeriesEpisode(app.mainWindow);

            await openPlaylistRecent(app.mainWindow);
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
            await openPlaylistRecent(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(channelItemByTitle(app.mainWindow, liveTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expect(contentCardByTitle(app.mainWindow, movieTitle)).toHaveCount(1);
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expect(contentCardByTitle(app.mainWindow, seriesTitle)).toHaveCount(1);
        } finally {
            await closeElectronApp(app);
        }
    });
});

const xtreamCredentials = {
    username: defaultXtreamUsername,
    password: defaultXtreamPassword,
};

async function clearRecentItems(page: Page): Promise<void> {
    await page
        .getByRole('button', { name: 'Clear recently viewed for this section' })
        .click();
}

async function closeUnifiedLiveDetail(page: Page): Promise<void> {
    const closeButton = page.locator('.player-toolbar .close-btn').first();

    await expect(closeButton).toBeVisible({ timeout: 20000 });
    await closeButton.click();
}

async function goBackFromDetail(page: Page): Promise<void> {
    const backButton = page.locator('app-content-hero .hero__back-button').first();

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
    const episodeCard = page.locator('.episode-card, .episode-list-item').first();

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

async function removeLiveRecentItem(page: Page, title: string): Promise<void> {
    const item = channelItemByTitle(page, title).first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
}

async function toggleFavoriteForChannel(page: Page, title: string): Promise<void> {
    const item = channelItemByTitle(page, title).first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
}

async function visibleLiveTitles(page: Page): Promise<string[]> {
    return page
        .locator('[data-test-id="channel-item"] .channel-name')
        .allInnerTexts()
        .then((titles) => titles.map((title) => title.trim()));
}
