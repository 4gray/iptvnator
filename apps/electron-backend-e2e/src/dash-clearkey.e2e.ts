import { createServer, Server } from 'http';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import type {
    ExternalPlayerName,
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    LaunchedElectronApp,
    openAddPlaylistDialog,
    openSourceEditor,
    openSettings,
    openSettingsSection,
    openSources,
    saveSourceDialog,
    saveSettings,
    sourceRowByTitle,
    test,
    updateSourceDialog,
    waitForM3uCatalog,
    workspaceRoot,
} from './electron-test-fixtures';

/**
 * DASH + ClearKey playback in the real Electron runtime — the only automated
 * proof that ClearKey EME works in the packaged `file://` renderer (secure
 * context). Uses the shared offline fixtures from apps/web-e2e/src/fixtures.
 */

const DASH_FIXTURE_DIR = join(workspaceRoot, 'apps/web-e2e/src/fixtures/dash');
const PLAYBACK_FIXTURE_DIR = join(
    workspaceRoot,
    'apps/web-e2e/src/fixtures/playback'
);

type PlaybackFixture = {
    readonly contentType: string;
    readonly path: string;
};

const FIXTURE_FILES: ReadonlyMap<string, PlaybackFixture> = new Map([
    [
        'clearkey.mpd',
        {
            contentType: 'application/dash+xml',
            path: join(DASH_FIXTURE_DIR, 'clearkey.mpd'),
        },
    ],
    [
        'clearkey-video.mp4',
        {
            contentType: 'video/mp4',
            path: join(DASH_FIXTURE_DIR, 'clearkey-video.mp4'),
        },
    ],
    [
        'clearkey-audio.mp4',
        {
            contentType: 'video/mp4',
            path: join(DASH_FIXTURE_DIR, 'clearkey-audio.mp4'),
        },
    ],
    [
        'unsupported.mkv',
        {
            contentType: 'video/matroska',
            path: join(PLAYBACK_FIXTURE_DIR, 'unsupported.mkv'),
        },
    ],
]);

const CLEARKEY_KID = '00112233445566778899aabbccddeeff';
const CLEARKEY_KEY = 'ffeeddccbbaa99887766554433221100';

type DashFixtureServer = {
    close: () => Promise<void>;
    origin: string;
};

/** Serves the explicit offline fixture allowlist with HTTP Range support
 * (Shaka fetches init segments and the sidx via byte ranges). */
async function startDashFixtureServer(): Promise<DashFixtureServer> {
    const server: Server = createServer((request, response) => {
        const pathname = (request.url ?? '').split('?')[0];
        const fileName = basename(pathname);
        const fixture = FIXTURE_FILES.get(fileName);
        if (!fixture) {
            response.writeHead(404);
            response.end('not found');
            return;
        }
        let body: Buffer;
        try {
            body = readFileSync(fixture.path);
        } catch {
            response.writeHead(404);
            response.end('not found');
            return;
        }

        const range = /bytes=(\d+)-(\d+)?/.exec(request.headers.range ?? '');
        if (!range) {
            response.writeHead(200, {
                'Content-Type': fixture.contentType,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Content-Length': body.length,
            });
            response.end(body);
            return;
        }

        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : body.length - 1;
        const chunk = body.subarray(start, end + 1);
        response.writeHead(206, {
            'Content-Type': fixture.contentType,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Content-Range': `bytes ${start}-${end}/${body.length}`,
            'Content-Length': chunk.length,
        });
        response.end(chunk);
    });

    await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolvePromise();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve dash fixture server address.');
    }

    return {
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolvePromise, reject) => {
                server.close((error) =>
                    error ? reject(error) : resolvePromise()
                );
            }),
    };
}

function buildDashPlaylist(origin: string): string {
    return [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="ck-dash" group-title="DASH",ClearKey DASH',
        '#KODIPROP:inputstream.adaptive.license_type=clearkey',
        `#KODIPROP:inputstream.adaptive.license_key=${CLEARKEY_KID}:${CLEARKEY_KEY}`,
        `${origin}/clearkey.mpd`,
        '#EXTINF:-1 tvg-id="wv-dash" group-title="DASH",Widevine DASH',
        '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
        '#KODIPROP:inputstream.adaptive.license_key=https://license.example.com/wv',
        `${origin}/clearkey.mpd`,
        '#EXTINF:-1 tvg-id="unsupported-mkv" group-title="DASH",Unsupported MKV',
        `${origin}/unsupported.mkv`,
    ].join('\n');
}

