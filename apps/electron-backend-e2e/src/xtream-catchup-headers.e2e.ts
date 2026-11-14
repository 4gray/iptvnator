import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
    xtreamMockServer,
} from './electron-test-fixtures';
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
} from './renderer-reload.support';

const PAST_PROGRAM = 'Earlier Bulletin';
const headers = {
    userAgent: 'SyntheticArchiveAgent/1.0',
    referrer: 'https://archive.example/watch',
    origin: 'https://archive-origin.example',
};

interface ArchiveRequest {
    path: string;
    probe: boolean;
    userAgent?: string;
    referer?: string;
    origin?: string;
}

/**
 * Real HTTP in front of the Xtream mock: catch-up URLs are answered only
 * with the playlist's headers, everything else is proxied. Main-process
 * probes bypass page.route(), and Electron applies the scoped header
 * override below the renderer, so only a server sees what was really sent.
 */
async function createHeaderGatedArchivePortal() {
    const clip = readFileSync(
        join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
    );
    const archiveRequests: ArchiveRequest[] = [];
    const server = createServer(async (request, response) => {
        const incoming = new URL(request.url ?? '/', xtreamMockServer);
        if (
            incoming.pathname.startsWith('/timeshift/') ||
            incoming.pathname === '/streaming/timeshift.php'
        ) {
            const seen: ArchiveRequest = {
                path: incoming.pathname,
                // The catch-up probe is a short ranged GET from Node.
                probe: request.headers.range === 'bytes=0-4095',
                userAgent: request.headers['user-agent'],
                referer: request.headers.referer,
                origin: request.headers.origin,
            };
            archiveRequests.push(seen);
            if (
                seen.userAgent !== headers.userAgent ||
                seen.referer !== headers.referrer ||
                seen.origin !== headers.origin
            ) {
                response.writeHead(403).end();
                return;
            }
            response
                .writeHead(200, {
                    'content-type': 'video/webm',
                    'cache-control': 'no-store',
                    'content-length': clip.length,
                })
                .end(clip);
            return;
        }
        try {
            const upstream = new URL(xtreamMockServer);
            upstream.pathname = incoming.pathname;
            upstream.search = incoming.search;
            const result = await fetch(upstream, {
                signal: AbortSignal.timeout(10_000),
            });
            response
                .writeHead(result.status, {
                    'content-type': 'application/json',
                })
                .end(await result.text());
        } catch {
            response.writeHead(502).end();
        }
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing port');
    return {
        origin: `http://127.0.0.1:${address.port}`,
        archiveRequests,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}

test("@epg @xtream @electron probes and plays catch-up with the playlist's headers", async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120_000);
    const credentials = { username: 'epg', password: 'epg' };
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, credentials);
    const portal = await createHeaderGatedArchivePortal();
    let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        await addXtreamPortal(page, {
            name: 'Synthetic archive portal',
            serverUrl: portal.origin,
            ...credentials,
        });
        await waitForXtreamWorkspaceReady(page);
        const playlistId = new URL(page.url()).pathname.match(
            /xtreams\/([^/]+)/
        )?.[1];
        if (!playlistId) throw new Error('Missing Xtream playlist route');
        // Saved configuration through real SQLite, read after a reload.
        const saved = await page.evaluate(
            ({ id, values }) => window.electron.dbUpdatePlaylist(id, values),
            { id: playlistId, values: headers }
        );
        expect(saved.success).toBe(true);
        await reloadFromMainProcess(app);
        await expectRendererReloadedOnRoute(page, /\/xtreams\//);
        await waitForXtreamWorkspaceReady(page);

        await openWorkspaceSection(page, 'Live TV');
        await clickCategoryByNameExact(page, fixture.categoryName);
        const row = channelItemByTitle(page, fixture.stream.name).first();
        await expect(row).toBeVisible({ timeout: 20000 });
        await row.click();
        const block = page
            .locator('app-epg-timeline .epg-timeline__block')
            .filter({ hasText: PAST_PROGRAM })
            .first();
        await expect(block).toBeVisible({ timeout: 20000 });
        await block.click();

        // The probe found a playable variant, then the player fetched it.
        await expect
            .poll(() => ({
                probe: portal.archiveRequests.some((seen) => seen.probe),
                playback: portal.archiveRequests.some((seen) => !seen.probe),
            }))
            .toEqual({ probe: true, playback: true });
        expect(
            portal.archiveRequests.filter(
                (seen) =>
                    seen.userAgent !== headers.userAgent ||
                    seen.referer !== headers.referrer ||
                    seen.origin !== headers.origin
            )
        ).toEqual([]);
    } finally {
        if (app) await closeElectronApp(app);
        await portal.close();
    }
});
