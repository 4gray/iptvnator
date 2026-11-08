import { once } from 'node:events';
import { createServer } from 'node:http';
import {
    addStalkerPortal,
    closeElectronApp,
    defaultStalkerMacAddress,
    expect,
    fillWorkspaceSearch,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    playlistSwitcherTitle,
    stalkerMockServer,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

const term = 'Fixture Alpha';
const localTitle = `${term} Live`;
const readyPortalName = 'Fixture Ready Portal';
const delayedPortalName = 'Fixture Delayed Portal';

/** Observe and hold the real requests sent from Electron's main process. */
async function startPortalSearchProxy() {
    const searchRequests: string[] = [];
    let release!: () => void;
    const delay = new Promise<void>((resolve) => {
        release = resolve;
    });
    const server = createServer(async (request, response) => {
        const incoming = new URL(request.url ?? '/', stalkerMockServer);
        const delayed = incoming.pathname === '/delayed/portal.php';
        if (!delayed && incoming.pathname !== '/ready/portal.php') {
            response.writeHead(404).end();
            return;
        }

        if (
            incoming.searchParams.get('action') === 'get_ordered_list' &&
            incoming.searchParams.get('search') === term
        ) {
            const portal = delayed ? 'delayed' : 'ready';
            searchRequests.push(
                `${portal}:${incoming.searchParams.get('type')}`
            );
            if (delayed) await delay;
        }

        try {
            const upstreamUrl = new URL('/portal.php', stalkerMockServer);
            upstreamUrl.search = incoming.search;
            const upstream = await fetch(upstreamUrl, {
                headers: { cookie: request.headers.cookie ?? '' },
            });
            const body = await upstream.text();
            response
                .writeHead(upstream.status, {
                    'Content-Type':
                        upstream.headers.get('content-type') ?? 'text/plain',
                })
                .end(body);
        } catch {
            response.writeHead(502).end();
        }
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('No local Stalker search proxy port');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    return {
        readyPortalUrl: `${origin}/ready/portal.php`,
        delayedPortalUrl: `${origin}/delayed/portal.php`,
        searchRequests,
        release,
        close: () => {
            release();
            return new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        },
    };
}

test('@stalker @electron global search mixes Stalker and local results and preserves the query on Back', async ({
    dataDir,
    request,
}) => {
    const portals = await startPortalSearchProxy();
    try {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            const globalSearchLink = page.getByRole('link', {
                name: 'Global search',
                exact: true,
            });
            const main = page.getByRole('main');
            await addStalkerPortal(page, {
                macAddress: '00:1A:79:18:44:01',
                name: readyPortalName,
                portalUrl: portals.readyPortalUrl,
            });
            await expect(playlistSwitcherTitle(page)).toHaveText(
                readyPortalName
            );
            await globalSearchLink.click();
            await expect(page).toHaveURL(/\/workspace\/search$/);
            await fillWorkspaceSearch(page, 'Fixture Beta');
            await expect(
                main.getByRole('button', { name: 'Fixture Beta', exact: true })
            ).toBeVisible();
            await expect(
                main.getByRole('button', { name: /Search Stalker/ })
            ).toHaveCount(0);

            const filePath = writeTemporaryM3uFile(
                dataDir,
                'fixture-search.m3u',
                [
                    {
                        name: localTitle,
                        url: 'https://media.example.test/live.m3u8',
                    },
                ]
            );
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(page);
            await addStalkerPortal(page, {
                name: delayedPortalName,
                portalUrl: portals.delayedPortalUrl,
            });
            await expect(playlistSwitcherTitle(page)).toHaveText(
                delayedPortalName
            );
            await globalSearchLink.click();
            await expect(page).toHaveURL(/\/workspace\/search$/);
            await page
                .getByRole('checkbox', { name: 'Movies', exact: true })
                .uncheck();
            await fillWorkspaceSearch(page, term);

            const localResult = main.getByRole('button', {
                name: localTitle,
                exact: true,
            });
            const remoteResult = main.getByRole('button', {
                name: term,
                exact: true,
            });
            await expect(localResult).toBeVisible();
            await expect(remoteResult).toBeVisible();
            await expect(page).toHaveURL(
                (url) =>
                    url.pathname.endsWith('/workspace/search') &&
                    url.searchParams.get('q') === term
            );
            const globalSearchUrl = page.url();
            await expect
                .poll(() => portals.searchRequests)
                .toContain('delayed:vod');

            const grouping = main.getByRole('checkbox', {
                name: 'Group results by playlist',
                exact: true,
            });
            const groups = main.locator('.playlist-group');
            await expect(
                groups
                    .filter({ hasText: readyPortalName })
                    .getByRole('button', {
                        name: term,
                        exact: true,
                    })
            ).toBeVisible();
            await expect(
                groups
                    .filter({ hasText: 'fixture-search' })
                    .getByRole('button', {
                        name: localTitle,
                        exact: true,
                    })
            ).toBeVisible();
            await grouping.uncheck();
            const grid = main.locator('.results-grid');
            await expect(grid).toHaveCount(1);
            await expect(
                grid.getByRole('button', { name: localTitle, exact: true })
            ).toBeVisible();
            await expect(
                grid.getByRole('button', { name: term, exact: true })
            ).toBeVisible();
            await localResult.click({ trial: true });

            portals.release();
            await expect
                .poll(() => portals.searchRequests)
                .toContain('delayed:series');
            await remoteResult.press('Enter');
            await expect(page).toHaveURL(
                /\/workspace\/stalker\/[^/]+\/vod\/2001$/
            );
            for (const name of ['Episode 1', 'Episode 2']) {
                await expect(
                    page.getByRole('heading', { name, exact: true })
                ).toBeVisible();
            }
            await page
                .getByRole('button', { name: 'Back', exact: true })
                .click();
            await expect(page).toHaveURL(globalSearchUrl);
            await expect(localResult).toBeVisible();
            await expect(remoteResult).toBeVisible();

            const catalog = await request.get(
                `${stalkerMockServer}/portal.php`,
                {
                    params: { action: 'get_ordered_list', type: 'series' },
                    headers: { Cookie: `mac=${defaultStalkerMacAddress}` },
                }
            );
            expect(catalog.ok()).toBe(true);
            const regularTitle: string = (await catalog.json()).js.data[0].name;
            await fillWorkspaceSearch(page, regularTitle);
            await expect(page).toHaveURL(
                (url) => url.searchParams.get('q') === regularTitle
            );
            const regularSearchUrl = page.url();
            const regularResult = main.getByRole('button', {
                name: regularTitle,
                exact: true,
            });
            await regularResult.click();
            await expect(page).toHaveURL(
                /\/workspace\/stalker\/[^/]+\/series\/[^/]+$/
            );
            await expect(
                main.getByRole('heading', { name: 'Episode 1', exact: true })
            ).toBeVisible();
            await page.goBack();
            await expect(page).toHaveURL(regularSearchUrl);
            await expect(regularResult).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    } finally {
        await portals.close();
    }
});