async function importDashPlaylistFromText(
    app: LaunchedElectronApp,
    playlist: string
): Promise<void> {
    await openAddPlaylistDialog(app.mainWindow);
    const dialog = app.mainWindow.locator('mat-dialog-container').last();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.locator('textarea').fill(playlist);
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await waitForM3uCatalog(app.mainWindow);
}

type ExternalPlayerIpcArguments = [
    url: string,
    title: string,
    thumbnail: string | undefined,
    userAgent: string | undefined,
    referer: string | undefined,
    origin: string | undefined,
    contentInfo: PlayerContentInfo | undefined,
    startTime: number | undefined,
    headers: Record<string, string> | undefined,
];

type CapturedExternalPlayerLaunch = {
    args: ExternalPlayerIpcArguments;
    player: ExternalPlayerName;
};

type PlaybackRecommendationCaptureSnapshot = {
    closed: string[];
    completed: number;
    launches: CapturedExternalPlayerLaunch[];
    released: boolean;
};

type PlaybackRecommendationCaptureState =
    PlaybackRecommendationCaptureSnapshot & {
        releaseFirstResponse: (() => void) | undefined;
        sessions: Record<string, ExternalPlayerSession>;
        waitForFirstResponse: Promise<void>;
    };

async function installPlaybackRecommendationLaunchCapture(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.evaluate(({ ipcMain }) => {
        let releaseFirstResponse: (() => void) | undefined;
        const waitForFirstResponse = new Promise<void>((resolve) => {
            releaseFirstResponse = resolve;
        });
        const state: PlaybackRecommendationCaptureState = {
            closed: [],
            completed: 0,
            launches: [],
            released: false,
            releaseFirstResponse,
            sessions: {},
            waitForFirstResponse,
        };
        const globalRef = globalThis as typeof globalThis & {
            __playbackRecommendationCapture?: PlaybackRecommendationCaptureState;
        };
        globalRef.__playbackRecommendationCapture = state;

        const captureLaunch =
            (player: ExternalPlayerName) =>
            async (
                rawEvent: unknown,
                url: string,
                title: string,
                thumbnail?: string,
                userAgent?: string,
                referer?: string,
                origin?: string,
                contentInfo?: PlayerContentInfo,
                startTime?: number,
                headers?: Record<string, string>
            ) => {
                const invocation = state.launches.push({
                    args: [
                        url,
                        title,
                        thumbnail,
                        userAgent,
                        referer,
                        origin,
                        contentInfo,
                        startTime,
                        headers,
                    ],
                    player,
                });
                const now = new Date().toISOString();
                const id = `e2e-recommended-${player}-${invocation}`;
                const event = rawEvent as {
                    sender: {
                        send: (
                            channel: string,
                            session: ExternalPlayerSession
                        ) => void;
                    };
                };
                const launching: ExternalPlayerSession = {
                    canClose: true,
                    id,
                    player,
                    startedAt: now,
                    status: 'launching',
                    streamUrl: url,
                    thumbnail: thumbnail ?? null,
                    title,
                    updatedAt: now,
                };
                state.sessions[id] = launching;
                event.sender.send('EXTERNAL_PLAYER_SESSION_UPDATE', launching);

                if (invocation === 1 && !state.released) {
                    await state.waitForFirstResponse;
                }

                state.completed += 1;
                const completed: ExternalPlayerSession = {
                    ...launching,
                    canClose: player === 'mpv',
                    error:
                        player === 'vlc'
                            ? 'E2E player launch failed'
                            : undefined,
                    player,
                    status: player === 'mpv' ? 'opened' : 'error',
                    updatedAt: new Date().toISOString(),
                };
                state.sessions[id] = completed;
                event.sender.send('EXTERNAL_PLAYER_SESSION_UPDATE', completed);
                return completed;
            };

        ipcMain.removeHandler('OPEN_MPV_PLAYER');
        ipcMain.removeHandler('OPEN_VLC_PLAYER');
        ipcMain.handle('OPEN_MPV_PLAYER', captureLaunch('mpv'));
        ipcMain.handle('OPEN_VLC_PLAYER', captureLaunch('vlc'));
        ipcMain.removeHandler('CLOSE_EXTERNAL_PLAYER_SESSION');
        ipcMain.handle(
            'CLOSE_EXTERNAL_PLAYER_SESSION',
            (rawEvent: unknown, sessionId: string) => {
                const session = state.sessions[sessionId];
                if (!session) return null;
                const closed: ExternalPlayerSession = {
                    ...session,
                    canClose: false,
                    status: 'closed',
                    updatedAt: new Date().toISOString(),
                };
                state.closed.push(sessionId);
                state.sessions[sessionId] = closed;
                const event = rawEvent as {
                    sender: {
                        send: (
                            channel: string,
                            update: ExternalPlayerSession
                        ) => void;
                    };
                };
                event.sender.send('EXTERNAL_PLAYER_SESSION_UPDATE', closed);
                return closed;
            }
        );
    });
}

