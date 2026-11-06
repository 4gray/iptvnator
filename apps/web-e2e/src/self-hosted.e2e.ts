import type { Page } from '@playwright/test';
import { createServer } from 'node:http';
import { openSourceEditor, sourceRowByTitle } from './sources-pwa.helpers';
import { postWithRetry, setInputValue } from './e2e-helpers';
import { expect, test } from './fixtures';

const WEB_BACKEND_PORT = process.env['WEB_BACKEND_PORT'] ?? '3333';
const WEB_BACKEND_URL = `http://localhost:${WEB_BACKEND_PORT}`;
const XTREAM_MOCK_PORT = process.env['XTREAM_MOCK_PORT'] ?? '3211';
const STALKER_MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
const XTREAM_MOCK_SERVER = `http://localhost:${XTREAM_MOCK_PORT}`;
const STALKER_MOCK_SERVER = `http://localhost:${STALKER_MOCK_PORT}`;
const STALKER_PORTAL_URL = `${STALKER_MOCK_SERVER}/portal.php`;
// Dedicated MAC: mock state is per-MAC and stalker.e2e.ts runs in a parallel
// worker, so sharing one would let each suite's reset clear the other's state.
const DEFAULT_MAC = '00:1A:79:5F:00:01';

// Runtime config is injected through page.route on every reload. Service
// Worker requests bypass that interceptor; PWA worker coverage has its own suite.
// https://playwright.dev/docs/api/class-page#page-route
test.use({ serviceWorkers: 'block' });

