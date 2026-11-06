import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

const transportStream = readFileSync(
    join(__dirname, '../../xtream-mock-server/src/fixtures/live.mpegts')
);
const nextStreamUrl = 'https://stalled-stream-fixture.test/next.webm';
const nextStream = readFileSync(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
);

async function startStalledStreamServer() {
    const activeRequests = new Set<ServerResponse>();
    let requestCount = 0;
    const server = createServer((request, response) => {
        if (request.url !== '/stalled.ts') {
            response.writeHead(404).end();
            return;
        }
        requestCount++;
        activeRequests.add(response);
        response.on('close', () => activeRequests.delete(response));
        response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'no-store',
        });
        // Send valid media, then stall forever: no further writes or end().
        // A fulfilled Playwright route cannot reproduce a pending body read.
        response.write(transportStream);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Stalled stream server has no TCP address');
    }
    return {
        origin: `http://127.0.0.1:${address.port}`,
        activeRequests,
        requestCount: () => requestCount,
        close: async () => {
            // Also clean up an intentionally leaked request in the red run.
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        },
    };
}

test('@playback @electron switching away from a stalled MPEG-TS channel closes its request', async ({
    dataDir,
}) => {
    const fixture = await startStalledStreamServer();
    try {
        const playlistPath = join(dataDir, 'stalled-stream.m3u');
        writeFileSync(
            playlistPath,
            [
                '#EXTM3U',
                '#EXTINF:-1,Stalled MPEG-TS',
                `${fixture.origin}/stalled.ts`,
                '#EXTINF:-1,Next channel',
                nextStreamUrl,
            ].join('\n')
        );

        // The fresh profile defaults to Video.js, exercising its real
        // MPEG-TS session and the shipped mpegts.js bundle.
        const app = await launchElectronApp(dataDir);
        try {
            const page = app.mainWindow;
            const rendererErrors: string[] = [];
            page.on('pageerror', (error) => rendererErrors.push(error.message));
            await page.route(nextStreamUrl, (route) =>
                route.fulfill({ contentType: 'video/webm', body: nextStream })
            );
            await goToDashboard(page);
            await importM3uPlaylistFromNativeDialog(app, playlistPath);
            await page.waitForURL(/\/workspace\/playlists\/.+/);
            await channelItemByTitle(page, 'Stalled MPEG-TS').first().click();

            const video = page.locator('app-web-player-view video');
            await expect(video).toHaveCount(1);
            await expect
                .poll(() =>
                    video.evaluate(
                        (element: HTMLVideoElement) => element.currentTime
                    )
                )
                .toBeGreaterThan(0.5);
            // The server has stopped sending, playback has exhausted its buffer,
            // and the HTTP response is still open when we switch channels.
            await expect
                .poll(() =>
                    video.evaluate(
                        (element: HTMLVideoElement) =>
                            !element.paused &&
                            !element.ended &&
                            element.readyState < 3
                    )
                )
                .toBe(true);
            expect(fixture.requestCount()).toBe(1);
            expect(fixture.activeRequests.size).toBe(1);

            await channelItemByTitle(page, 'Next channel').first().click();
            // Observe the provider side before closing the window or server:
            // unloading the renderer would also hide the original connection leak.
            await expect.poll(() => fixture.activeRequests.size).toBe(0);
            await expect
                .poll(() =>
                    video.evaluate(
                        (element: HTMLVideoElement, url) =>
                            element.currentSrc === url &&
                            element.currentTime > 0.5,
                        nextStreamUrl
                    )
                )
                .toBe(true);
            expect(fixture.requestCount()).toBe(1);
            expect(rendererErrors).toEqual([]);
        } finally {
            await closeElectronApp(app);
        }
    } finally {
        await fixture.close();
    }
});