async function getPlaybackRecommendationCapture(
    app: LaunchedElectronApp
): Promise<PlaybackRecommendationCaptureSnapshot> {
    return app.electronApp.evaluate(() => {
        const globalRef = globalThis as typeof globalThis & {
            __playbackRecommendationCapture?: PlaybackRecommendationCaptureState;
        };
        const capture = globalRef.__playbackRecommendationCapture;
        if (!capture) {
            throw new Error(
                'Playback recommendation capture is not installed.'
            );
        }
        return {
            closed: capture.closed,
            completed: capture.completed,
            launches: capture.launches,
            released: capture.released,
        };
    });
}

async function releasePlaybackRecommendationCapture(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.evaluate(() => {
        const globalRef = globalThis as typeof globalThis & {
            __playbackRecommendationCapture?: PlaybackRecommendationCaptureState;
        };
        const capture = globalRef.__playbackRecommendationCapture;
        if (!capture || capture.released) {
            return;
        }
        capture.released = true;
        capture.releaseFirstResponse?.();
        capture.releaseFirstResponse = undefined;
    });
}

for (const player of ['mpv', 'vlc']) {
    test(`@electron @dash fullscreen panel keeps DASH inline with ${player} configured`, async ({
        dataDir,
    }) => {
        const fixtureServer = await startDashFixtureServer();
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'playback');
            await page.getByTestId('select-video-player').click();
            await page.getByTestId(player).click();
            await saveSettings(page);
            await goToDashboard(page);
            const playlist = [
                buildDashPlaylist(fixtureServer.origin),
                '#EXTINF:-1 group-title="DASH",Next ClearKey DASH',
                '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                `#KODIPROP:inputstream.adaptive.license_key=${CLEARKEY_KID}:${CLEARKEY_KEY}`,
                `${fixtureServer.origin}/clearkey.mpd?next=1`,
            ].join('\n');
            await importDashPlaylistFromText(app, playlist);
            await channelItemByTitle(page, 'ClearKey DASH').first().click();
            const video = page.locator('app-web-player-view video').first();
            await expect(video).toBeVisible();
            await expect
                .poll(() =>
                    video.evaluate((el: HTMLVideoElement) => el.currentTime)
                )
                .toBeGreaterThan(0.5);
            await page
                .getByRole('button', { name: 'Enter fullscreen' })
                .click();
            const isFullscreen = () =>
                page.evaluate(() => document.fullscreenElement !== null);
            await expect.poll(isFullscreen).toBe(true);
            await page.keyboard.press('c');
            const panel = page.getByTestId('fullscreen-channel-panel');
            await expect(panel).toHaveAttribute('aria-hidden', 'false');
            await expect(
                panel.getByText('Unsupported MKV', { exact: false })
            ).toHaveCount(0);
            const nextChannel = panel
                .getByTestId('channel-item')
                .filter({ hasText: 'Next ClearKey DASH' });
            await nextChannel.click();
            await expect(nextChannel).toHaveClass(/\bactive\b/);
            await expect.poll(isFullscreen).toBe(true);
            await expect
                .poll(() =>
                    video.evaluate((el: HTMLVideoElement) => el.currentTime)
                )
                .toBeGreaterThan(0.5);
            expect(await isFullscreen()).toBe(true);
        } finally {
            await closeElectronApp(app);
            await fixtureServer.close();
        }
    });
}

