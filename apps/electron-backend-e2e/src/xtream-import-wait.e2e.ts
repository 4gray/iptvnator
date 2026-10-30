import { createServer, request as forwardRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    refreshSource,
    resetMockServers,
    test,
    waitForXtreamCatalog,
    xtreamMockServer,
} from './electron-test-fixtures';
import {
    readXtreamImportState,
    xtreamPlaylistIdFromUrl,
} from './xtream-import-wait';

/**
 * Longer than the 5 s the catalog wait gives the loading overlay to appear.
 * The overlay appears only once the account check has answered, which a mock
 * generating a large catalog on its first request can take this long to do.
 */
const ACCOUNT_INFO_DELAY_MS = 7_000;
/** Keeps series importing after the movie cards are already visible. */
const SERIES_LIST_DELAY_MS = 3_000;

interface DelayingProxy {
    readonly origin: string;
    /** Holds the account check and the series list from now on. */
    slowDown(): void;
    close(): Promise<void>;
}

function portalDelay(url: URL): number {
    if (!url.pathname.endsWith('/player_api.php')) {
        return 0;
    }
    const action = url.searchParams.get('action');
    if (action === null || action === 'get_account_info') {
        return ACCOUNT_INFO_DELAY_MS;
    }
    return action === 'get_series' ? SERIES_LIST_DELAY_MS : 0;
}

/** Forwards GET requests to `target`, delayed by `portalDelay` once slowed. */
async function startDelayingProxy(
    target: string,
    slow: boolean
): Promise<DelayingProxy> {
    const upstream = new URL(target);
    let delaying = slow;
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://proxy.invalid');
        setTimeout(
            () => {
                const forwarded = forwardRequest(
                    {
                        headers: { ...request.headers, host: upstream.host },
                        hostname: upstream.hostname,
                        method: request.method,
                        path: request.url,
                        port: upstream.port,
                    },
                    (answer) => {
                        response.writeHead(
                            answer.statusCode ?? 502,
                            answer.headers
                        );
                        answer.pipe(response);
                    }
                );
                forwarded.on('error', () => response.destroy());
                forwarded.end();
            },
            delaying ? portalDelay(url) : 0
        );
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    return {
        origin: `http://127.0.0.1:${port}`,
        slowDown: () => {
            delaying = true;
        },
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}

/**
 * Closing the app right after the wait must not interrupt the import: the next
 * launch reuses a type only when its status reads `completed` and rows exist,
 * and global search finds nothing of a type whose rows are missing.
 */
async function expectCatalogComplete(page: Page): Promise<void> {
    const playlistId = xtreamPlaylistIdFromUrl(page.url());
    expect(playlistId).not.toBeNull();
    const imported = {
        status: 'completed',
        hasCategories: true,
        hasContent: true,
    };
    expect(await readXtreamImportState(page, playlistId as string)).toEqual({
        live: imported,
        movie: imported,
        series: imported,
    });
}

test.describe('Electron Xtream catalog wait', () => {
    test('@xtream @electron waits for every type when the portal answers after the overlay window', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const proxy = await startDelayingProxy(xtreamMockServer, true);
        try {
            const app = await launchElectronApp(dataDir);
            try {
                await addXtreamPortal(app.mainWindow, {
                    name: 'Slow account check portal',
                    serverUrl: proxy.origin,
                });
                await waitForXtreamCatalog(app.mainWindow);
                await expectCatalogComplete(app.mainWindow);
            } finally {
                await closeElectronApp(app);
            }
        } finally {
            await proxy.close();
        }
    });

    test('@xtream @electron waits for the re-import after a refresh, whose statuses still read completed', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(150_000);
        await resetMockServers(request, ['xtream']);
        const proxy = await startDelayingProxy(xtreamMockServer, false);
        try {
            const app = await launchElectronApp(dataDir);
            try {
                const title = 'Slow refresh portal';
                await addXtreamPortal(app.mainWindow, {
                    name: title,
                    serverUrl: proxy.origin,
                });
                await waitForXtreamCatalog(app.mainWindow);

                // A refresh deletes the catalog and re-imports it, leaving
                // the three statuses at `completed` from the first import.
                proxy.slowDown();
                await openSources(app.mainWindow);
                await refreshSource(app.mainWindow, title, { confirm: true });
                await waitForXtreamCatalog(app.mainWindow);
                await expectCatalogComplete(app.mainWindow);
            } finally {
                await closeElectronApp(app);
            }
        } finally {
            await proxy.close();
        }
    });
});
