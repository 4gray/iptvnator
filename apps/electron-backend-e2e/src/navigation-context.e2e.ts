import { createServer, type Server } from 'node:http';
import { navigationPortalResponse } from '@iptvnator/shared/testing';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openGlobalFavorites,
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
} from './renderer-reload.support';

let server: Server;
let serverUrl: string;

test.beforeAll(async () => {
    server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://synthetic.invalid');
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
    test(`@electron @xtream reloaded ${kind} detail Back replaces its entry with the owning category`, async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await addXtreamPortal(page, {
                serverUrl,
                name: 'Synthetic Source A',
                username: 'synthetic-a',
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
            const parent = detail.slice(0, detail.lastIndexOf('/'));
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
            await expect(page.getByTestId('workspace-header-back')).toHaveCount(
                0
            );
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
