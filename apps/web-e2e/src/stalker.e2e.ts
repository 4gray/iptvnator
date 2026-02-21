import { expect, Page, test } from '@playwright/test';

/**
 * Stalker Portal E2E Tests
 *
 * These tests use the stalker-mock-server (apps/stalker-mock-server) to simulate
 * a real Stalker portal. The mock server starts automatically alongside the Angular
 * dev server when running e2e tests (see playwright.config.ts).
 *
 * Default scenario MAC (00:1A:79:00:00:01) provides:
 *   - 8 categories per content type (VOD / Series / ITV)
 *   - 40 items per category
 *   - 3 seasons × 8 episodes per series item
 *
 * Tag: @stalker — run only stalker tests with: nx e2e web-e2e --grep "@stalker"
 */

const MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
const MOCK_SERVER = `http://localhost:${MOCK_PORT}`;
const PORTAL_URL = `${MOCK_SERVER}/portal.php`;
const BACKEND_PROXY = `${MOCK_SERVER}/stalker`;

/** Default scenario MAC — balanced catalog, 8 categories, 40 items */
const DEFAULT_MAC = '00:1A:79:00:00:01';

/** Minimal scenario MAC — 2 categories, 5 items (edge case testing) */
const MINIMAL_MAC = '00:1A:79:00:00:03';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Intercept calls to the Angular dev backend (/stalker proxy) and redirect
 * them to the mock server. This avoids needing a real backend or changing
 * any app environment configuration.
 */
async function interceptStalkerRequests(page: Page): Promise<void> {
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const originalUrl = new URL(route.request().url());
        const mockUrl = new URL(BACKEND_PROXY);
        // Forward all query params unchanged
        originalUrl.searchParams.forEach((value, key) => {
            mockUrl.searchParams.set(key, value);
        });
        await route.continue({ url: mockUrl.toString() });
    });
}

/**
 * Add a Stalker portal via the UI:
 * 1. Click the "add playlist" button
 * 2. Click "Stalker Portal Import" in the menu
 * 3. Fill in the form and submit
 */
