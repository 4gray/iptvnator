import { createServer, Server } from 'http';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    launchElectronApp,
    LaunchedElectronApp,
    openAddPlaylistDialog,
    test,
    waitForM3uCatalog,
    workspaceRoot,
} from './electron-test-fixtures';

/**
 * DASH + ClearKey playback in the real Electron runtime — the only automated
 * proof that ClearKey EME works in the packaged `file://` renderer (secure
 * context). Uses the shared offline fixtures from apps/web-e2e/src/fixtures.
 */

const FIXTURE_DIR = join(workspaceRoot, 'apps/web-e2e/src/fixtures/dash');

const CLEARKEY_KID = '00112233445566778899aabbccddeeff';
const CLEARKEY_KEY = 'ffeeddccbbaa99887766554433221100';

type DashFixtureServer = {
    close: () => Promise<void>;
    origin: string;
};

/** Serves the DASH fixture directory with HTTP Range support (Shaka fetches
 * init segments and the sidx via byte ranges). */
async function startDashFixtureServer(): Promise<DashFixtureServer> {
    const server: Server = createServer((request, response) => {
        const pathname = (request.url ?? '').split('?')[0];
        const fileName = basename(pathname);
        let body: Buffer;
        try {
            body = readFileSync(join(FIXTURE_DIR, fileName));
        } catch {
            response.writeHead(404);
            response.end('not found');
            return;
        }

        const contentType = fileName.endsWith('.mpd')
            ? 'application/dash+xml'
            : 'video/mp4';
        const range = /bytes=(\d+)-(\d+)?/.exec(
            request.headers.range ?? ''
        );
        if (!range) {
            response.writeHead(200, {
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Content-Length': body.length,
            });
            response.end(body);
            return;
        }

        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : body.length - 1;
        const chunk = body.subarray(start, end + 1);
        response.writeHead(206, {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
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

test('@electron @dash ClearKey DASH plays inline and unsupported DRM surfaces a diagnostic', async ({
    dataDir,
}) => {
    const fixtureServer = await startDashFixtureServer();
    const app = await launchElectronApp(dataDir);

    try {
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
        const banner = app.mainWindow.getByTestId(
            'playback-diagnostic-banner'
        );
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toContainText(/encrypted or DRM-protected/i);
    } finally {
        await closeElectronApp(app);
        await fixtureServer.close();
    }
});
