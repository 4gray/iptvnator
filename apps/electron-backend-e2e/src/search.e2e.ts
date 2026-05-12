import { APIRequestContext, Locator, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    defaultStalkerMacAddress,
    expect,
    expectWorkspaceSearchScope,
    expectWorkspaceSearchStatus,
    fillWorkspaceSearch,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    m3uFixturePath,
    openGlobalFavorites,
    resetMockServers,
    stalkerMockServer,
    test,
    waitForM3uCatalog,
    waitForPortalDebugEvent,
    waitForStalkerCatalog,
    waitForXtreamCatalog,
    xtreamMockServer,
} from './electron-test-fixtures';

type XtreamCategory = {
    category_id: string;
    category_name: string;
};

type XtreamVodStream = {
    category_id?: string;
    id?: number | string;
    name?: string;
    series_id?: number | string;
    stream_id?: number | string;
    title?: string;
    xtream_id?: number | string;
};

type StalkerCategory = {
    id: string;
    title: string;
};

type StalkerProxyPayload<T> = {
    payload: {
        js: T;
    };
};

type StalkerOrderedList<T> = {
    cur_page: number;
    data: T[];
    max_page_items: number;
    total_items: number;
    total_pages: number;
};

type StalkerContentItem = {
    id?: number | string;
    name?: string;
    o_name?: string;
};

type XtreamVodFixture = {
    candidateTitles: string[];
    categoryId: string;
    categoryName: string;
    controlTitle: string;
    itemId: string;
    targetTitle: string;
};

type StalkerCategoryFixture = {
    categoryId: string;
    categoryName: string;
    controlTitle: string;
    targetTitle: string;
};

type M3uFixtureItem = {
    groupTitle: string;
    name: string;
    url: string;
};

type M3uSearchFixture = {
    controlTitle: string;
    groupTitle: string;
    siblingTitle: string;
    targetTitle: string;
};

const headerSearchSelector =
    'app-workspace-shell-header .search-field input[type="search"]';
const xtreamSearchUsername = 'minimal';
const xtreamSearchPassword = 'minimal';

