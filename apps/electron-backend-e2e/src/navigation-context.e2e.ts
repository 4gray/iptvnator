import { createServer, type Server } from 'node:http';
import { navigationPortalResponse } from '@iptvnator/shared/testing';
import {
    addXtreamPortal,
    closeElectronApp,
    deleteSource,
    expect,
    launchElectronApp,
    openGlobalFavorites,
    openGlobalRecent,
    openSources,
    sourceRowByTitle,
    switchUnifiedCollectionContent,
    switchUnifiedCollectionScope,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
    reloadFromRenderer,
} from './renderer-reload.support';

let server: Server;
let serverUrl: string;
let reloadSourceUnavailable = false;

test.beforeAll(async () => {
    server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://synthetic.invalid');
        if (
            reloadSourceUnavailable &&
            url.searchParams.get('username') === 'synthetic-reload'
        ) {
            response.writeHead(503).end();
            return;
        }
        const action = url.searchParams.get('action');
        if (url.searchParams.get('username') === 'synthetic-reload') {
            if (action === 'get_live_categories') {
                response.setHeader('content-type', 'application/json');
                response.end(
                    JSON.stringify([
                        { category_id: '101', category_name: 'Synthetic Live' },
                    ])
                );
                return;
            }
            if (action === 'get_live_streams') {
                response.setHeader('content-type', 'application/json');
                response.end(
                    JSON.stringify([
                        {
                            stream_id: 10001,
                            name: 'Synthetic Channel',
                            category_id: '101',
                            stream_type: 'live',
                        },
                    ])
                );
                return;
            }
        }
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify(navigationPortalResponse(url.searchParams))
        );
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Fixture port missing');
    serverUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const kind of ['vod', 'series'] as const) {
    for (const categoryIdentity of [
        'catalog',
        'provider',
        'duplicate',
    ] as const) {
        test(`@electron @xtream reloaded ${kind} detail with ${categoryIdentity} category ID returns to its owning category`, async ({
            dataDir,
        }) => {
            const app = await launchElectronApp(dataDir);
            const page = app.mainWindow;
            try {
                await addXtreamPortal(page, {
                    serverUrl,
                    name: 'Synthetic Source A',
                    username:
                        categoryIdentity === 'duplicate'
                            ? 'synthetic-duplicates'
                            : 'synthetic-a',
                    password: 'synthetic-only',
                });
                await waitForXtreamWorkspaceReady(page);
                if (kind === 'series') {
                    await page
                        .getByRole('link', { name: 'Series', exact: true })
                        .click();
                }
                await page.locator('app-grid-list mat-card').first().click();
                await expect(
                    page.locator('app-portal-detail-shell h1')
                ).toBeVisible();
                const detail = page.url();
                let parent = detail.slice(0, detail.lastIndexOf('/'));
                if (categoryIdentity !== 'catalog') {
                    let categoryId = kind === 'vod' ? '201' : '301';
                    if (categoryIdentity === 'duplicate') {
                        const playlistId = /xtreams\/([^/]+)/.exec(detail)?.[1];
                        if (!playlistId)
                            throw new Error('Synthetic source missing');
                        const categories = await page.evaluate(
                            async ({ playlistId, kind }) => {
                                const rows = await window.electron.dbGetContent(
                                    playlistId,
                                    kind === 'vod' ? 'movie' : 'series'
                                );
                                return rows
                                    .filter(
                                        (row) =>
                                            row.xtream_id ===
                                            (kind === 'vod' ? 20001 : 30001)
                                    )
                                    .map((row) => row.category_id);
                            },
                            { playlistId, kind }
                        );
                        expect(categories).toHaveLength(2);
                        categoryId = String(categories[1]);
                        parent =
                            parent.slice(0, parent.lastIndexOf('/') + 1) +
                            categoryId;
                    }
                    await page.evaluate((categoryId) => {
                        const url = new URL(location.href);
                        const segments = url.pathname.split('/');
                        segments[segments.length - 2] = categoryId;
                        url.pathname = segments.join('/');
                        history.replaceState(history.state, '', url);
                    }, categoryId);
                }
                await reloadFromMainProcess(app);
                await expectRendererReloadedOnRoute(
                    page,
                    new RegExp(`/${kind}/[^/]+/[^/]+$`)
                );
                await expect(
                    page.locator('app-portal-detail-shell h1')
                ).toBeVisible();
                const index = await page.evaluate(
                    () => navigation.currentEntry?.index
                );
                await page.getByTestId('workspace-header-back').click();
                await expect(page).toHaveURL(parent);
                await expect(
                    page.locator('app-grid-list mat-card').first()
                ).toBeVisible();
                expect(
                    await page.evaluate(() => navigation.currentEntry?.index)
                ).toBe(index);
                await expect(
                    page.getByTestId('workspace-header-back')
                ).toHaveCount(0);
                await page.locator('app-grid-list mat-card').first().click();
                await expect(
                    page.locator('app-portal-detail-shell h1')
                ).toBeVisible();
                await page.getByTestId('workspace-header-back').click();
                await expect(page).toHaveURL(parent);
            } finally {
                await closeElectronApp(app);
            }
        });
    }
}