async function addStalkerPortal(
    page: Page,
    options: { name?: string; mac?: string } = {}
): Promise<void> {
    const { name = 'Mock Stalker Portal', mac = DEFAULT_MAC } = options;

    await page.getByTestId('add-playlist').click();
    await page.getByText('Stalker Portal').click();

    await page.locator('#title').fill(name);
    await page.locator('#portalUrl').fill(PORTAL_URL);
    await page.locator('#macAddress').fill(mac);

    await page.getByRole('button', { name: 'Add' }).click();
    // Wait for dialog to close
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

/**
 * Clear IndexedDB state between tests so each test starts fresh.
 */
async function clearStorage(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const dbs = await window.indexedDB.databases();
        await Promise.all(
            dbs
                .filter((db) => db.name != null)
                .map((db) => window.indexedDB.deleteDatabase(db.name!))
        );
    });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, request }) => {
    // Reset mock server state (clears in-memory favorites and cache)
    await request.post(`${MOCK_SERVER}/reset`);

    await page.goto('/');
    await clearStorage(page);
    await page.reload();

    // Redirect backend proxy calls to the mock server
    await interceptStalkerRequests(page);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@stalker health check — mock server is running', async ({ request }) => {
    const response = await request.get(`${MOCK_SERVER}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
});

test('@stalker add a Stalker portal and see it in the playlist list', async ({
    page,
}) => {
    await addStalkerPortal(page, { name: 'My Test Portal' });

    // Portal card should appear on the home page
    await expect(
        page.getByText('My Test Portal', { exact: false })
    ).toBeVisible();
});

test('@stalker VOD — categories load from mock server', async ({ page }) => {
    await addStalkerPortal(page);

    // Navigate into the portal — click the portal card
    await page.getByText('Mock Stalker Portal').click();

    // Wait for VOD route to load
    await page.waitForURL(/stalker.*vod/);

    // Default scenario has 8 VOD categories (+ 1 "All categories" prepended by the store)
    const categoryItems = page.locator('mat-list-item, [class*="category"]');
    await expect(categoryItems.first()).toBeVisible({ timeout: 10_000 });
    const count = await categoryItems.count();
    expect(count).toBeGreaterThanOrEqual(8);
});

test('@stalker VOD — content list loads after selecting a category', async ({
    page,
}) => {
    await addStalkerPortal(page);
    await page.getByText('Mock Stalker Portal').click();
    await page.waitForURL(/stalker.*vod/);

    // Click the first non-"All" category
    const categories = page.locator('mat-list-item');
    await categories.first().click();

    // Content grid / list should appear with items
    const contentItems = page.locator('[class*="content-item"], mat-card');
    await expect(contentItems.first()).toBeVisible({ timeout: 10_000 });
    const itemCount = await contentItems.count();
    expect(itemCount).toBeGreaterThan(0);
});

test('@stalker minimal scenario — correct item counts', async ({ page }) => {
    await addStalkerPortal(page, {
        name: 'Minimal Portal',
        mac: MINIMAL_MAC,
    });
    await page.getByText('Minimal Portal').click();
    await page.waitForURL(/stalker.*vod/);

    // Minimal scenario: 2 categories (+ "All" = 3 visible)
    const categories = page.locator('mat-list-item');
    await expect(categories.first()).toBeVisible({ timeout: 10_000 });
    const count = await categories.count();
    // At least 2 real categories
    expect(count).toBeGreaterThanOrEqual(2);
});

test('@stalker EPG data loads for ITV channel', async ({ page }) => {
    await addStalkerPortal(page);
    await page.getByText('Mock Stalker Portal').click();
    await page.waitForURL(/stalker.*vod/);

    // Navigate to ITV tab
    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    // Wait for channels to appear
    const channels = page.locator('mat-list-item, [class*="channel"]');
    await expect(channels.first()).toBeVisible({ timeout: 10_000 });

    // Click a channel — EPG info should appear
    await channels.first().click();
    // EPG view should become visible
    await expect(page.locator('[class*="epg"], app-epg-view')).toBeVisible({
        timeout: 10_000,
    });
});

test('@stalker mock server reset clears cached state', async ({ request }) => {
    // Generate data for default MAC
    const before = await request.get(
        `${MOCK_SERVER}/stalker?action=get_categories&type=vod&macAddress=${DEFAULT_MAC}`
    );
    expect(before.ok()).toBeTruthy();

    // Reset
    const reset = await request.post(`${MOCK_SERVER}/reset`);
    expect(reset.ok()).toBeTruthy();

    // Data is regenerated identically (deterministic seed)
    const after = await request.get(
        `${MOCK_SERVER}/stalker?action=get_categories&type=vod&macAddress=${DEFAULT_MAC}`
    );
    const beforeBody = (await before.json()).payload.js;
    const afterBody = (await after.json()).payload.js;
    expect(afterBody).toEqual(beforeBody);
});

test('@stalker create_link returns a playable stream URL', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/stalker?action=create_link&cmd=ffrt4://vod/20001/index.m3u8&macAddress=${DEFAULT_MAC}`
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const streamUrl: string = body.payload.js.cmd;
    expect(streamUrl).toMatch(/^https?:\/\//);
    expect(streamUrl).toMatch(/\.m3u8$/);
});

test('@stalker series — seasons load for a series item', async ({
    request,
}) => {
    // First fetch a series item to get its ID
    const listResponse = await request.get(
        `${MOCK_SERVER}/stalker?action=get_ordered_list&type=series&category=3001&p=1&macAddress=${DEFAULT_MAC}&JsHttpRequest=1-xml`
    );
    const listBody = await listResponse.json();
    const firstItem = listBody.payload.js.data[0];
    expect(firstItem).toBeDefined();

    // Fetch seasons for the first series item
    const seasonsResponse = await request.get(
        `${MOCK_SERVER}/stalker?action=get_ordered_list&type=series&movie_id=${firstItem.id}&macAddress=${DEFAULT_MAC}`
    );
    const seasonsBody = await seasonsResponse.json();
    const seasons = seasonsBody.payload.js;
    expect(Array.isArray(seasons)).toBeTruthy();
    // Default scenario has 3 seasons per series
    expect(seasons.length).toBe(3);
    expect(seasons[0].name).toBe('Season 1');
    expect(Array.isArray(seasons[0].series)).toBeTruthy();
    // Default scenario has 8 episodes per season
    expect(seasons[0].series.length).toBe(8);
});