test.describe('Electron Workspace Search', () => {
    test('@search @m3u filters all channels from the workspace header on playlist routes', async ({
        dataDir,
    }) => {
        const sample = loadM3uSearchFixture();
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await waitForM3uCatalog(app.mainWindow);

            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/all$/
            );
            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(app.mainWindow, 'All channels');
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @m3u filters grouped channels by group and channel title from the workspace header', async ({
        dataDir,
    }) => {
        const sample = loadM3uSearchFixture();
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await waitForM3uCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Groups');

            await fillWorkspaceSearch(app.mainWindow, sample.groupTitle);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/groups$/
            );
            await expectQueryParam(app.mainWindow, 'q', sample.groupTitle);
            await expectWorkspaceSearchScope(app.mainWindow, 'Groups');
            await expect(
                groupPanelHeader(app.mainWindow, sample.groupTitle)
            ).toHaveCount(1);
            await expect(
                groupPanelHeader(app.mainWindow, sample.groupTitle).first()
            ).toContainText(sample.groupTitle);
            await expect(
                groupPanelHeader(app.mainWindow, sample.groupTitle).first()
            ).toContainText('2');
            await ensureGroupSelected(app.mainWindow, sample.groupTitle);
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.siblingTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);

            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expect(
                groupPanelHeader(app.mainWindow, sample.groupTitle).first()
            ).toContainText(sample.groupTitle);
            await expect(
                groupPanelHeader(app.mainWindow, sample.groupTitle).first()
            ).toContainText('1');
            await ensureGroupSelected(app.mainWindow, sample.groupTitle);
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.siblingTitle)
            ).toHaveCount(0);
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @m3u filters playlist favorites from the workspace header', async ({
        dataDir,
    }) => {
        const sample = loadM3uSearchFixture();
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await waitForM3uCatalog(app.mainWindow);
            await toggleFavoriteForChannel(app.mainWindow, sample.targetTitle);
            await toggleFavoriteForChannel(app.mainWindow, sample.controlTitle);
            await openWorkspaceSection(app.mainWindow, 'Favorites');

            await fillWorkspaceSearch(app.mainWindow, sample.groupTitle);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await expectQueryParam(app.mainWindow, 'q', sample.groupTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                'Global favorites'
            );
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @m3u filters global favorites from the workspace rail without leaving the persisted query model', async ({
        dataDir,
    }) => {
        const sample = loadM3uSearchFixture();
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await waitForM3uCatalog(app.mainWindow);
            await toggleFavoriteForChannel(app.mainWindow, sample.targetTitle);
            await toggleFavoriteForChannel(app.mainWindow, sample.controlTitle);
            await openGlobalFavorites(app.mainWindow);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                'Global favorites'
            );
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream filters VOD content from the workspace header on a category route', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const sample = await fetchXtreamVodFixture(request);
        const xtreamQueries = buildXtreamSearchQueries(
            sample.targetTitle,
            sample.controlTitle
        );

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Movies');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod$/
            );

            await clickCategoryByNameExact(app.mainWindow, sample.categoryName);
            await expect(
                app.mainWindow
                    .locator('.category-content-layout mat-card')
                    .first()
            ).toBeVisible({
                timeout: 20000,
            });
            const resolvedTitles = await resolveVisibleXtreamTitles(
                app.mainWindow,
                sample
            );
            await fillWorkspaceSearch(
                app.mainWindow,
                resolvedTitles.targetTitle
            );

            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+$/
            );
            await expectQueryParam(
                app.mainWindow,
                'q',
                resolvedTitles.targetTitle
            );
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Movies / ${sample.categoryName}`
            );
            const contentLayout = app.mainWindow.locator(
                '.category-content-layout'
            );
            await expect(contentLayout).toContainText(
                flexibleTextPattern(resolvedTitles.targetTitle)
            );
            await expect(contentLayout).not.toContainText(
                flexibleTextPattern(resolvedTitles.controlTitle)
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream filters series content from the workspace header on a category route', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const sample = await fetchXtreamSeriesFixture(request);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Series');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/series$/
            );

            await clickCategoryByNameExact(app.mainWindow, sample.categoryName);
            try {
                await expect(
                    app.mainWindow
                        .locator('.category-content-layout mat-card')
                        .first()
                ).toBeVisible({
                    timeout: 5000,
                });
            } catch {
                await openWorkspaceSection(app.mainWindow, 'Series');
                await expectPathname(
                    app.mainWindow,
                    /\/workspace\/xtreams\/[^/]+\/series$/
                );
                await clickCategoryByNameExact(
                    app.mainWindow,
                    sample.categoryName
                );
                await expect(
                    app.mainWindow
                        .locator('.category-content-layout mat-card')
                        .first()
                ).toBeVisible({
                    timeout: 20000,
                });
            }
            const resolvedTitles = await resolveVisibleXtreamTitles(
                app.mainWindow,
                sample
            );
            await fillWorkspaceSearch(
                app.mainWindow,
                resolvedTitles.targetTitle
            );

            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/series(?:\/[^/]+)?$/
            );
            await expectQueryParam(
                app.mainWindow,
                'q',
                resolvedTitles.targetTitle
            );
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Series / ${sample.categoryName}`
            );
            const contentLayout = app.mainWindow.locator(
                '.category-content-layout'
            );
            await expect(contentLayout).toContainText(
                flexibleTextPattern(resolvedTitles.targetTitle)
            );
            await expect(contentLayout).not.toContainText(
                flexibleTextPattern(resolvedTitles.controlTitle)
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream filters VOD and series root views across categories', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodSample = await fetchXtreamVodFixture(request);
        const seriesSample = await fetchXtreamSeriesFixture(request);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await expectXtreamRootCatalogSearch(app.mainWindow, {
                pathPattern: /\/workspace\/xtreams\/[^/]+\/vod$/,
                sample: vodSample,
                sectionLabel: 'Movies',
            });
            await expect(
                app.mainWindow.locator(headerSearchSelector)
            ).toHaveValue(vodSample.targetTitle);

            await fillWorkspaceSearch(app.mainWindow, '');
            await openWorkspaceSection(app.mainWindow, 'Series');

            await expectXtreamRootCatalogSearch(app.mainWindow, {
                pathPattern: /\/workspace\/xtreams\/[^/]+\/series$/,
                sample: seriesSample,
                sectionLabel: 'Series',
            });
            await expect(
                app.mainWindow.locator(headerSearchSelector)
            ).toHaveValue(seriesSample.targetTitle);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream filters live root and category scopes while preserving playback sidebar', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const sample = await fetchXtreamLiveFixture(request);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/live$/
            );

            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/live$/
            );
            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                'Live TV / All Items'
            );
            await expect(
                liveChannelSidebar(app.mainWindow)
                    .locator('[data-test-id="channel-item"]')
                    .first()
            ).toBeVisible({ timeout: 20000 });
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible({ timeout: 20000 });
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);

            await channelItemByTitle(app.mainWindow, sample.targetTitle)
                .first()
                .click();

            await expect(
                app.mainWindow.locator(
                    'app-live-stream-layout .content-container .video-player'
                )
            ).toBeVisible({ timeout: 20000 });
            await expect(
                liveChannelSidebar(app.mainWindow)
                    .locator('[data-test-id="channel-item"]')
                    .first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toHaveClass(/(^|\s)active(\s|$)/);

            await fillWorkspaceSearch(app.mainWindow, '');
            await expectQueryParamAbsent(app.mainWindow, 'q');
            await clickCategoryByNameExact(app.mainWindow, sample.categoryName);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Live TV / ${sample.categoryName}`
            );
            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/live(?:\/[^/]+)?$/
            );
            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Live TV / ${sample.categoryName}`
            );
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible({ timeout: 20000 });
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream promotes dashboard header search into advanced playlist search', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const sample = await fetchXtreamVodFixture(request);
        const xtreamQueries = buildXtreamSearchQueries(
            sample.targetTitle,
            sample.controlTitle
        );

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await goToDashboard(app.mainWindow);
            const xtreamQuery = await performXtreamPlaylistSearch(
                app.mainWindow,
                xtreamQueries
            );
            await expectWorkspaceSearchScope(app.mainWindow, 'Advanced search');
            await expect(
                app.mainWindow.locator('app-search-layout app-search-form')
            ).toHaveCount(0);
            await expect(
                xtreamSearchResultCards(app.mainWindow).first()
            ).toBeVisible({ timeout: 20000 });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream restores the search term and results after returning from a result detail route', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const sample = await fetchXtreamVodFixture(request);
        const xtreamQueries = buildXtreamSearchQueries(
            sample.targetTitle,
            sample.controlTitle
        );

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await goToDashboard(app.mainWindow);
            const xtreamQuery = await performXtreamPlaylistSearch(
                app.mainWindow,
                xtreamQueries
            );

            const resultCard = xtreamSearchResultCards(app.mainWindow).first();
            await expect(resultCard).toBeVisible({ timeout: 20000 });
            await resultCard.click();

            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/(?:vod|live|series)\/[^/]+\/[^/]+$/
            );

            await app.mainWindow.goBack();

            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/search$/
            );
            await expectQueryParam(app.mainWindow, 'q', xtreamQuery);
            await expect(
                app.mainWindow.locator(headerSearchSelector)
            ).toHaveValue(xtreamQuery);
            await expect(
                xtreamSearchResultCards(app.mainWindow).first()
            ).toBeVisible({ timeout: 20000 });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @xtream filters playlist favorites from the workspace header', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const sample = await fetchXtreamVodFixture(request);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                password: xtreamSearchPassword,
                username: xtreamSearchUsername,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Movies');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod$/
            );

            await clickCategoryByNameExact(app.mainWindow, sample.categoryName);
            await expect(
                app.mainWindow
                    .locator('.category-content-layout mat-card')
                    .first()
            ).toBeVisible({ timeout: 20000 });
            const resolvedTitles = await resolveVisibleXtreamTitles(
                app.mainWindow,
                sample
            );
            await clickGridListCardByTitle(
                app.mainWindow,
                resolvedTitles.targetTitle
            );
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+$/
            );

            await clickGridListCardByTitle(
                app.mainWindow,
                resolvedTitles.controlTitle
            );
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );
            await addCurrentDetailToFavorites(app.mainWindow);
            await goBackFromDetail(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+$/
            );

            await openWorkspaceSection(app.mainWindow, 'Favorites');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await expect(
                contentCardByTitle(
                    app.mainWindow,
                    resolvedTitles.targetTitle
                ).first()
            ).toBeVisible({ timeout: 20000 });
            await expect(
                contentCardByTitle(
                    app.mainWindow,
                    resolvedTitles.controlTitle
                ).first()
            ).toBeVisible({ timeout: 20000 });

            await fillWorkspaceSearch(
                app.mainWindow,
                resolvedTitles.targetTitle
            );

            await expectQueryParam(
                app.mainWindow,
                'q',
                resolvedTitles.targetTitle
            );
            await expectWorkspaceSearchScope(
                app.mainWindow,
                'Global favorites'
            );
            await expect(
                contentCardByTitle(
                    app.mainWindow,
                    resolvedTitles.targetTitle
                ).first()
            ).toBeVisible();
            await expect(
                contentCardByTitle(app.mainWindow, resolvedTitles.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @stalker sends category search through Electron IPC on the VOD route', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const sample = await fetchStalkerCategoryFixture(request, 'vod');

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);
            await clickCategoryById(app.mainWindow, sample.categoryId);
            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectPathname(
                app.mainWindow,
                new RegExp(
                    `/workspace/stalker/[^/]+/vod/${escapeRegex(
                        sample.categoryId
                    )}$`
                )
            );
            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Movies / ${sample.categoryName}`
            );
            await waitForPortalDebugEvent(app.mainWindow, {
                provider: 'stalker',
                operation: 'get_ordered_list',
                predicate: (event) => {
                    const requestPayload = event.request as {
                        params?: Record<string, string | number>;
                    };

                    return (
                        requestPayload.params?.['type'] === 'vod' &&
                        String(requestPayload.params?.['category']) ===
                            sample.categoryId &&
                        requestPayload.params?.['search'] === sample.targetTitle
                    );
                },
            });
            const contentLayout = app.mainWindow.locator(
                '.category-content-layout'
            );
            await expect(contentLayout).toContainText(
                flexibleTextPattern(sample.targetTitle)
            );
            await expect(contentLayout).not.toContainText(
                flexibleTextPattern(sample.controlTitle)
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @stalker sends category search through Electron IPC on the series route', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const sample = await fetchStalkerCategoryFixture(request, 'series');

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Series');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/series$/
            );
            await clickCategoryById(app.mainWindow, sample.categoryId);
            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectPathname(
                app.mainWindow,
                new RegExp(
                    `/workspace/stalker/[^/]+/series/${escapeRegex(
                        sample.categoryId
                    )}$`
                )
            );
            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Series / ${sample.categoryName}`
            );
            await waitForPortalDebugEvent(app.mainWindow, {
                provider: 'stalker',
                operation: 'get_ordered_list',
                predicate: (event) => {
                    const requestPayload = event.request as {
                        params?: Record<string, string | number>;
                    };

                    return (
                        requestPayload.params?.['type'] === 'series' &&
                        String(requestPayload.params?.['category']) ===
                            sample.categoryId &&
                        requestPayload.params?.['search'] === sample.targetTitle
                    );
                },
            });
            const contentLayout = app.mainWindow.locator(
                '.category-content-layout'
            );
            await expect(contentLayout).toContainText(
                flexibleTextPattern(sample.targetTitle)
            );
            await expect(contentLayout).not.toContainText(
                flexibleTextPattern(sample.controlTitle)
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @stalker drives advanced search from the workspace header without an inline form', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const sample = await fetchStalkerCategoryFixture(request, 'vod');

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Advanced search');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/search$/
            );
            await expectWorkspaceSearchScope(app.mainWindow, 'Advanced search');
            await expect(
                app.mainWindow.locator('app-search-layout app-search-form')
            ).toHaveCount(0);

            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await waitForPortalDebugEvent(app.mainWindow, {
                provider: 'stalker',
                operation: 'get_ordered_list',
                predicate: (event) => {
                    const requestPayload = event.request as {
                        params?: Record<string, string | number>;
                    };

                    return (
                        requestPayload.params?.['type'] === 'vod' &&
                        requestPayload.params?.['search'] === sample.targetTitle
                    );
                },
            });
            await expect(
                contentCardByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible({ timeout: 20000 });
            await contentCardByTitle(app.mainWindow, sample.targetTitle)
                .first()
                .click();
            await expect(
                app.mainWindow.locator('app-content-hero')
            ).toContainText(flexibleTextPattern(sample.targetTitle), {
                timeout: 20000,
            });
            await playCurrentDetail(app.mainWindow);
            await expectInlinePlayerWithoutDialog(app.mainWindow);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @stalker filters playlist favorites from the workspace header', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const sample = await fetchStalkerCategoryFixture(request, 'itv');

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);
            await app.mainWindow
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/itv$/
            );
            await clickCategoryById(app.mainWindow, sample.categoryId);
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible({ timeout: 20000 });
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle).first()
            ).toBeVisible({ timeout: 20000 });
            await toggleFavoriteForChannel(app.mainWindow, sample.targetTitle);
            await toggleFavoriteForChannel(app.mainWindow, sample.controlTitle);

            await openWorkspaceSection(app.mainWindow, 'Favorites');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/global-favorites$/
            );
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible({ timeout: 20000 });
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle).first()
            ).toBeVisible({ timeout: 20000 });

            await fillWorkspaceSearch(app.mainWindow, sample.targetTitle);

            await expectQueryParam(app.mainWindow, 'q', sample.targetTitle);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                'Global favorites'
            );
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@search @stalker shows loaded-only scope and filters channels on ITV routes', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);
        const sample = await fetchStalkerCategoryFixture(request, 'itv');
        const itvQuery = createUniquePrefix(
            sample.targetTitle,
            sample.controlTitle
        );

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow);
            await waitForStalkerCatalog(app.mainWindow);
            await app.mainWindow
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/itv$/
            );

            await clickCategoryById(app.mainWindow, sample.categoryId);
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle).first()
            ).toBeVisible();

            await fillWorkspaceSearch(app.mainWindow, itvQuery);

            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/itv$/
            );
            await expectQueryParam(app.mainWindow, 'q', itvQuery);
            await expectWorkspaceSearchScope(
                app.mainWindow,
                `Live TV / ${sample.categoryName}`
            );
            await expectWorkspaceSearchStatus(
                app.mainWindow,
                'Loaded channels only'
            );
            await waitForPortalDebugEvent(app.mainWindow, {
                provider: 'stalker',
                operation: 'get_ordered_list',
                predicate: (event) => {
                    const requestPayload = event.request as {
                        params?: Record<string, string | number>;
                    };

                    return (
                        requestPayload.params?.['type'] === 'itv' &&
                        String(requestPayload.params?.['category']) ===
                            sample.categoryId &&
                        requestPayload.params?.['search'] === itvQuery
                    );
                },
            });
            await expect(
                channelItemByTitle(app.mainWindow, sample.targetTitle).first()
            ).toBeVisible();
            await expect(
                channelItemByTitle(app.mainWindow, sample.controlTitle)
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function fetchXtreamVodFixture(
    request: APIRequestContext
): Promise<XtreamVodFixture> {
    return fetchXtreamFixture(request, {
        categoriesAction: 'get_vod_categories',
        itemsAction: 'get_vod_streams',
    });
}

async function fetchXtreamLiveFixture(
    request: APIRequestContext
): Promise<XtreamVodFixture> {
    return fetchXtreamFixture(request, {
        categoriesAction: 'get_live_categories',
        itemsAction: 'get_live_streams',
    });
}

async function fetchXtreamSeriesFixture(
    request: APIRequestContext
): Promise<XtreamVodFixture> {
    return fetchXtreamFixture(request, {
        categoriesAction: 'get_series_categories',
        itemsAction: 'get_series',
    });
}

async function fetchXtreamFixture(
    request: APIRequestContext,
    options: {
        categoriesAction: string;
        itemsAction: string;
    }
): Promise<XtreamVodFixture> {
    const { categoriesAction, itemsAction } = options;
    const categories = await fetchJson<XtreamCategory[]>(
        request,
        `${xtreamMockServer}/player_api.php?action=${encodeURIComponent(
            categoriesAction
        )}&username=${encodeURIComponent(
            xtreamSearchUsername
        )}&password=${encodeURIComponent(xtreamSearchPassword)}`
    );
    if (categories.length === 0) {
        throw new Error(
            `Xtream mock server returned no categories for ${categoriesAction}.`
        );
    }
    let fallbackFixture: XtreamVodFixture | null = null;

    for (const category of categories) {
        const items = await fetchJson<XtreamVodStream[]>(
            request,
            `${xtreamMockServer}/player_api.php?action=${encodeURIComponent(
                itemsAction
            )}&username=${encodeURIComponent(
                xtreamSearchUsername
            )}&password=${encodeURIComponent(
                xtreamSearchPassword
            )}&category_id=${encodeURIComponent(category.category_id)}`
        );
        const fixture = buildXtreamVodFixture(category, items);

        if (!fixture) {
            continue;
        }

        if (!fallbackFixture) {
            fallbackFixture = fixture;
        }

        if (isStableXtreamSearchTitle(fixture.targetTitle)) {
            return fixture;
        }
    }

    if (fallbackFixture) {
        return fallbackFixture;
    }

    throw new Error(
        `Xtream mock server returned no usable fixture for ${itemsAction}.`
    );
}

function buildXtreamVodFixture(
    category: XtreamCategory,
    items: XtreamVodStream[]
): XtreamVodFixture | null {
    try {
        const distinctItems = items.filter((item, index, allItems) => {
            const title = getXtreamTitle(item);
            if (!title) {
                return false;
            }

            return (
                allItems.findIndex(
                    (candidate) =>
                        normalizeSearchText(getXtreamTitle(candidate)) ===
                        normalizeSearchText(title)
                ) === index
            );
        });
        const [targetItem, controlItem] = pickDistinctItems(
            distinctItems,
            getXtreamTitle,
            isStableXtreamSearchTitle
        );
        const itemId = getXtreamItemId(targetItem);

        if (!itemId) {
            return null;
        }

        return {
            candidateTitles: distinctItems.map((item) => getXtreamTitle(item)),
            categoryId: String(category.category_id),
            categoryName: category.category_name,
            controlTitle: getXtreamTitle(controlItem),
            itemId,
            targetTitle: getXtreamTitle(targetItem),
        };
    } catch {
        return null;
    }
}

async function fetchStalkerCategoryFixture(
    request: APIRequestContext,
    type: 'itv' | 'series' | 'vod'
): Promise<StalkerCategoryFixture> {
    const categoriesResponse = await fetchJson<
        StalkerProxyPayload<StalkerCategory[]>
    >(
        request,
        buildStalkerProxyUrl('get_categories', {
            type,
        })
    );
    const category = categoriesResponse.payload.js[0];

    if (!category) {
        throw new Error(`Stalker mock server returned no ${type} categories.`);
    }

    const itemsResponse = await fetchJson<
        StalkerProxyPayload<StalkerOrderedList<StalkerContentItem>>
    >(
        request,
        buildStalkerProxyUrl('get_ordered_list', {
            category: category.id,
            p: '1',
            type,
        })
    );
    const items = itemsResponse.payload.js.data ?? [];
    const [targetItem, controlItem] = pickDistinctItems(items, getStalkerTitle);

    return {
        categoryId: String(category.id),
        categoryName: category.title,
        controlTitle: getStalkerTitle(controlItem),
        targetTitle: getStalkerTitle(targetItem),
    };
}

async function fetchJson<T>(
    request: APIRequestContext,
    url: string
): Promise<T> {
    const response = await request.get(url);

    expect(response.ok()).toBeTruthy();

    return (await response.json()) as T;
}

function buildStalkerProxyUrl(
    action: string,
    params: Record<string, string>
): string {
    const searchParams = new URLSearchParams({
        action,
        macAddress: defaultStalkerMacAddress,
        url: `${stalkerMockServer}/portal.php`,
        ...params,
    });

    return `${stalkerMockServer}/stalker?${searchParams.toString()}`;
}

function loadM3uSearchFixture(): M3uSearchFixture {
    const items = parseM3uFixture(m3uFixturePath);
    const groups = items.reduce<Map<string, M3uFixtureItem[]>>((acc, item) => {
        const existing = acc.get(item.groupTitle) ?? [];
        existing.push(item);
        acc.set(item.groupTitle, existing);
        return acc;
    }, new Map<string, M3uFixtureItem[]>());

    const groupedSample = [...groups.entries()].find(
        ([groupTitle, channels]) =>
            groupTitle.length > 0 && channels.length >= 2
    );

    if (!groupedSample) {
        throw new Error(
            'Expected the M3U fixture to contain at least one group with two channels.'
        );
    }

    const [groupTitle, groupedChannels] = groupedSample;
    const [sibling, target] = groupedChannels;
    const control = items.find((item) => item.groupTitle !== groupTitle);

    if (!target || !sibling || !control) {
        throw new Error(
            'Expected the M3U fixture to contain both grouped and cross-group channels.'
        );
    }

    return {
        controlTitle: control.name,
        groupTitle,
        siblingTitle: sibling.name,
        targetTitle: target.name,
    };
}

function parseM3uFixture(filePath: string): M3uFixtureItem[] {
    const content = readFileSync(filePath, 'utf8');
    const items: M3uFixtureItem[] = [];
    const lines = content.split(/\r?\n/);
    let pending:
        | {
              groupTitle: string;
              name: string;
          }
        | undefined;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            const groupTitle =
                line.match(/group-title="([^"]*)"/)?.[1]?.trim() ?? '';
            const name = line.split(',').at(-1)?.trim() ?? '';

            pending = {
                groupTitle,
                name,
            };
            continue;
        }

        if (!pending || line.startsWith('#')) {
            continue;
        }

        items.push({
            ...pending,
            url: line,
        });
        pending = undefined;
    }

    return items.filter((item) => item.name.length > 0);
}

