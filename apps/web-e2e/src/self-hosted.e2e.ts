import { expect, type Locator, type Page, test } from '@playwright/test';

const WEB_BACKEND_URL = 'http://localhost:3333';
const XTREAM_MOCK_PORT = process.env['XTREAM_MOCK_PORT'] ?? '3211';
const STALKER_MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
const XTREAM_MOCK_SERVER = `http://localhost:${XTREAM_MOCK_PORT}`;
const STALKER_MOCK_SERVER = `http://localhost:${STALKER_MOCK_PORT}`;
const STALKER_PORTAL_URL = `${STALKER_MOCK_SERVER}/portal.php`;
const DEFAULT_MAC = '00:1A:79:00:00:01';

async function installRuntimeConfig(page: Page): Promise<void> {
    await page.route('**/assets/app-config.js', async (route) => {
        await route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(WEB_BACKEND_URL)} };\n`,
        });
    });
}

async function setInputValue(input: Locator, value: string): Promise<void> {
    await input.fill('');
    await input.fill(value);

    if ((await input.inputValue()) === value) {
        return;
    }

    await input.click();
    await input.press('ControlOrMeta+A');
    await input.press('Backspace');
    await input.type(value);
    await expect(input).toHaveValue(value);
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
    await request.post(`${XTREAM_MOCK_SERVER}/reset`);
    await request.post(`${STALKER_MOCK_SERVER}/reset`);
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
