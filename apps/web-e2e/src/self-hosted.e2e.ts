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
    await dialog.getByRole('tab', { name: 'Xtream', exact: true }).click();

    await dialog.locator('#title').fill('Self-hosted Xtream');
    await dialog.locator('#serverUrl').fill(XTREAM_MOCK_SERVER);
    await dialog.locator('#username').fill('user1');
    await dialog.locator('#password').fill('pass1');

    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/xtreams.*vod/);
}

async function addStalkerPortal(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'Stalker', exact: true }).click();

    await setInputValue(dialog.locator('input#title'), 'Self-hosted Stalker');
    await setInputValue(dialog.locator('input#portalUrl'), STALKER_PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), DEFAULT_MAC);

    const addButton = dialog.getByRole('button', { name: 'Add', exact: true });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/stalker.*vod/);
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
    await addXtreamPortal(page);

    const categoryItems = page.locator('.category-item');
    await expect(categoryItems.first()).toBeVisible({ timeout: 15_000 });
});

test('@self-hosted Stalker portal loads through web-backend proxy', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const categoryItems = page.locator('.category-item');
    await expect(categoryItems.first()).toBeVisible({ timeout: 15_000 });
});