async function clickCategoryById(
    page: Page,
    categoryId: string
): Promise<void> {
    const category = page.locator(
        `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]:visible`
    );

    await expect(category.first()).toBeVisible();
    await category.first().click();
    await expect
        .poll(async () => {
            const pathname = new URL(page.url()).pathname;
            const isSelected =
                (await category.first().getAttribute('aria-current')) ===
                'true';

            return (
                isSelected ||
                pathname.endsWith(`/${categoryId}`) ||
                pathname.includes(`/${categoryId}/`)
            );
        })
        .toBe(true);
}

async function clickCategoryByNameExact(
    page: Page,
    categoryName: string
): Promise<void> {
    const categories = page
        .locator('app-workspace-context-panel .category-item:visible')
        .filter({
            has: page.locator('.nav-item-label', {
                hasText: new RegExp(`^\\s*${escapeRegex(categoryName)}\\s*$`),
            }),
        });
    const category = await pickPreferredCategory(categories);

    await expect(category).toBeVisible();
    await expect(category).toBeEnabled();
    await category.scrollIntoViewIfNeeded();
    const categoryId =
        (await category.getAttribute('data-category-id'))?.trim() ?? '';
    await category.click();
    const selectedCategory =
        categoryId.length > 0
            ? page
                  .locator(
                      `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]:visible`
                  )
                  .first()
            : category;
    await expect(selectedCategory).toHaveAttribute('aria-current', 'true', {
        timeout: 20000,
    });
}

