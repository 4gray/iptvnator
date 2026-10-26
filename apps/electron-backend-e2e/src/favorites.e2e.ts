import { Page } from '@playwright/test';
import {
    addStalkerPortal,
    addXtreamPortal,
    channelItemByTitle,
    clearCurrentUnifiedCollection,
    clickCategoryById,
    clickGridListCardByTitle,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    contentCardByTitle,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expectPathname,
    expectVisibleContentCardTitle,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    goToDashboard,
    openGlobalRecent,
    openWorkspaceSection,
    openPlaylistFavorites,
    openSources,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    switchUnifiedCollectionContent,
    switchUnifiedCollectionScope,
    test,
    playlistSwitcherTitle,
    waitForM3uCatalog,
    waitForStalkerCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
    type LaunchedElectronApp,
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
import { readVisibleSidebarCategoryNames } from './sidebar-categories.e2e-support';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';
import {
    createFavoritesCatalogProxy,
    readSavedFavorites,
    refreshFavoriteCatalog,
    savedFavoriteIdentity,
} from './support/xtream-favorites-catalog';

test.describe('Electron Favorites', () => {
    for (const origin of ['favorites', 'recent', 'dashboard'] as const) {
        test(`@stalker @electron portal handoff from ${origin} restores the owning categories after opening a different source`, async ({
            dataDir,
            request,
        }) => {
            await resetMockServers(request, ['stalker']);
            const vod = await fetchStalkerCategoryFixture(request, 'vod');
            const [title] = pickDistinctTitles(vod.items, getStalkerTitle);
            const app = await launchElectronApp(dataDir);
            const page = app.mainWindow;
            await routePlayableStreams(page);
            try {
                await addStalkerPortal(page, { name: 'Portal A' });
                await waitForStalkerCatalog(page);
                await clickCategoryById(page, vod.categoryId);
                const portalPath = new URL(page.url()).pathname.replace(
                    /\/vod(?:\/[^/]+)?$/,
                    `/vod/${vod.categoryId}`
                );
                const categoriesA = await readVisibleSidebarCategoryNames(page);
                await clickGridListCardByTitle(page, title);
                await addCurrentDetailToFavorites(page);
                if (origin !== 'favorites') {
                    await startAndConfirmPlayback(page, () =>
                        page.locator('button.play-btn').first().click()
                    );
                }
                await goBackFromDetail(page);
                if (origin !== 'favorites') {
                    // Represent an already saved viewing position. The short
                    // media fixture ends before the player's 15 s save interval.
                    const playlistId = /\/stalker\/([^/]+)/.exec(
                        portalPath
                    )?.[1];
                    const contentId = Number(
                        vod.items.find(
                            (item) => getStalkerTitle(item) === title
                        )?.id
                    );
                    expect(playlistId).toBeTruthy();
                    await page.evaluate(
                        async ({ playlistId, contentId }) => {
                            await window.electron.dbSavePlaybackPosition(
                                playlistId!,
                                {
                                    contentXtreamId: contentId,
                                    contentType: 'vod',
                                    playlistType: 'stalker',
                                    positionSeconds: 2,
                                    durationSeconds: 6,
                                }
                            );
                        },
                        { playlistId, contentId }
                    );
                }

                await openSources(page);
                await addStalkerPortal(page, {
                    name: 'Portal B',
                    macAddress: '00:1A:79:00:00:03',
                });
                await waitForStalkerCatalog(page);
                const categoriesB = await readVisibleSidebarCategoryNames(page);
                expect(categoriesB).not.toEqual(categoriesA);

                if (origin === 'dashboard') {
                    await goToDashboard(page);
                    await page
                        .locator(
                            '[data-test-id="dashboard-continue-watching-rail-card"]'
                        )
                        .filter({ hasText: title })
                        .first()
                        .click();
                } else {
                    if (origin === 'favorites')
                        await openWorkspaceSection(page, 'Global favorites');
                    else await openGlobalRecent(page);
                    await switchUnifiedCollectionScope(page, 'All playlists');
                    await contentCardByTitle(page, title).first().click();
                }
                await expect(page.locator('app-content-hero')).toContainText(
                    title
                );
                if (origin !== 'favorites') {
                    await startAndConfirmPlayback(
                        page,
                        () =>
                            page
                                .getByRole('button', { name: /^Continue/ })
                                .first()
                                .click(),
                        0.5
                    );
                    await page
                        .getByRole('button', {
                            name: 'Close player',
                            exact: true,
                        })
                        .click();
                }
                await expect(
                    page.locator('app-view-in-portal-action')
                ).toHaveCount(0);
                await page.locator('[data-testid="vod-more-menu"]').click();
                await page
                    .getByRole('menuitem', {
                        name: 'Open in Portal A',
                        exact: true,
                    })
                    .click();
                await expect
                    .poll(() => new URL(page.url()).pathname)
                    .toBe(portalPath);
                await expect(page.locator('app-content-hero')).toContainText(
                    title
                );
                await expect
                    .poll(() => readVisibleSidebarCategoryNames(page))
                    .toEqual(categoriesA);

                await goBackFromDetail(page);
                await expectPathname(
                    page,
                    origin === 'favorites'
                        ? /\/workspace\/global-favorites$/
                        : /\/workspace\/global-recent$/
                );
                await expect(page.locator('app-content-hero')).toContainText(
                    title
                );
                for (const [name, expected] of [
                    ['Portal B', categoriesB],
                    ['Portal A', categoriesA],
                ] as const) {
                    await openSources(page);
                    await sourceRowByTitle(page, name).first().click();
                    await waitForStalkerCatalog(page);
                    await expect
                        .poll(() => readVisibleSidebarCategoryNames(page))
                        .toEqual(expected);
                }
            } finally {
                await closeElectronApp(app);
            }
        });
    }

    test('@persistence @m3u @electron shows M3U favorites in playlist and all-playlists scope, and preserves them after restart', async ({
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

            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Favorite One')
            ).toHaveCount(1);
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Favorite Two')
            ).toHaveCount(1);

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Favorite One')
            ).toHaveCount(1);
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Favorite Two')
            ).toHaveCount(1);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, playlistSourceTitle)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
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

    test('keeps playlist M3U favorites cleared after navigating away and back', async ({
        dataDir,
    }) => {
        const playlistTitle = 'm3u-clear-favorites-source.m3u';
        const playlistSourceTitle = 'm3u-clear-favorites-source';
        const filePath = writeTemporaryM3uFile(dataDir, playlistTitle, [
            {
                groupTitle: 'News',
                name: 'M3U Clear Favorite One',
                url: 'https://streams.example.test/m3u-clear-favorite-one.m3u8',
            },
            {
                groupTitle: 'News',
                name: 'M3U Clear Favorite Two',
                url: 'https://streams.example.test/m3u-clear-favorite-two.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            await toggleFavoriteForChannel(
                app.mainWindow,
                'M3U Clear Favorite One'
            );
            await toggleFavoriteForChannel(
                app.mainWindow,
                'M3U Clear Favorite Two'
            );
            await openPlaylistFavorites(app.mainWindow);

            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Clear Favorite One')
            ).toHaveCount(1);
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Clear Favorite Two')
            ).toHaveCount(1);

            await clearCurrentUnifiedCollection(app.mainWindow);

            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Clear Favorite One')
            ).toHaveCount(0);
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Clear Favorite Two')
            ).toHaveCount(0);

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, playlistSourceTitle)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);

            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Clear Favorite One')
            ).toHaveCount(0);
            await expect(
                channelItemByTitle(app.mainWindow, 'M3U Clear Favorite Two')
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@persistence @xtream @electron shows Xtream live, movie, and series favorites in playlist and all-playlists scope, and preserves them after restart', async ({
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

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
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

            await app.mainWindow
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            const seriesTitle = await clickFirstGridListCard(app.mainWindow);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);
            await expect(
                channelItemByTitle(app.mainWindow, liveTitle)
            ).toHaveCount(1);

            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);

            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await switchUnifiedCollectionContent(app.mainWindow, 'Live TV');
            await expect(
                channelItemByTitle(app.mainWindow, liveTitle)
            ).toHaveCount(1);
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
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
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

    test('@critical @persistence @xtream @electron keeps durable favorites through partial refresh, repeated refresh, restart and catalog recovery', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(150_000);
        await resetMockServers(request, ['xtream']);
        const credentials = { username: 'minimal', password: 'minimal' };
        const fixture = await fetchXtreamVodFixture(request, credentials);
        const proxy = await createFavoritesCatalogProxy();
        const portalTitle = 'Durable Partial Favorites';
        let app: LaunchedElectronApp | undefined;
        try {
            app = await launchElectronApp(dataDir);
            await addXtreamPortal(app.mainWindow, {
                ...credentials,
                name: portalTitle,
                serverUrl: proxy.origin,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            const { playlistId, titles } = await saveTwoMovieFavorites(
                app.mainWindow,
                fixture
            );
            const original = savedFavoriteIdentity(
                await readSavedFavorites(app.mainWindow, playlistId)
            );
            const missing = original.find((row) => row.title === titles[0]);
            if (!missing) throw new Error('The newly saved movie is missing');
            expect(missing.favoriteId).toBeGreaterThan(0);
            proxy.setMode({ kind: 'omit', xtreamId: missing.xtreamId });

            // Both real refresh entry points must retain the same durable records.
            for (const entry of ['sources', 'header'] as const) {
                await refreshFavoriteCatalog(
                    app.mainWindow,
                    proxy,
                    playlistId,
                    portalTitle,
                    entry
                );
                const saved = await readSavedFavorites(
                    app.mainWindow,
                    playlistId
                );
                expect(savedFavoriteIdentity(saved)).toEqual(original);
                expect(
                    saved.find((row) => row.favorite_id === missing.favoriteId)
                ).toMatchObject({
                    id: null,
                    title: titles[0],
                    catalog_status: 'missing',
                });
                expect(
                    saved.find((row) => row.favorite_id !== missing.favoriteId)
                ).toMatchObject({
                    id: expect.any(Number),
                    catalog_status: 'present',
                });
                await expectSavedMovieCards(app.mainWindow, titles);
                const card = contentCardByTitle(app.mainWindow, titles[0]);
                await expect(card).toContainText('Not in the current catalog');
                const activation = card.locator('.content-card__activation');
                await expect(activation).toHaveAttribute(
                    'aria-disabled',
                    'true'
                );
                const detailRequests = proxy.responseCount('get_vod_info');
                await activation.focus();
                await app.mainWindow.keyboard.press('Enter');
                await expect(
                    app.mainWindow.locator('app-content-hero')
                ).toHaveCount(0);
                expect(proxy.responseCount('get_vod_info')).toBe(
                    detailRequests
                );
                await switchUnifiedCollectionScope(
                    app.mainWindow,
                    'All playlists'
                );
                await expect(
                    contentCardByTitle(app.mainWindow, titles[0])
                ).toContainText('Not in the current catalog');
            }

            // The provider still omits the movie while a new Electron process opens.
            app = await restartElectronApp(app, dataDir);
            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalTitle).first().click();
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await expectSavedMovieCards(app.mainWindow, titles);
            expect(
                savedFavoriteIdentity(
                    await readSavedFavorites(app.mainWindow, playlistId)
                )
            ).toEqual(original);
            await expect(
                contentCardByTitle(app.mainWindow, titles[0])
            ).toContainText('Not in the current catalog');

            proxy.setMode({ kind: 'normal' });
            await refreshFavoriteCatalog(
                app.mainWindow,
                proxy,
                playlistId,
                portalTitle,
                'sources'
            );
            const recovered = await readSavedFavorites(
                app.mainWindow,
                playlistId
            );
            expect(savedFavoriteIdentity(recovered)).toEqual(original);
            expect(recovered).toHaveLength(2);
            expect(
                recovered.every(
                    (row) => row.id != null && row.catalog_status === 'present'
                )
            ).toBe(true);
            await expectSavedMovieCards(app.mainWindow, titles);
            const recoveredCard = contentCardByTitle(app.mainWindow, titles[0]);
            await expect(
                recoveredCard.locator('.content-card__activation')
            ).not.toHaveAttribute('aria-disabled', 'true');
            await recoveredCard.click();
            await expect(
                app.mainWindow.locator('app-content-hero')
            ).toContainText(titles[0]);
            await expect(
                app.mainWindow
                    .getByRole('button', { name: /remove from favorites/i })
                    .first()
            ).toBeVisible();
        } finally {
            try {
                if (app) await closeElectronApp(app);
            } finally {
                await proxy.close();
            }
        }
    });

    test('@persistence @xtream @electron distinguishes an empty catalog from HTTP failure and keeps explicit favorite removal after recovery', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const credentials = { username: 'minimal', password: 'minimal' };
        const fixture = await fetchXtreamVodFixture(request, credentials);
        const proxy = await createFavoritesCatalogProxy();
        const portalTitle = 'Durable Empty Favorites';
        let app: LaunchedElectronApp | undefined;
        try {
            app = await launchElectronApp(dataDir);
            await addXtreamPortal(app.mainWindow, {
                ...credentials,
                name: portalTitle,
                serverUrl: proxy.origin,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            const { playlistId, titles } = await saveTwoMovieFavorites(
                app.mainWindow,
                fixture
            );
            const original = savedFavoriteIdentity(
                await readSavedFavorites(app.mainWindow, playlistId)
            );

            for (const kind of ['empty', 'failure'] as const) {
                proxy.setMode({ kind });
                await refreshFavoriteCatalog(
                    app.mainWindow,
                    proxy,
                    playlistId,
                    portalTitle,
                    'sources',
                    kind === 'empty' ? 'completed' : 'failed'
                );
                const saved = await readSavedFavorites(
                    app.mainWindow,
                    playlistId
                );
                expect(savedFavoriteIdentity(saved)).toEqual(original);
                expect(
                    saved.every(
                        (row) =>
                            row.id === null &&
                            row.catalog_status ===
                                (kind === 'empty' ? 'missing' : 'unknown')
                    )
                ).toBe(true);
                await expectSavedMovieCards(app.mainWindow, titles);
                for (const title of titles) {
                    await expect(
                        contentCardByTitle(app.mainWindow, title)
                    ).toContainText(
                        kind === 'empty'
                            ? 'Not in the current catalog'
                            : 'Catalog status unknown'
                    );
                }
            }

            const removedCard = contentCardByTitle(app.mainWindow, titles[0]);
            await removedCard
                .getByRole('button', { name: /remove from favorites/i })
                .click();
            await expect(removedCard).toHaveCount(0);
            const retained = original.filter((row) => row.title !== titles[0]);
            expect(
                savedFavoriteIdentity(
                    await readSavedFavorites(app.mainWindow, playlistId)
                )
            ).toEqual(retained);

            proxy.setMode({ kind: 'normal' });
            // Replaying a stale refresh snapshot must never resurrect an explicit removal.
            for (let refresh = 0; refresh < 2; refresh++) {
                await refreshFavoriteCatalog(
                    app.mainWindow,
                    proxy,
                    playlistId,
                    portalTitle,
                    'sources'
                );
                const saved = await readSavedFavorites(
                    app.mainWindow,
                    playlistId
                );
                expect(savedFavoriteIdentity(saved)).toEqual(retained);
                expect(saved[0]).toMatchObject({
                    id: expect.any(Number),
                    catalog_status: 'present',
                });
                await expectSavedMovieCards(app.mainWindow, [titles[1]]);
                await expect(
                    contentCardByTitle(app.mainWindow, titles[0])
                ).toHaveCount(0);
                await switchUnifiedCollectionScope(
                    app.mainWindow,
                    'All playlists'
                );
                await expect(
                    contentCardByTitle(app.mainWindow, titles[0])
                ).toHaveCount(0);
                await expectVisibleContentCardTitle(app.mainWindow, titles[1]);
            }
        } finally {
            try {
                if (app) await closeElectronApp(app);
            } finally {
                await proxy.close();
            }
        }
    });

    test('opens Xtream favorite movies and series inline from favorites without switching the playlist or showing the sidebar', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(
            request,
            xtreamCredentials
        );
        const seriesFixture = await fetchXtreamSeriesFixture(
            request,
            xtreamCredentials
        );
        const hostPortalTitle = 'Xtream Favorite Detail Host';
        const sourcePortalTitle = 'Xtream Favorite Detail Source';
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: hostPortalTitle,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await addXtreamPortal(app.mainWindow, {
                name: sourcePortalTitle,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            const sourcePath = new URL(app.mainWindow.url()).pathname;
            const sourceId = decodeURIComponent(
                sourcePath.split('/xtreams/')[1].split('/')[0]
            );

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            const movieTitle = await clickFirstGridListCard(app.mainWindow);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryByNameExact(
                app.mainWindow,
                seriesFixture.categoryName
            );
            const seriesTitle = await clickFirstGridListCard(app.mainWindow);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, hostPortalTitle)
                .first()
                .click();
            await waitForXtreamWorkspaceReady(app.mainWindow);

            // The dashboard includes Source favorites while Host stays active.
            // A handoff must load all rows before checking saved availability.
            for (const title of [movieTitle, seriesTitle]) {
                await goToDashboard(app.mainWindow);
                await app.mainWindow
                    .getByTestId('dashboard-favorite-vod-rail-card')
                    .filter({ hasText: title })
                    .first()
                    .click();
                await expectInlineCollectionDetail(app.mainWindow, {
                    pathname: /\/workspace\/global-favorites$/,
                    title,
                    playlistTitle: hostPortalTitle,
                });
            }
            await goToDashboard(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);
            await expect(playlistSwitcherTitle(app.mainWindow)).toContainText(
                hostPortalTitle
            );

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);
            await contentCardByTitle(app.mainWindow, movieTitle)
                .first()
                .click();
            await expectInlineCollectionDetail(app.mainWindow, {
                pathname: /\/workspace\/global-favorites$/,
                title: movieTitle,
                playlistTitle: hostPortalTitle,
            });

            await goBackFromDetail(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);

            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);
            await contentCardByTitle(app.mainWindow, seriesTitle)
                .first()
                .click();
            await expectInlineCollectionDetail(app.mainWindow, {
                pathname: /\/workspace\/global-favorites$/,
                title: seriesTitle,
                playlistTitle: hostPortalTitle,
            });

            await goBackFromDetail(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);
            // Missing favorites must remain visible even while Host is active.
            await app.mainWindow.evaluate(async (playlistId) => {
                for (const type of ['movie', 'series'] as const) {
                    await window.electron.dbClearXtreamImportCache(
                        playlistId,
                        type
                    );
                    await window.electron.dbSetAppState(
                        `xtream-import-status:${playlistId}:${type}`,
                        'completed'
                    );
                }
            }, sourceId);
            for (const title of [movieTitle, seriesTitle]) {
                await goToDashboard(app.mainWindow);
                await app.mainWindow
                    .getByTestId('dashboard-favorite-vod-rail-card')
                    .filter({ hasText: title })
                    .first()
                    .click();
                await expectPathname(
                    app.mainWindow,
                    /\/workspace\/global-favorites$/
                );
                await expectVisibleContentCardTitle(app.mainWindow, title);
                await expect(
                    app.mainWindow.locator('app-content-hero')
                ).toHaveCount(0);
                await expect(
                    playlistSwitcherTitle(app.mainWindow)
                ).toContainText(hostPortalTitle);
                await expect(
                    contentCardByTitle(app.mainWindow, title).first()
                ).toContainText('Not in the current catalog');
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@persistence @stalker @electron shows Stalker live, movie, and series favorites in playlist and all-playlists scope, and preserves them after restart', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const liveFixture = await fetchStalkerCategoryFixture(request, 'itv');
        const vodFixture = await fetchStalkerCategoryFixture(request, 'vod');
        const seriesFixture = await fetchStalkerCategoryFixture(
            request,
            'series'
        );
        const [liveTitle] = pickDistinctTitles(
            liveFixture.items,
            getStalkerTitle
        );
        const [movieTitle] = pickDistinctTitles(
            vodFixture.items,
            getStalkerTitle
        );
        const [seriesTitle] = pickDistinctTitles(
            seriesFixture.items,
            getStalkerTitle
        );
        const portalTitle = 'Stalker Favorites Source';
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                name: portalTitle,
            });
            await waitForStalkerCatalog(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await clickCategoryById(app.mainWindow, liveFixture.categoryId);
            await toggleFavoriteForChannel(app.mainWindow, liveTitle);

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryById(app.mainWindow, vodFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryById(app.mainWindow, seriesFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, seriesTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);
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

            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
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

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalTitle).first().click();
            await waitForStalkerCatalog(app.mainWindow);
            await openPlaylistFavorites(app.mainWindow);
            await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
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

    test('opens Stalker favorite movies and series inline from favorites without showing the sidebar', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const vodFixture = await fetchStalkerCategoryFixture(request, 'vod');
        const seriesFixture = await fetchStalkerCategoryFixture(
            request,
            'series'
        );
        const [movieTitle] = pickDistinctTitles(
            vodFixture.items,
            getStalkerTitle
        );
        const [seriesTitle] = pickDistinctTitles(
            seriesFixture.items,
            getStalkerTitle
        );
        const portalTitle = 'Stalker Favorite Detail Source';
        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                name: portalTitle,
            });
            await waitForStalkerCatalog(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryById(app.mainWindow, vodFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, movieTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await app.mainWindow
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickCategoryById(app.mainWindow, seriesFixture.categoryId);
            await clickGridListCardByTitle(app.mainWindow, seriesTitle);
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);
            await expect(playlistSwitcherTitle(app.mainWindow)).toContainText(
                portalTitle
            );

            await switchUnifiedCollectionContent(app.mainWindow, 'Movies');
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);
            await contentCardByTitle(app.mainWindow, movieTitle)
                .first()
                .click();
            await expectInlineCollectionDetail(app.mainWindow, {
                pathname: /\/workspace\/global-favorites$/,
                title: movieTitle,
                playlistTitle: portalTitle,
            });
            await playCurrentDetail(app.mainWindow);
            await expectInlinePlayerWithoutDialog(app.mainWindow);

            await goBackFromDetail(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await expectVisibleContentCardTitle(app.mainWindow, movieTitle);

            await switchUnifiedCollectionContent(app.mainWindow, 'Series');
            await expectVisibleContentCardTitle(app.mainWindow, seriesTitle);
            await contentCardByTitle(app.mainWindow, seriesTitle)
                .first()
                .click();
            await expectInlineCollectionDetail(app.mainWindow, {
                pathname: /\/workspace\/global-favorites$/,
                title: seriesTitle,
                playlistTitle: portalTitle,
            });
            await playFirstSeriesEpisode(app.mainWindow);
            await expectInlinePlayerWithoutDialog(app.mainWindow);

            await goBackFromDetail(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
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

async function saveTwoMovieFavorites(
    page: Page,
    fixture: Awaited<ReturnType<typeof fetchXtreamVodFixture>>
): Promise<{ playlistId: string; titles: [string, string] }> {
    const playlistId = /\/xtreams\/([^/]+)/.exec(
        new URL(page.url()).pathname
    )?.[1];
    if (!playlistId)
        throw new Error('The imported Xtream route has no playlist ID');
    await page.getByRole('link', { name: 'Movies', exact: true }).click();
    await clickCategoryByNameExact(page, fixture.categoryName);
    const first = await clickFirstGridListCard(page);
    await addCurrentDetailToFavorites(page);
    await goBackFromDetail(page);
    const second = fixture.items
        .map(getXtreamTitle)
        .find((title) => title && title !== first);
    if (!second) throw new Error('The movie fixture needs two distinct titles');
    await clickGridListCardByTitle(page, second);
    await addCurrentDetailToFavorites(page);
    await goBackFromDetail(page);
    await expect
        .poll(async () => (await readSavedFavorites(page, playlistId)).length)
        .toBe(2);
    return { playlistId, titles: [first, second] };
}

async function expectSavedMovieCards(
    page: Page,
    titles: readonly string[]
): Promise<void> {
    await openPlaylistFavorites(page);
    for (const title of titles) {
        await expectVisibleContentCardTitle(page, title);
        await expect(contentCardByTitle(page, title)).toHaveCount(1);
    }
}

// By accessible name, not class: the Xtream movie detail's favorite control is
// an icon-only button that carries its label in aria-label, while series and
// Stalker details still use the labeled variant. This matches both.
async function addCurrentDetailToFavorites(page: Page): Promise<void> {
    const addButton = page
        .getByRole('button', { name: /add to favorites/i })
        .first();

    await expect(addButton).toBeVisible({ timeout: 20000 });
    await addButton.click();
    await expect(
        page.getByRole('button', { name: /remove from favorites/i }).first()
    ).toBeVisible({
        timeout: 20000,
    });
}

async function goBackFromDetail(page: Page): Promise<void> {
    // Return to the list: the header's Back is route-level in browse and
    // watch alike (closing the player is the bar's own Close button).
    const backButton = page.getByTestId('workspace-header-back');

    await expect(backButton).toBeVisible({ timeout: 20000 });
    try {
        await backButton.click({ timeout: 5000 });
    } catch {
        await backButton.evaluate((button: HTMLButtonElement) =>
            button.click()
        );
    }
}

async function expectInlineCollectionDetail(
    page: Page,
    params: {
        pathname: RegExp;
        title: string;
        playlistTitle: string;
    }
): Promise<void> {
    await expectPathname(page, params.pathname);
    await expect(playlistSwitcherTitle(page)).toContainText(
        params.playlistTitle
    );
    await expect(page.locator('app-workspace-context-panel')).toHaveCount(0);
    await expect(page.locator('app-content-hero')).toContainText(params.title);
    await expect(page.getByTestId('workspace-header-back')).toBeVisible({
        timeout: 20000,
    });
}

async function expectInlinePlayerWithoutDialog(page: Page): Promise<void> {
    await expect(
        page.locator('app-portal-inline-player app-web-player-view').first()
    ).toBeVisible({ timeout: 20000 });
    await expect(
        page.locator('mat-dialog-container app-web-player-view')
    ).toHaveCount(0);
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
    const item = channelItemByTitle(page, title).first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
    await expect(item.locator('.favorite-button mat-icon').first()).toHaveText(
        /star/
    );
}
