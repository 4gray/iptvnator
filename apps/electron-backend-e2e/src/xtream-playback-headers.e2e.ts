import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
    xtreamMockServer,
} from './electron-test-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
} from './renderer-reload.support';

const playbackHeaders = {
    userAgent: 'SyntheticPlaybackAgent/1.0',
    referrer: 'https://playback.example/watch',
    origin: 'https://origin.example',
};

/** Real HTTP: Electron's main-process provider requests bypass page.route(). */
async function createHeaderGatedPortal(expected: {
    userAgent?: string;
    referrer?: string;
    origin: string;
}) {
    const clip = readFileSync(
        join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
    );
    const mediaRequests: {
        path: string;
        userAgent?: string;
        referer?: string;
        origin?: string;
    }[] = [];
    const server = createServer(async (request, response) => {
        const incoming = new URL(request.url ?? '/', xtreamMockServer);
        if (/^\/(movie|series)\//.test(incoming.pathname)) {
            const headers = {
                path: incoming.pathname,
                userAgent: request.headers['user-agent'],
                referer: request.headers.referer,
                origin: request.headers.origin,
            };
            mediaRequests.push(headers);
            if (
                (expected.userAgent !== undefined &&
                    headers.userAgent !== expected.userAgent) ||
                (expected.referrer !== undefined &&
                    headers.referer !== expected.referrer) ||
                headers.origin !== expected.origin
            ) {
                response.writeHead(403).end();
                return;
            }
            const range = /^bytes=(\d+)-(\d*)$/.exec(
                request.headers.range ?? ''
            );
            const start = range ? Number(range[1]) : 0;
            const end = range?.[2]
                ? Math.min(Number(range[2]), clip.length - 1)
                : clip.length - 1;
            response
                .writeHead(range ? 206 : 200, {
                    'content-type': 'video/webm',
                    'cache-control': 'no-store',
                    'accept-ranges': 'bytes',
                    'content-length': end - start + 1,
                    ...(range
                        ? {
                              'content-range': `bytes ${start}-${end}/${clip.length}`,
                          }
                        : {}),
                })
                .end(clip.subarray(start, end + 1));
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
        mediaRequests,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}

interface CapturedLaunch {
    url: string;
    'user-agent'?: string;
    referer?: string;
    origin?: string;
    startTime?: number;
    contentInfo?: { contentType: string };
}

type CaptureGlobal = typeof globalThis & {
    xtreamHeaderLaunches: CapturedLaunch[];
};

for (const { player, originOnly } of [
    { player: 'html5', originOnly: false },
    { player: 'mpv', originOnly: false },
    { player: 'html5', originOnly: true },
] as const) {
    for (const action of ['movie Play', 'movie Resume', 'episode'] as const) {
        if (originOnly && action !== 'movie Play') continue;
        test(`@electron @xtream configured stream headers reach ${player} ${action}${originOnly ? ' (Origin only)' : ''}`, async ({
            dataDir,
            request,
        }) => {
            test.setTimeout(120_000);
            await resetMockServers(request, ['xtream']);
            const configuredHeaders: {
                userAgent?: string;
                referrer?: string;
                origin: string;
            } = originOnly
                ? { origin: playbackHeaders.origin }
                : playbackHeaders;
            const portal = await createHeaderGatedPortal(configuredHeaders);
            let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
            try {
                // A permissive fixture cannot make the playback assertion pass.
                expect(
                    (
                        await request.get(`${portal.origin}/movie/fixture.mp4`)
                    ).status()
                ).toBe(403);
                portal.mediaRequests.length = 0;
                app = await launchElectronApp(dataDir, {
                    args: ['--autoplay-policy=no-user-gesture-required'],
                });
                const page = app.mainWindow;
                const electronApp = app.electronApp;
                await openSettings(page);
                await openSettingsSection(page, 'playback');
                await page.getByTestId('select-video-player').click();
                await page.getByTestId(player).click();
                await saveSettings(page);
                await goToDashboard(page);
                await addXtreamPortal(page, {
                    name: 'Synthetic header portal',
                    serverUrl: portal.origin,
                    username: 'minimal',
                    password: 'minimal',
                });
                await waitForXtreamWorkspaceReady(page);
                const playlistId = new URL(page.url()).pathname.match(
                    /xtreams\/([^/]+)/
                )?.[1];
                if (!playlistId)
                    throw new Error('Missing Xtream playlist route');
                // Seed existing saved configuration through real SQLite; playback
                // must read it after reload, without patching a renderer service.
                const saved = await page.evaluate(
                    ({ id, headers }) =>
                        window.electron.dbUpdatePlaylist(id, headers),
                    { id: playlistId, headers: configuredHeaders }
                );
                expect(saved.success).toBe(true);
                await reloadFromMainProcess(app);
                await expectRendererReloadedOnRoute(page, /\/xtreams\//);
                await waitForXtreamWorkspaceReady(page);
                await page
                    .getByRole('link', {
                        name: action === 'episode' ? 'Series' : 'Movies',
                        exact: true,
                    })
                    .click();
                await page.locator('app-grid-list mat-card').first().click();
                await page.waitForURL(/\/(vod|series)\/[^/]+\/[^/]+$/);
                if (action === 'movie Resume') {
                    const id = Number(
                        new URL(page.url()).pathname.split('/').pop()
                    );
                    await page.evaluate(
                        ({ playlistId, id }) =>
                            window.electron.dbSavePlaybackPosition(playlistId, {
                                contentXtreamId: id,
                                contentType: 'vod',
                                positionSeconds: 5,
                                durationSeconds: 30,
                            }),
                        { playlistId: playlistId, id }
                    );
                    await reloadFromMainProcess(app);
                    await expectRendererReloadedOnRoute(
                        page,
                        /\/vod\/[^/]+\/[^/]+$/
                    );
                }
                if (player === 'mpv') {
                    // Stop at the real main-process launch boundary: CI need not
                    // install MPV, while the complete UI descriptor still travels IPC.
                    await electronApp.evaluate(({ ipcMain }) => {
                        const state = globalThis as CaptureGlobal;
                        state.xtreamHeaderLaunches = [];
                        ipcMain.removeHandler('OPEN_MPV_PLAYER');
                        ipcMain.handle(
                            'OPEN_MPV_PLAYER',
                            (
                                _event,
                                url: string,
                                _title: string,
                                _thumbnail: string | undefined,
                                userAgent: string | undefined,
                                referer: string | undefined,
                                origin: string | undefined,
                                contentInfo: CapturedLaunch['contentInfo'],
                                startTime: number | undefined
                            ) => {
                                state.xtreamHeaderLaunches.push({
                                    url,
                                    'user-agent': userAgent,
                                    referer,
                                    origin,
                                    contentInfo,
                                    startTime,
                                });
                            }
                        );
                    });
                }
                const play =
                    action === 'episode'
                        ? page
                              .locator('[data-testid="episode-play-target"]')
                              .first()
                        : page.locator('[data-testid="vod-primary-action"]');
                if (action === 'movie Resume')
                    await expect(play).toContainText('Continue');
                await expect(play).toBeEnabled();
                await play.click();
                if (player === 'mpv') {
                    await expect
                        .poll(() =>
                            electronApp.evaluate(
                                () =>
                                    (globalThis as CaptureGlobal)
                                        .xtreamHeaderLaunches
                            )
                        )
                        .toEqual([
                            expect.objectContaining({
                                'user-agent': playbackHeaders.userAgent,
                                referer: playbackHeaders.referrer,
                                origin: playbackHeaders.origin,
                                ...(action === 'movie Resume'
                                    ? { startTime: 5 }
                                    : {}),
                                contentInfo: expect.objectContaining({
                                    contentType:
                                        action === 'episode'
                                            ? 'episode'
                                            : 'vod',
                                }),
                            }),
                        ]);
                } else {
                    await expect
                        .poll(() => portal.mediaRequests)
                        .toContainEqual(
                            expect.objectContaining({
                                ...(originOnly
                                    ? {}
                                    : {
                                          userAgent:
                                              configuredHeaders.userAgent,
                                          referer: configuredHeaders.referrer,
                                      }),
                                origin: configuredHeaders.origin,
                            })
                        );
                    const video = page
                        .locator('app-portal-inline-player video')
                        .first();
                    await expect
                        .poll(
                            () =>
                                video.evaluate(
                                    (element: HTMLVideoElement) =>
                                        element.currentTime
                                ),
                            { timeout: 20_000 }
                        )
                        .toBeGreaterThan(action === 'movie Resume' ? 5.5 : 0.5);
                    expect(
                        portal.mediaRequests.every((entry) =>
                            entry.path.startsWith(
                                action === 'episode' ? '/series/' : '/movie/'
                            )
                        )
                    ).toBe(true);
                }
            } finally {
                try {
                    if (app) await closeElectronApp(app);
                } finally {
                    await portal.close();
                }
            }
        });
    }
}