async function openWorkspaceSection(page: Page, label: string): Promise<void> {
    if (label === 'Favorites') {
        await openGlobalFavorites(page);
        return;
    }

    await page.getByRole('link', { name: label, exact: true }).click();
}

async function waitForXtreamWorkspaceReady(page: Page): Promise<void> {
    await waitForXtreamCatalog(page);
}

function groupPanelHeader(page: Page, groupTitle: string) {
    return page.locator('.group-nav-item').filter({
        hasText: flexibleTextPattern(groupTitle),
    });
}

async function ensureGroupSelected(
    page: Page,
    groupTitle: string
): Promise<void> {
    const header = groupPanelHeader(page, groupTitle).first();

    await expect(header).toBeVisible();

    if ((await header.getAttribute('aria-current')) !== 'true') {
        await header.click();
    }
}

function xtreamSearchResultCards(page: Page) {
    return page.locator('app-search-results .results-grid .content-card');
}

function liveChannelSidebar(page: Page) {
    return page.locator('app-live-stream-layout .sidebar');
}

function gridListCardByTitle(page: Page, title: string) {
    return page.locator('.category-content-layout mat-card').filter({
        has: page.locator('.title', {
            hasText: flexibleTextPattern(title),
        }),
    });
}

async function clickGridListCardByTitle(
    page: Page,
    title: string
): Promise<void> {
    const card = gridListCardByTitle(page, title).first();

    await expect(card).toBeVisible({ timeout: 20000 });
    await card.click();
}