async function installRuntimeConfig(page: Page): Promise<void> {
    await page.route('**/assets/app-config.js', async (route) => {
        await route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(WEB_BACKEND_URL)} };\n`,
        });
    });
}

async function addXtreamPortal(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    // v0.22 redesign: tabs were replaced with a flat 5-card radio picker.
    await dialog.getByRole('radio', { name: /Xtream credentials/i }).click();

    await dialog.locator('#title').fill('Self-hosted Xtream');
    await dialog.locator('#serverUrl').fill(XTREAM_MOCK_SERVER);
    await dialog.locator('#username').fill('user1');
    await dialog.locator('#password').fill('pass1');

    await dialog
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/xtreams.*vod/);
}

async function addM3uPlaylist(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();

    await setInputValue(
        dialog.getByRole('textbox', { name: /Playlist URL/ }),
        `${XTREAM_MOCK_SERVER}/playlist.m3u`
    );
    await setInputValue(
        dialog.getByRole('textbox', { name: 'Playlist title' }),
        'Self-hosted M3U'
    );

    await dialog
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/playlists.*all/);
}

async function addStalkerPortal(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    // v0.22 redesign: tabs were replaced with a flat 5-card radio picker.
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();

    await setInputValue(dialog.locator('input#title'), 'Self-hosted Stalker');
    await setInputValue(dialog.locator('input#portalUrl'), STALKER_PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), DEFAULT_MAC);

    const addButton = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/stalker.*vod/);
}

function collectBackendRequests(page: Page, path: string): string[] {
    const requests: string[] = [];
    page.on('request', (request) => {
        const requestUrl = request.url();
        const url = new URL(requestUrl);
        if (url.origin === WEB_BACKEND_URL && url.pathname === path) {
            requests.push(requestUrl);
        }
    });
    return requests;
}

function expectRequestsUseTargetId(requests: string[], path: string): void {
    expect(requests.length).toBeGreaterThan(0);
    for (const requestUrl of requests) {
        const url = new URL(requestUrl);
        expect(url.pathname).toBe(path);
        expect(url.searchParams.get('targetId')).not.toBeNull();
        expect(url.searchParams.get('targetId')).not.toBe('');
        expect(url.searchParams.has('url')).toBe(false);
    }
}

test.beforeEach(async ({ page, request }) => {
    await postWithRetry(request, `${XTREAM_MOCK_SERVER}/reset?username=user1&password=pass1`);
    // Scope the Stalker reset to the MAC this file uses: a global reset would
    // wipe the sessions of stalker.e2e.ts running in a parallel worker.
    await postWithRetry(
        request,
        `${STALKER_MOCK_SERVER}/reset?macAddress=${encodeURIComponent(
            DEFAULT_MAC
        )}`
    );
    await installRuntimeConfig(page);
    await page.goto('/');
});

test('@self-hosted runtime config points PWA calls at the monorepo backend', async ({
    page,
    request,
}) => {
    await expect
        .poll(() =>
            page.evaluate(() => window.__IPTVNATOR_CONFIG__?.BACKEND_URL)
        )
        .toBe(WEB_BACKEND_URL);

    const response = await request.get(`${WEB_BACKEND_URL}/health`);
    expect(response.ok()).toBeTruthy();
    await expect(response).toBeOK();
});

for (const failure of ['invalid-json', 'storage-denied']) {
    test(`@self-hosted connection recovery remains available after ${failure}`, async ({
        page,
    }) => {
        if (failure === 'invalid-json') {
            await page.evaluate(() =>
                localStorage.setItem('iptvnator:source-server', '{broken')
            );
        } else {
            await page.addInitScript(() => {
                const getItem = Storage.prototype.getItem;
                Storage.prototype.getItem = function (key: string) {
                    if (key === 'iptvnator:source-server')
                        throw new DOMException('Denied', 'SecurityError');
                    return getItem.call(this, key);
                };
            });
        }
        await page.reload();
        const recovery = page.locator(
            '[data-test-id="source-connection-recovery"]'
        );
        await expect(recovery).toBeVisible();
        await recovery
            .getByRole('link', { name: 'Server', exact: true })
            .click();
        await expect(page).toHaveURL(/\/workspace\/settings\/server/);
        await expect(
            page.getByRole('button', { name: 'Connect', exact: true })
        ).toBeVisible();
    });
}

for (const legacy of [false, true]) {
    test(`@self-hosted restores original library after pending discovery (legacy404=${legacy})`, async ({
        page,
    }) => {
        await addM3uPlaylist(page);
        let offline = true;
        await page.route(`${WEB_BACKEND_URL}/v1/instance`, (route) =>
            offline
                ? route.abort('connectionfailed')
                : legacy
                  ? route.fulfill({
                        status: 404,
                        contentType: 'text/html',
                        body: 'Not found',
                    })
                  : route.continue()
        );
        await page.reload();
        const status = page.locator('[data-test-id="source-sync-status"]');
        await expect(status).toContainText('Server unavailable');
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        JSON.parse(
                            localStorage.getItem('iptvnator:source-server') ??
                                'null'
                        )?.instanceId
                )
            )
            .toBe(`pending:${WEB_BACKEND_URL}`);
        offline = false;
        await status
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        await expect(status).toHaveCount(0);
        await page.goto('/workspace/sources');
        await expect(sourceRowByTitle(page, 'Self-hosted M3U')).toBeVisible();
        expect(
            await page.evaluate(() =>
                localStorage.getItem('iptvnator:source-server')
            )
        ).toBeNull();
        expect(
            await page.evaluate(() =>
                localStorage.getItem('iptvnator:source-server-disabled')
            )
        ).toBeNull();
    });
}

test('@self-hosted keeps the original library with a legacy proxy lacking discovery', async ({
    page,
}) => {
    await addM3uPlaylist(page);
    await page.route(`${WEB_BACKEND_URL}/v1/instance`, (route) =>
        route.fulfill({
            status: 404,
            contentType: 'text/html',
            body: 'Not found',
        })
    );
    await page.reload();
    await page.goto('/workspace/sources');
    await expect(sourceRowByTitle(page, 'Self-hosted M3U')).toBeVisible();
    await expect(page.getByTestId('source-sync-status')).toHaveCount(0);
    expect(
        await page.evaluate(() =>
            localStorage.getItem('iptvnator:source-server')
        )
    ).toBeNull();
});

test('@self-hosted Xtream portal loads through web-backend proxy', async ({
    page,
}) => {
    const xtreamRequests = collectBackendRequests(page, '/xtream');
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });

    await addXtreamPortal(page);

    const rail = page.locator('app-workspace-shell-rail');
    await expect(rail.locator('a[aria-label="Movies"]')).toBeVisible();
    await expect(rail.locator('a[aria-label="Live TV"]')).toBeVisible();
    await expect(rail.locator('a[aria-label="Series"]')).toBeVisible();
    await expect(rail.locator('a[aria-label="Recently added"]')).toBeVisible();
    await expect(rail.locator('a[aria-label="Advanced search"]')).toBeVisible();

    const categoryItems = page.locator('.category-item');
    await expect(categoryItems.first()).toBeVisible({ timeout: 15_000 });
    const vodItem = page.locator('app-grid-list mat-card').first();
    await expect(vodItem).toBeVisible({ timeout: 30_000 });
    await vodItem.click();
    await expect(page).toHaveURL(/\/workspace\/xtreams\/[^/]+\/vod\/\d+\/\d+/);
    const primaryAction = page.locator('[data-testid="vod-primary-action"]');
    await expect(primaryAction).toBeVisible({ timeout: 15_000 });
    await expect(primaryAction).toContainText('Play');

    expect(
        consoleErrors.filter((message) =>
            /db(SetAppState|GetContentByXtreamId)/.test(message)
        )
    ).toEqual([]);
    expectRequestsUseTargetId(xtreamRequests, '/xtream');
});

test('@self-hosted M3U URL loads through web-backend proxy', async ({
    page,
}) => {
    const parseRequests = collectBackendRequests(page, '/parse');

    await addM3uPlaylist(page);

    await expect(page.getByText('4 channels')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1. Channel 1')).toBeVisible();
    await expect(page.getByText('4. HappyKids TV')).toBeVisible();
    expectRequestsUseTargetId(parseRequests, '/parse');
});

test('@self-hosted @m3u @epg URL imports retain header guide links through the real backend and reload', async ({
    page,
}) => {
    const provider = createServer((req, res) => {
        if (req.url === '/guide.xml') {
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end('<?xml version="1.0"?><tv></tv>');
        } else {
            res.writeHead(200, {
                'Content-Type': 'application/vnd.apple.mpegurl',
            });
            res.end(
                `#EXTM3U x-tvg-url="http://${req.headers.host}/guide.xml"\n#EXTINF:-1,Synthetic guide channel\nhttps://media.example.test/live`
            );
        }
    });
    await new Promise<void>((resolve) =>
        provider.listen(0, '127.0.0.1', resolve)
    );
    const address = provider.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing provider port');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
        await page.getByRole('button', { name: 'Add playlist' }).click();
        const dialog = page.getByRole('dialog');
        await dialog
            .getByRole('textbox', { name: /Playlist URL/ })
            .fill(`${origin}/playlist.m3u`);
        await dialog
            .getByRole('textbox', { name: 'Playlist title' })
            .fill('Synthetic guide source');
        const parsed = page.waitForResponse((response) =>
            response.url().startsWith(`${WEB_BACKEND_URL}/parse?`)
        );
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect((await parsed).json()).resolves.toMatchObject({
            detectedEpgUrls: [`${origin}/guide.xml`],
            epgUrls: [`${origin}/guide.xml`],
        });
        await page.waitForURL(/playlists.*all/);
        for (let attempt = 0; attempt < 2; attempt++) {
            await page.goto('/workspace/sources');
            const editor = await openSourceEditor(
                page,
                'Synthetic guide source'
            );
            await expect(
                editor.locator('[data-test-id="playlist-epg-detected-count"]')
            ).toHaveText('From playlist: 1 of 1 enabled.');
            await expect(
                editor.locator('[data-epg-source-state="enabled"]')
            ).toHaveCount(1);
            await editor
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            if (attempt === 0) await page.reload();
        }
    } finally {
        provider.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            provider.close((error) => (error ? reject(error) : resolve()))
        );
    }
});

