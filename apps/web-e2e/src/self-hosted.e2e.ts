import type { Page } from '@playwright/test';
import { createServer } from 'node:http';
import { openSourceEditor, sourceRowByTitle } from './sources-pwa.helpers';
import { postWithRetry, setInputValue } from './e2e-helpers';
import { expect, test } from './fixtures';

const WEB_BACKEND_URL = 'http://localhost:3333';
const XTREAM_MOCK_PORT = process.env['XTREAM_MOCK_PORT'] ?? '3211';
const STALKER_MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
const XTREAM_MOCK_SERVER = `http://localhost:${XTREAM_MOCK_PORT}`;
const STALKER_MOCK_SERVER = `http://localhost:${STALKER_MOCK_PORT}`;
const STALKER_PORTAL_URL = `${STALKER_MOCK_SERVER}/portal.php`;
// Dedicated MAC: mock state is per-MAC and stalker.e2e.ts runs in a parallel
// worker, so sharing one would let each suite's reset clear the other's state.
const DEFAULT_MAC = '00:1A:79:5F:00:01';

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
    await dialog
        .getByRole('radio', { name: /Xtream credentials/i })
        .click();

    await dialog.locator('#title').fill('Self-hosted Xtream');
    await dialog.locator('#serverUrl').fill(XTREAM_MOCK_SERVER);
    await dialog.locator('#username').fill('user1');
    await dialog.locator('#password').fill('pass1');

    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
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

    const addButton = dialog.getByRole('button', { name: 'Add', exact: true });
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
    await postWithRetry(request, `${XTREAM_MOCK_SERVER}/reset`);
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
    await expect(
        page.getByRole('button', { name: 'Play', exact: true })
    ).toBeVisible({ timeout: 15_000 });

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
        await row.locator('.refresh-btn').click();
        await expect(page.locator('.mat-mdc-snack-bar-label').last()).toContainText(
            'updated'
        );
        await page.goto(catalogUrl);
        await expect(page.getByText('1. Refreshed UA Channel')).toBeVisible();
        expect(received.slice(1)).toEqual([userAgent, userAgent]);
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
});