function contentCardByTitle(page: Page, title: string) {
    return page.locator('app-content-card').filter({
        has: page.locator('h3', {
            hasText: flexibleTextPattern(title),
        }),
    });
}

async function resolveVisibleXtreamTitles(
    page: Page,
    fixture: XtreamVodFixture
): Promise<{
    controlTitle: string;
    targetTitle: string;
}> {
    const visibleTitles = (
        await page
            .locator('.category-content-layout mat-card .title')
            .allTextContents()
    )
        .map((title) => title.trim())
        .filter((title) => title.length > 0);
    const matchedTitles = fixture.candidateTitles
        .map((title) => {
            const normalizedTitle = normalizeSearchText(title);
            return (
                visibleTitles.find(
                    (visibleTitle) =>
                        normalizeSearchText(visibleTitle) === normalizedTitle
                ) ?? null
            );
        })
        .filter((title): title is string => Boolean(title));
    const uniqueMatchedTitles = [...new Set(matchedTitles)];

    if (uniqueMatchedTitles.length < 2) {
        throw new Error(
            `Expected at least two visible Xtream titles from fixture candidates ${fixture.candidateTitles.join(
                ', '
            )}, but found ${visibleTitles.join(', ')}`
        );
    }

    return {
        controlTitle: uniqueMatchedTitles[1],
        targetTitle: uniqueMatchedTitles[0],
    };
}