for (const portal of ['Xtream', 'Stalker', 'M3U'] as const) {
    test(`@self-hosted ${portal} recovers a forgotten provider target without a page reload`, async ({ page }) => {
        if (portal === 'Xtream') await addXtreamPortal(page);
        else if (portal === 'Stalker') await addStalkerPortal(page);
        else await addM3uPlaylist(page);
        if (portal !== 'M3U') await expect(page.locator('.category-item').first()).toBeVisible();
        if (portal === 'Xtream') {
            // Import prefetches the catalog; recover through an uncached detail.
            await page.getByRole('link', { name: 'Series', exact: true }).click();
            await expect(
                page.getByRole('heading', { name: 'Series Categories', exact: true })
            ).toBeVisible();
            await page.locator('.category-item').first().click();
            await expect(
                page.locator('app-grid-list mat-card').first()
            ).toBeVisible();
        }
        const origin = new URL(page.url()).origin;
        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        const proxy = portal === 'Xtream' ? 'xtream' : portal === 'Stalker' ? 'stalker' : 'parse';
        let forgotten = true;
        let rejected = 0;
        let registrations = 0;
        page.on('request', (request) => {
            if (request.method() === 'POST' && request.url() === `${WEB_BACKEND_URL}/provider-targets`) {
                registrations++;
                forgotten = false;
            }
        });
        await page.route(`${WEB_BACKEND_URL}/${proxy}?**`, async (route) => {
            if (!forgotten) return route.continue();
            rejected++;
            await route.fulfill({
                status: 404,
                headers: { 'access-control-allow-origin': origin },
                json: { status: 404, message: 'Provider target not found', code: 'PROVIDER_TARGET_NOT_FOUND' },
            });
        });
        const recovered = page.waitForResponse((response) =>
            response.url().startsWith(`${WEB_BACKEND_URL}/${proxy}?`) &&
            response.status() === 200 && registrations > 0
        );
        if (portal === 'M3U') {
            await page.locator('a[href="/workspace/sources"]').first().click();
            const row = sourceRowByTitle(page, 'Self-hosted M3U');
            await row.hover();
            await row.locator('.source-row__refresh').click();
        } else if (portal === 'Xtream') {
            await page.locator('app-grid-list mat-card').first().click();
        } else {
            await page.getByRole('link', { name: 'Series', exact: true }).click();
            await expect(page).toHaveURL(/\/series(?:\/|$)/);
            await expect(
                page.getByRole('heading', { name: 'Series Categories', exact: true })
            ).toBeVisible();
            await expect(page.locator('.category-item').first()).toBeVisible();
            await page.locator('.category-item').first().click();
        }
        await expect((await recovered).json()).resolves.toHaveProperty(portal === 'M3U' ? 'playlist' : 'payload');
        expect(rejected).toBeGreaterThan(0);
        expect(registrations).toBe(1);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    });
}