for (const type of ['movie', 'series'] as const) {
    test(`@electron @xtream searched foreign ${type} favorites retain tab and All playlists through history`, async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            for (const source of ['A', 'B']) {
                if (source === 'B') await openSources(page);
                await addXtreamPortal(page, {
                    serverUrl,
                    name: `Synthetic Source ${source}`,
                    username: `synthetic-${source.toLowerCase()}`,
                    password: 'synthetic-only',
                });
                await waitForXtreamWorkspaceReady(page);
            }
            const playlistId = /xtreams\/([^/]+)/.exec(page.url())?.[1];
            if (!playlistId) throw new Error('Synthetic source id missing');
            const title = await page.evaluate(
                async ({ id, type }) => {
                    for (const kind of ['movie', 'series'] as const) {
                        const [item] = await window.electron.dbGetContent(
                            id,
                            kind
                        );
                        await window.electron.dbAddFavorite(item.id, id);
                    }
                    const [item] = await window.electron.dbGetContent(id, type);
                    return item.title;
                },
                { id: playlistId, type }
            );
            await openSources(page);
            await sourceRowByTitle(page, 'Synthetic Source A')
                .locator('.source-row__body')
                .click();
            await waitForXtreamWorkspaceReady(page);
            await openGlobalFavorites(page);
            await switchUnifiedCollectionScope(page, 'All playlists');
            await switchUnifiedCollectionContent(
                page,
                type === 'movie' ? 'Movies' : 'Series'
            );
            const search = page.locator(
                'app-workspace-shell-header input[type="search"]'
            );
            await search.fill(title);
            await expect(page).toHaveURL(/\?q=/);
            const card = page.locator('app-content-card');
            await expect(card).toHaveCount(1);
            await card.click();
            await expect(page.locator('app-portal-detail-shell h1')).toHaveText(
                title
            );
            await page.getByTestId('workspace-header-back').click();
            await expect(
                page.getByRole('radio', { name: /All playlists/ })
            ).toHaveAttribute('aria-checked', 'true');
            await expect(card).toContainText(title);
            expect(
                await page.evaluate(() => history.state.collectionViewState)
            ).toEqual({ selectedContentType: type, scope: 'all' });
            await page.goForward();
            await expect(page.locator('app-portal-detail-shell h1')).toHaveText(
                title
            );
            await page.goBack();
            await expect(card).toContainText(title);
            await search.fill('');
            await expect(page).not.toHaveURL(/\?q=/);
            await expect(card).toContainText(title);
            await expect(
                page.getByRole('radio', { name: /All playlists/ })
            ).toHaveAttribute('aria-checked', 'true');
            expect(
                await page.evaluate(() => history.state.collectionViewState)
            ).toEqual({ selectedContentType: type, scope: 'all' });
            await card.click();
            await expect(page.locator('app-portal-detail-shell h1')).toHaveText(
                title
            );
            await page.getByTestId('workspace-header-back').click();
            await expect(card).toContainText(title);
            await expect(
                page.getByRole('radio', { name: /All playlists/ })
            ).toHaveAttribute('aria-checked', 'true');
        } finally {
            await closeElectronApp(app);
        }
    });
}