async function expectXtreamRootCatalogSearch(
    page: Page,
    options: {
        pathPattern: RegExp;
        sample: XtreamVodFixture;
        sectionLabel: string;
    }
): Promise<void> {
    await openWorkspaceSection(page, options.sectionLabel);
    await expectPathname(page, options.pathPattern);
    await fillWorkspaceSearch(page, options.sample.targetTitle);

    await expectPathname(page, options.pathPattern);
    await expectQueryParam(page, 'q', options.sample.targetTitle);
    await expectWorkspaceSearchScope(
        page,
        `${options.sectionLabel} / All Items`
    );
    const contentLayout = page.locator('.category-content-layout');
    await expect(contentLayout).toContainText(
        flexibleTextPattern(options.sample.targetTitle),
        { timeout: 20000 }
    );
    await expect(contentLayout).not.toContainText(
        flexibleTextPattern(options.sample.controlTitle)
    );
}

async function addCurrentDetailToFavorites(page: Page): Promise<void> {
    const addButton = page
        .locator('button.favorite-btn')
        .filter({ hasText: /Add to favorites/i })
        .first();

    await expect(addButton).toBeVisible({ timeout: 20000 });
    await addButton.click();
    await expect(
        page
            .locator('button.favorite-btn.favorite-btn--active')
            .filter({ hasText: /Remove from favorites/i })
            .first()
    ).toBeVisible({ timeout: 20000 });
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

async function expectInlinePlayerWithoutDialog(page: Page): Promise<void> {
    await expect(
        page.locator('app-portal-inline-player app-web-player-view').first()
    ).toBeVisible({ timeout: 20000 });
    await expect(
        page.locator('mat-dialog-container app-web-player-view')
    ).toHaveCount(0);
}

async function pickPreferredCategory(categories: Locator): Promise<Locator> {
    const count = await categories.count();
    let fallback = categories.first();

    for (let index = 0; index < count; index += 1) {
        const candidate = categories.nth(index);

        if (!(await candidate.isVisible())) {
            continue;
        }

        fallback = candidate;

        const countText =
            (await candidate.locator('.item-count').first().textContent()) ??
            '';
        const itemCount = Number.parseInt(countText.trim(), 10);

        if (Number.isFinite(itemCount) && itemCount > 0) {
            return candidate;
        }
    }

    return fallback;
}

async function performXtreamPlaylistSearch(
    page: Page,
    queries: string[]
): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        for (const query of queries) {
            await fillWorkspaceSearch(page, query, {
                submit: true,
            });
            await expectPathname(page, /\/workspace\/xtreams\/[^/]+\/search$/);
            await expectQueryParam(page, 'q', query);

            try {
                await expect(xtreamSearchResultCards(page).first()).toBeVisible(
                    {
                        timeout: 5000,
                    }
                );
                return query;
            } catch {
                // Try the next candidate token.
            }
        }

        if (attempt < 2) {
            await page.waitForTimeout(1500);
        }
    }

    throw new Error(
        `Expected Xtream playlist search to return results for at least one candidate query: ${queries.join(
            ', '
        )}`
    );
}