test('@electron @dash ClearKey DASH filters DRM fallback and reports external launch states', async ({
    dataDir,
}) => {
    const fixtureServer = await startDashFixtureServer();
    const app = await launchElectronApp(dataDir);

    try {
        const unsupportedFixtureResponse = await app.mainWindow.evaluate(
            async (url) => {
                const response = await fetch(url);
                const body = await response.text();
                return {
                    body,
                    bodyBytes: new TextEncoder().encode(body).byteLength,
                    contentLength: response.headers.get('content-length'),
                    contentType: response.headers.get('content-type'),
                    rendererProtocol: window.location.protocol,
                    status: response.status,
                };
            },
            `${fixtureServer.origin}/unsupported.mkv`
        );
        expect(unsupportedFixtureResponse).toEqual({
            body: 'This fixture intentionally declares Matroska without playable media bytes.\n',
            bodyBytes: 75,
            contentLength: '75',
            contentType: 'video/matroska',
            rendererProtocol: 'file:',
            status: 200,
        });

        await importDashPlaylistFromText(
            app,
            buildDashPlaylist(fixtureServer.origin)
        );

        // Happy path: ClearKey EME decrypts and playback advances.
        await channelItemByTitle(app.mainWindow, 'ClearKey DASH')
            .first()
            .click();
        const video = app.mainWindow
            .locator('app-web-player-view video')
            .first();
        await expect(video).toBeVisible({ timeout: 15_000 });
        await expect
            .poll(
                () =>
                    video.evaluate(
                        (element: HTMLVideoElement) => element.currentTime
                    ),
                { timeout: 20_000 }
            )
            .toBeGreaterThan(0.5);
        await expect(
            app.mainWindow.getByTestId('playback-diagnostic-banner')
        ).toBeHidden();

        // Negative: an unsupported license type must not crash — it shows the
        // DRM diagnostic instead.
        await channelItemByTitle(app.mainWindow, 'Widevine DASH')
            .first()
            .click();
        const banner = app.mainWindow.getByTestId('playback-diagnostic-banner');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toContainText(/encrypted or DRM-protected/i);
        await expect(
            banner.locator('[data-test-id="playback-fallback-mpv"]')
        ).toHaveCount(0);
        await expect(
            banner.locator('[data-test-id="playback-fallback-vlc"]')
        ).toHaveCount(0);
        await expect(
            banner.locator('[data-test-id^="playback-recommendation-"]')
        ).toHaveCount(0);
        const widevineDetails = banner.locator(
            '[data-test-id="playback-diagnostic-details"]'
        );
        await widevineDetails.locator('summary').click();
        await expect(widevineDetails).toContainText('drm-or-encryption');

        await installPlaybackRecommendationLaunchCapture(app);
        await channelItemByTitle(app.mainWindow, 'Unsupported MKV')
            .first()
            .click();
        await expect(banner).toContainText(
            /container is likely unsupported by the browser player/i,
            { timeout: 15_000 }
        );
        const mkvDetails = banner.locator(
            '[data-test-id="playback-diagnostic-details"]'
        );
        await mkvDetails.locator('summary').click();
        await expect(mkvDetails).toContainText('unsupported-container');

        const mpvFallback = banner.locator(
            '[data-test-id="playback-fallback-mpv"]'
        );
        const vlcFallback = banner.locator(
            '[data-test-id="playback-fallback-vlc"]'
        );
        await expect(mpvFallback).toBeVisible();
        await expect(vlcFallback).toBeVisible();
        await expect(mpvFallback).toHaveClass(
            /web-player-diagnostic__player-card--primary/
        );
        await expect(vlcFallback).not.toHaveClass(
            /web-player-diagnostic__player-card--primary/
        );

        // Blank channel-level #EXTVLCOPT values resolve to `undefined` (not
        // empty strings) since the playlist-level header fallback landed —
        // absent means absent on the IPC boundary.
        const expectedLaunches = [
            {
                args: [
                    `${fixtureServer.origin}/unsupported.mkv`,
                    'Unsupported MKV',
                    '',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                ],
                player: 'mpv',
            },
        ] satisfies CapturedExternalPlayerLaunch[];
        expect(await getPlaybackRecommendationCapture(app)).toEqual({
            closed: [],
            completed: 0,
            launches: [],
            released: false,
        });

        await mpvFallback.click();
        await expect
            .poll(() => getPlaybackRecommendationCapture(app), {
                timeout: 10_000,
            })
            .toEqual({
                closed: [],
                completed: 0,
                launches: expectedLaunches,
                released: false,
            });
        await expect(mpvFallback).toBeVisible();
        await expect(vlcFallback).toBeVisible();
        await expect(mpvFallback).toContainText('Opening MPV');
        await expect(mpvFallback).toContainText('Opening player');
        await expect(mpvFallback).toHaveAttribute('aria-busy', 'true');
        await expect(vlcFallback).toHaveAttribute('aria-disabled', 'true');
        await vlcFallback.evaluate((button: HTMLButtonElement) =>
            button.click()
        );
        await expect
            .poll(() => getPlaybackRecommendationCapture(app))
            .toEqual({
                closed: [],
                completed: 0,
                launches: expectedLaunches,
                released: false,
            });
        const dock = app.mainWindow.locator('app-external-playback-dock');
        await expect(dock).toContainText('Opening player');
        await expect(dock.locator('.external-playback-dock')).toHaveAttribute(
            'aria-busy',
            'true'
        );

        await releasePlaybackRecommendationCapture(app);
        await expect
            .poll(() => getPlaybackRecommendationCapture(app), {
                timeout: 10_000,
            })
            .toEqual({
                closed: [],
                completed: 1,
                launches: expectedLaunches,
                released: true,
            });
        await app.mainWindow.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    );
                })
        );
        expect(await getPlaybackRecommendationCapture(app)).toEqual({
            closed: [],
            completed: 1,
            launches: expectedLaunches,
            released: true,
        });
        await expect(mpvFallback).toBeVisible();
        await expect(mpvFallback).toContainText('Open MPV again');
        await expect(mpvFallback).toContainText('Player started');
        await expect(vlcFallback).toHaveClass(
            /web-player-diagnostic__player-card--primary/
        );
        await expect(dock).toContainText('Player started');
        const dockThemeStyles = await dock
            .locator('.external-playback-dock')
            .evaluate((element) => {
                const body = element.ownerDocument.body;
                const wasDark = body.classList.contains('dark-theme');
                const read = () => {
                    const style = getComputedStyle(element);
                    return {
                        borderColor: style.borderColor,
                        color: style.color,
                        onSurface: style
                            .getPropertyValue('--app-heading-color')
                            .trim(),
                        surface: style
                            .getPropertyValue('--app-widget-bg')
                            .trim(),
                    };
                };
                body.classList.remove('dark-theme');
                const light = read();
                body.classList.add('dark-theme');
                const dark = read();
                body.classList.toggle('dark-theme', wasDark);
                return { dark, light };
            });
        expect(dockThemeStyles.light.surface).not.toBe('');
        expect(dockThemeStyles.dark.surface).not.toBe('');
        expect(dockThemeStyles.light.onSurface).not.toBe('');
        expect(dockThemeStyles.dark.onSurface).not.toBe('');
        expect(dockThemeStyles.light).not.toEqual(dockThemeStyles.dark);

        await vlcFallback.click();
        const expectedBothLaunches = [
            ...expectedLaunches,
            { ...expectedLaunches[0], player: 'vlc' as const },
        ];
        await expect
            .poll(() => getPlaybackRecommendationCapture(app), {
                timeout: 10_000,
            })
            .toEqual({
                closed: ['e2e-recommended-mpv-1'],
                completed: 2,
                launches: expectedBothLaunches,
                released: true,
            });
        await expect(mpvFallback).toBeVisible();
        await expect(vlcFallback).toBeVisible();
        await expect(vlcFallback).toContainText('Try VLC again');
        await expect(vlcFallback).toContainText('External player error');
        await expect(mpvFallback).toHaveClass(
            /web-player-diagnostic__player-card--primary/
        );
        await expect(dock).toContainText('E2E player launch failed');
        await expect(
            dock.getByRole('button', { name: 'Dismiss' })
        ).toBeVisible();
        await dock.getByRole('button', { name: 'Dismiss' }).click();
        await expect(dock).toBeHidden();

        // Playlist-level custom headers must cross the IPC boundary when the
        // channel itself carries no #EXTVLCOPT values (#1221): set a
        // User-Agent on the source, relaunch the MPV fallback, and expect the
        // captured launch to carry it.
        await openSources(app.mainWindow);
        const sourceDialog = await openSourceEditor(
            app.mainWindow,
            'Imported as text'
        );
        await updateSourceDialog(sourceDialog, {
            userAgent: 'Playlist Agent E2E/1.0',
        });
        await saveSourceDialog(app.mainWindow, sourceDialog);
        await sourceRowByTitle(app.mainWindow, 'Imported as text')
            .first()
            .click();
        await waitForM3uCatalog(app.mainWindow);

        await channelItemByTitle(app.mainWindow, 'Unsupported MKV')
            .first()
            .click();
        await expect(banner).toContainText(
            /container is likely unsupported by the browser player/i,
            { timeout: 15_000 }
        );
        await expect(mpvFallback).toBeVisible();
        await mpvFallback.click();
        const expectedPlaylistHeaderLaunch = {
            args: [
                `${fixtureServer.origin}/unsupported.mkv`,
                'Unsupported MKV',
                '',
                'Playlist Agent E2E/1.0',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            ],
            player: 'mpv',
        } satisfies CapturedExternalPlayerLaunch;
        await expect
            .poll(() => getPlaybackRecommendationCapture(app), {
                timeout: 10_000,
            })
            .toEqual({
                closed: ['e2e-recommended-mpv-1'],
                completed: 3,
                launches: [
                    ...expectedBothLaunches,
                    expectedPlaylistHeaderLaunch,
                ],
                released: true,
            });
    } finally {
        await releasePlaybackRecommendationCapture(app).catch(() => undefined);
        await closeElectronApp(app);
        await fixtureServer.close();
    }
});