for (const mode of ['favorites', 'recent'] as const) {
    test(`@electron @xtream ${mode} retain collection context after full renderer reload`, async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page, {
                serverUrl,
                name: 'Synthetic Reload Source',
                username: 'synthetic-reload',
                password: 'synthetic-only',
            });
            await waitForXtreamWorkspaceReady(page);
            const id = /xtreams\/([^/]+)/.exec(page.url())?.[1];
            if (!id) throw new Error('Synthetic source id missing');
            await page.evaluate(async (id) => {
                for (const type of ['live', 'movie', 'series'] as const) {
                    const [item] = await window.electron.dbGetContent(id, type);
                    await window.electron.dbAddFavorite(item.id, id);
                    await window.electron.dbAddRecentItem(item.id, id);
                }
            }, id);
            if (mode === 'favorites') await openGlobalFavorites(page);
            else await openGlobalRecent(page);
            for (const [label, type, scope, reload] of [
                ['Live TV', 'live', 'All playlists', reloadFromRenderer],
                ['Movies', 'movie', 'All playlists', reloadFromMainProcess],
                ['Series', 'series', 'This playlist', reloadFromRenderer],
            ] as const) {
                await switchUnifiedCollectionScope(page, scope);
                await switchUnifiedCollectionContent(page, label);
                const expected = {
                    selectedContentType: type,
                    scope: scope === 'All playlists' ? 'all' : 'playlist',
                };
                await expect
                    .poll(() =>
                        page.evaluate(() => history.state.collectionViewState)
                    )
                    .toEqual(expected);
                await reload(app);
                await expectRendererReloadedOnRoute(
                    page,
                    new RegExp(`/workspace/global-${mode}(?:\\?.*)?$`)
                );
                await expect(
                    page.getByRole('radio', { name: new RegExp(scope) })
                ).toHaveAttribute('aria-checked', 'true');
                await expect
                    .poll(() =>
                        page.evaluate(() => history.state.collectionViewState)
                    )
                    .toEqual(expected);
                await expect(
                    page.getByRole('radio', { name: new RegExp(label) })
                ).toHaveAttribute('aria-checked', 'true');
                if (type === 'live') {
                    await expect(
                        page.locator('app-unified-live-tab')
                    ).toBeVisible();
                    continue;
                }
                const card = page.locator('app-content-card').first();
                await expect(card).toBeVisible();
                await card.click();
                await expect(
                    page.locator('app-portal-detail-shell h1')
                ).toBeVisible();
                await page.goBack();
                await expect(card).toBeVisible();
                await page.goForward();
                await expect(
                    page.locator('app-portal-detail-shell h1')
                ).toBeVisible();
                await page.goBack();
                await expect(card).toBeVisible();
                expect(
                    await page.evaluate(() => history.state.collectionViewState)
                ).toEqual(expected);
            }
            reloadSourceUnavailable = true;
            await reloadFromMainProcess(app);
            await expectRendererReloadedOnRoute(
                page,
                new RegExp(`/workspace/global-${mode}$`)
            );
            await expect(
                page.locator('app-content-card').first()
            ).toBeVisible();
            expect(
                await page.evaluate(() => history.state.collectionViewState)
            ).toEqual({ selectedContentType: 'series', scope: 'playlist' });
            reloadSourceUnavailable = false;
            if (mode === 'favorites') {
                await openSources(page);
                await deleteSource(page, 'Synthetic Reload Source');
                await page.goBack();
                await expect(page).toHaveURL(/\/workspace\/global-favorites$/);
                await reloadFromRenderer(app);
                await expectRendererReloadedOnRoute(
                    page,
                    /\/workspace\/global-favorites$/
                );
                await expect(page.locator('.scope-toggle')).toHaveCount(0);
                await expect(page.locator('app-content-card')).toHaveCount(0);
                await expect(
                    page.locator('app-portal-detail-shell h1')
                ).toHaveCount(0);
                await expect(
                    page.getByRole('heading', { name: 'No favorites to show' })
                ).toBeVisible();
                await expect(
                    page.getByRole('button', {
                        name: 'Add Your First Playlist',
                    })
                ).toBeVisible();
            }
        } finally {
            reloadSourceUnavailable = false;
            await closeElectronApp(app);
        }
    });
}