function channelItemByTitle(page: Page, title: string) {
    return page.getByTestId('channel-item').filter({
        has: page.locator('.channel-name', {
            hasText: flexibleTextPattern(title),
        }),
    });
}

async function toggleFavoriteForChannel(
    page: Page,
    title: string
): Promise<void> {
    const item = channelItemByTitle(page, title).first();

    await expect(item).toBeVisible();
    await item.hover();
    const favoriteButton = item.locator('.favorite-button').first();

    await expect(favoriteButton).toBeVisible();
    await favoriteButton.click();
    await expect(favoriteButton.locator('mat-icon')).toHaveText(/star/);
}

function getXtreamTitle(item: XtreamVodStream): string {
    return `${item.title ?? item.name ?? ''}`.trim();
}

function getXtreamItemId(item: XtreamVodStream): string {
    return String(
        item.xtream_id ?? item.series_id ?? item.stream_id ?? item.id ?? ''
    ).trim();
}

function getStalkerTitle(item: StalkerContentItem): string {
    return `${item.o_name ?? item.name ?? ''}`.trim();
}

function pickDistinctItems<T>(
    items: T[],
    getTitle: (item: T) => string,
    preferredTitle?: (title: string) => boolean
): [T, T] {
    const titledItems = items.filter((item) => getTitle(item).length > 0);
    const preferredItems = preferredTitle
        ? titledItems.filter((item) => preferredTitle(getTitle(item)))
        : titledItems;
    const target = (preferredItems[0] ?? titledItems[0]) as T | undefined;

    if (!target) {
        throw new Error('Expected at least two items with distinct titles.');
    }

    const control =
        preferredItems.find((item) => getTitle(item) !== getTitle(target)) ??
        titledItems.find((item) => getTitle(item) !== getTitle(target));

    if (!control) {
        throw new Error('Expected at least two items with distinct titles.');
    }

    return [target, control];
}