test('@self-hosted Stalker portal loads through web-backend proxy', async ({
    page,
}) => {
    const stalkerRequests = collectBackendRequests(page, '/stalker');

    await addStalkerPortal(page);

    const categoryItems = page.locator('.category-item');
    await expect(categoryItems.first()).toBeVisible({ timeout: 15_000 });
    expectRequestsUseTargetId(stalkerRequests, '/stalker');
});

test('@self-hosted M3U User-Agent reaches the provider on import and refresh', async ({
    page,
}) => {
    const userAgent = 'IPTVnator-Test/1.0';
    const received: (string | undefined)[] = [];
    let channel = 'Initial UA Channel';
    const server = createServer((req, res) => {
        received.push(req.headers['user-agent']);
        if (req.headers['user-agent'] !== userAgent) {
            res.writeHead(403);
            res.end('User-Agent required');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(
            `#EXTM3U\n#EXTINF:-1,${channel}\nhttps://streams.example.test/news.m3u8\n`
        );
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing test server port');
    const url = `http://127.0.0.1:${address.port}/protected.m3u`;
    try {
        expect((await fetch(url)).status).toBe(403);
        await page.getByRole('button', { name: 'Add playlist' }).click();
        const dialog = page.locator('mat-dialog-container');
        await setInputValue(
            dialog.getByRole('textbox', { name: /Playlist URL/ }),
            url
        );
        await setInputValue(
            dialog.getByRole('textbox', { name: 'Playlist title' }),
            'Protected M3U'
        );
        await dialog
            .locator('[data-test-id="url-advanced-settings"] > summary')
            .click();
        await setInputValue(
            dialog.getByRole('textbox', { name: 'User agent', exact: true }),
            `  ${userAgent}  `
        );
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await page.waitForURL(/playlists.*all/);
        await expect(page.getByText('1. Initial UA Channel')).toBeVisible();
        const catalogUrl = page.url();
        await page.reload();
        await page.goto('/workspace/sources');
        const editor = await openSourceEditor(page, 'Protected M3U');
        await expect(
            editor.getByRole('textbox', { name: 'User agent', exact: true })
        ).toHaveValue(userAgent);
        await editor
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        channel = 'Refreshed UA Channel';
        const row = sourceRowByTitle(page, 'Protected M3U');
        await row.hover();
        await row.locator('.source-row__refresh').click();
        await expect(
            page.locator('.mat-mdc-snack-bar-label').last()
        ).toContainText('updated');
        await page.goto(catalogUrl);
        await expect(page.getByText('1. Refreshed UA Channel')).toBeVisible();
        expect(received.slice(1)).toEqual([userAgent, userAgent]);
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
});
