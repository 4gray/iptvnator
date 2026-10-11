import { createServer, request as forwardRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamCatalog,
    xtreamMockServer,
} from './electron-test-fixtures';
import {
    readXtreamImportStatuses,
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
    close(): Promise<void>;
}

/** Forwards GET requests to `target`, holding each for `delayFor(url)` ms. */
async function startDelayingProxy(
    target: string,
    delayFor: (url: URL) => number
): Promise<DelayingProxy> {
    const upstream = new URL(target);
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://proxy.invalid');
        setTimeout(() => {
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
        }, delayFor(url));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
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

test.describe('Electron Xtream catalog wait', () => {
    test('@xtream @electron waits for every type when the portal answers after the overlay window', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120_000);
        await resetMockServers(request, ['xtream']);
        const proxy = await startDelayingProxy(xtreamMockServer, portalDelay);
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: 'Slow account check portal',
                serverUrl: proxy.origin,
            });
            await waitForXtreamCatalog(app.mainWindow);

            // Closing the app here must not interrupt the import: the next
            // launch reads these statuses, and an interrupted series import
            // leaves no series rows for global search to find.
            const playlistId = xtreamPlaylistIdFromUrl(app.mainWindow.url());
            expect(playlistId).not.toBeNull();
            expect(
                await readXtreamImportStatuses(
                    app.mainWindow,
                    playlistId as string
                )
            ).toEqual({
                live: 'completed',
                movie: 'completed',
                series: 'completed',
            });
        } finally {
            await closeElectronApp(app);
            await proxy.close();
        }
    });
});