function createUniquePrefix(targetTitle: string, controlTitle: string): string {
    const normalizedControl = controlTitle.toLowerCase();
    const trimmedTarget = targetTitle.trim();

    for (let length = 3; length <= trimmedTarget.length; length += 1) {
        const candidate = trimmedTarget.slice(0, length).trim();
        if (candidate.length < 3) {
            continue;
        }

        if (!normalizedControl.includes(candidate.toLowerCase())) {
            return candidate;
        }
    }

    return trimmedTarget;
}

function createUniqueSearchToken(
    targetTitle: string,
    controlTitle: string
): string {
    const normalizedControl = normalizeSearchText(controlTitle);
    const targetWords = normalizeSearchText(targetTitle)
        .split(/\s+/)
        .filter((word) => word.length >= 3);

    for (const word of targetWords) {
        if (!normalizedControl.includes(word)) {
            return word;
        }
    }

    return createUniquePrefix(
        normalizeSearchText(targetTitle),
        normalizeSearchText(controlTitle)
    );
}

function buildXtreamSearchQueries(
    targetTitle: string,
    controlTitle: string
): string[] {
    const normalizedTarget = normalizeSearchText(targetTitle);
    const normalizedControl = normalizeSearchText(controlTitle);
    const queries = new Set<string>();

    queries.add(createUniqueSearchToken(targetTitle, controlTitle));

    for (const word of normalizedTarget.split(/\s+/)) {
        if (word.length < 3) {
            continue;
        }

        if (!normalizedControl.includes(word)) {
            queries.add(word);
        }
    }

    for (const word of normalizedTarget.split(/\s+/)) {
        if (word.length >= 3) {
            queries.add(word);
        }
    }

    queries.add(normalizedTarget);

    return [...queries].filter((query) => query.trim().length >= 3);
}

function normalizeSearchText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isStableXtreamSearchTitle(title: string): boolean {
    return (
        /^[a-z0-9 ]+$/i.test(title.trim()) &&
        normalizeSearchText(title)
            .split(/\s+/)
            .some((word) => word.length >= 3)
    );
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleTextPattern(value: string): RegExp {
    return new RegExp(
        value
            .trim()
            .split(/\s+/)
            .map((part) => escapeRegex(part))
            .join('\\s+')
    );
}

async function expectPathname(page: Page, pattern: RegExp): Promise<void> {
    await expect.poll(() => new URL(page.url()).pathname).toMatch(pattern);
}

async function expectQueryParam(
    page: Page,
    name: string,
    value: string
): Promise<void> {
    await expect
        .poll(() => new URL(page.url()).searchParams.get(name))
        .toBe(value);
}

async function expectQueryParamAbsent(page: Page, name: string): Promise<void> {
    await expect
        .poll(() => new URL(page.url()).searchParams.has(name))
        .toBe(false);
}
