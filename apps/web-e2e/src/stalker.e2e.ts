import {
    type APIRequestContext,
    type Page,
} from '@playwright/test';
import { setInputValue } from './e2e-helpers';
import { expect, test } from './fixtures';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

/**
 * Stalker Portal E2E Tests
 *
 * These tests use the stalker-mock-server (apps/stalker-mock-server) to simulate
 * a real Stalker portal. The mock server starts automatically alongside the Angular
 * dev server when running e2e tests (see playwright.config.ts).
 *
 * Default scenario MAC (00:1A:79:00:00:01) provides:
 *   - 8 categories per content type (VOD / Series / ITV / Radio)
 *   - 40 items per category
 *   - 3 seasons × 8 episodes per series item
 *
 * Tag: @stalker — run only stalker tests with: nx e2e web-e2e --grep "@stalker"
 *
 * SERIAL BY DESIGN: every test here shares one mock-server process whose state
 * (generated data, favorites, portal sessions) is global, and `beforeEach`
 * wipes it with `POST /reset`. Under the workspace-wide `fullyParallel` preset
 * those resets would race each other — and any sibling spec file — so this file
 * pins itself to a single worker. Keep the full-portal authentication tests
 * below in THIS file for the same reason: split across files they would run
 * concurrently again and reset each other's sessions mid-assertion.
 */

test.describe.configure({ mode: 'serial' });

const MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
const MOCK_SERVER = `http://localhost:${MOCK_PORT}`;
const PORTAL_URL = `${MOCK_SERVER}/portal.php`;
/**
 * Canonical Ministra path. `PORTAL_URL` above is classified by the app as a
 * "simple" portal (no handshake, no token, no watchdog); this shape is the
 * authenticated branch, which the mock guards like the real middleware.
 */
const FULL_PORTAL_URL = `${MOCK_SERVER}/stalker_portal/server/load.php`;
const BACKEND_PROXY = `${MOCK_SERVER}/stalker`;

/** Default scenario MAC — balanced catalog, 8 categories, 40 items */
const DEFAULT_MAC = '00:1A:79:00:00:01';

/** Minimal scenario MAC — 2 categories, 5 items (edge case testing) */
const MINIMAL_MAC = '00:1A:79:00:00:03';

/** Embedded-series MAC — 50% of VOD items carry an embedded series[] array */
const EMBEDDED_SERIES_MAC = '00:1A:79:00:00:05';

/** Legacy pagination MAC — portal without get_all_channels support */
const LEGACY_PAGINATION_MAC = '00:1A:79:00:00:06';

/**
 * Dedicated MACs for the full-portal authentication tests. Mock state is keyed
 * by MAC, so keeping these distinct from the content scenarios above means an
 * auth test can never consume or invalidate a session another test relies on.
 * The Infomir OUI matters: the strict endpoint validates the MAC format.
 */
const AUTH_FLOW_MAC = '00:1A:79:AD:00:01';
const AUTH_REAUTH_MAC = '00:1A:79:AD:00:03';
/**
 * Deliberately NOT an Infomir MAC: the strict endpoint rejects get_profile for
 * it, so no token is ever adopted and content requests fail permanently.
 */
const AUTH_REJECTED_MAC = 'AA:BB:CC:DD:EE:01';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Intercept calls to the Angular dev backend (/stalker proxy) and redirect
 * them to the mock server. This avoids needing a real backend or changing
 * any app environment configuration.
 */
async function interceptStalkerRequests(page: Page): Promise<void> {
    const providerTargets = await interceptProviderTargetRegistration(page);

    await page.route('**/localhost:3000/stalker**', async (route) => {
        const originalUrl = new URL(route.request().url());
        const mockUrl = new URL(BACKEND_PROXY);
        const providerUrl = getRegisteredProviderUrl(
            originalUrl,
            providerTargets
        );

        if (providerUrl) {
            mockUrl.searchParams.set('url', providerUrl);
        }

        originalUrl.searchParams.forEach((value, key) => {
            if (key === 'targetId') {
                return;
            }

            mockUrl.searchParams.set(key, value);
        });
        await route.continue({ url: mockUrl.toString() });
    });
}

async function resetMockServer(request: APIRequestContext): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await request.post(`${MOCK_SERVER}/reset`);
            if (response.ok()) {
                return;
            }

            lastError = new Error(
                `Reset failed with status ${response.status()}`
            );
        } catch (error) {
            lastError = error;
        }

        await new Promise((resolve) =>
            setTimeout(resolve, 250 * (attempt + 1))
        );
    }

    throw lastError;
}

/**
 * Add a Stalker portal via the UI:
 * 1. Click the "add playlist" button to open the unified dialog
 * 2. Select "Stalker" toggle
 * 3. Fill in the form and submit
 */
async function addStalkerPortal(
    page: Page,
    options: { name?: string; mac?: string } = {}
): Promise<void> {
    const { name = 'Mock Stalker Portal', mac = DEFAULT_MAC } = options;

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    // v0.22 redesign: tabs were replaced with a flat 5-card radio picker.
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();

    await setInputValue(dialog.locator('input#title'), name);
    await setInputValue(dialog.locator('input#portalUrl'), PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), mac);

    const addButton = dialog.getByRole('button', { name: 'Add', exact: true });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/stalker.*vod/);
}

/**
 * Add a Stalker portal through the canonical Ministra URL, which the app
 * imports as a FULL portal: handshake, Bearer token and watchdog.
 */
async function addFullStalkerPortal(
    page: Page,
    options: { name?: string; mac: string; expectContent?: boolean }
): Promise<void> {
    const { name = 'Full Stalker Portal', mac, expectContent = true } = options;

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();

    await setInputValue(dialog.locator('input#title'), name);
    await setInputValue(dialog.locator('input#portalUrl'), FULL_PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), mac);

    const addButton = dialog.getByRole('button', { name: 'Add', exact: true });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();

    if (expectContent) {
        await page.waitForURL(/stalker.*vod/, { timeout: 30_000 });
    }
}

/** Portal actions the app sent, in order, with the token each carried. */
function recordPortalActions(page: Page): {
    actions: string[];
    tokensByAction: Map<string, string | null>;
} {
    const actions: string[] = [];
    const tokensByAction = new Map<string, string | null>();

    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!url.pathname.endsWith('/stalker')) {
            return;
        }
        const action = url.searchParams.get('action');
        if (!action) {
            return;
        }
        actions.push(action);
        if (!tokensByAction.has(action)) {
            tokensByAction.set(action, url.searchParams.get('token'));
        }
    });

    return { actions, tokensByAction };
}

const CONTENT_ACTIONS = [
    'get_categories',
    'get_genres',
    'get_ordered_list',
    'get_all_channels',
];

/** Every portal request in order, with the token it carried. */
function recordPortalRequests(
    page: Page
): Array<{ action: string; token: string | null }> {
    const requests: Array<{ action: string; token: string | null }> = [];

    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!url.pathname.endsWith('/stalker')) {
            return;
        }
        const action = url.searchParams.get('action');
        if (!action) {
            return;
        }
        requests.push({ action, token: url.searchParams.get('token') });
    });

    return requests;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, request }) => {
    // Reset mock server state (clears in-memory favorites and cache)
    await resetMockServer(request);

    // Playwright creates a fresh browser context per test, so extra
    // IndexedDB cleanup here only risks racing with app-managed DB handles.
    await page.goto('/');

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

    // Default scenario has 8 VOD categories (+ 1 "All categories" prepended by the store)
    const categoryItems = page.locator('.category-item');
    await expect(categoryItems.first()).toBeVisible({ timeout: 10_000 });
    const count = await categoryItems.count();
    expect(count).toBeGreaterThanOrEqual(9);
});

test('@stalker VOD — content list loads after selecting a category', async ({
    page,
}) => {
    await addStalkerPortal(page);

    // Click the first non-"All" category
    const categories = page.locator('.category-item');
    await categories.nth(1).click();

    // Content grid / list should appear with items
    const contentItems = page.locator(
        '.content-card, [data-test-id="channel-item"], mat-card'
    );
    await expect(contentItems).not.toHaveCount(0, { timeout: 10_000 });
    await expect(contentItems.first()).toBeVisible({ timeout: 10_000 });
});

test('@stalker minimal scenario — correct item counts', async ({ page }) => {
    await addStalkerPortal(page, {
        name: 'Minimal Portal',
        mac: MINIMAL_MAC,
    });

    // Minimal scenario: 2 categories (+ "All" = 3 visible)
    const categories = page.locator('.category-item');
    await expect(categories.first()).toBeVisible({ timeout: 10_000 });
    const count = await categories.count();
    // At least 2 real categories
    expect(count).toBeGreaterThanOrEqual(2);
});

test('@stalker PWA hides EPG for ITV channel', async ({ page }) => {
    await addStalkerPortal(page);

    const epgInfoRequests: string[] = [];
    const shortEpgRequests: string[] = [];
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('action=get_epg_info')) {
            epgInfoRequests.push(url);
        }
        if (url.includes('action=get_short_epg')) {
            shortEpgRequests.push(url);
        }
    });

    // Navigate to ITV tab
    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    // ITV view requires an explicit category selection before channels render
    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    // Wait for channels to appear
    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    expect(shortEpgRequests).toHaveLength(0);

    // Click a channel — PWA/browser playback must not expose Electron EPG UI.
    await channels.first().click();
    await expect(channels.first()).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-web-player-view')).toBeVisible({
        timeout: 20_000,
    });
    await expect(page.locator('app-epg-timeline')).toHaveCount(0);
    expect(epgInfoRequests).toHaveLength(0);
    expect(shortEpgRequests).toHaveLength(0);
});

test('@stalker radio — stations use the inline audio player without EPG', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const radioListRequests: string[] = [];
    const epgRequests: string[] = [];
    page.on('request', (request) => {
        const url = request.url();
        if (
            url.includes('type=radio') &&
            url.includes('action=get_ordered_list')
        ) {
            radioListRequests.push(url);
        }
        if (
            url.includes('action=get_epg_info') ||
            url.includes('action=get_short_epg')
        ) {
            epgRequests.push(url);
        }
    });

    await page.getByRole('link', { name: /radio/i }).click();
    await page.waitForURL(/stalker.*radio/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    const stations = page.locator('[data-test-id="channel-item"]');
    await expect(stations.first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => radioListRequests.length).toBeGreaterThan(0);

    await stations.first().click();
    await expect(stations.first()).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-audio-player')).toBeVisible({
        timeout: 20_000,
    });

    await page.getByRole('button', { name: 'Hide channels list' }).click();
    const restoreButton = page.getByRole('button', {
        name: 'Show channels list',
    });
    await expect(restoreButton).toBeVisible();
    await restoreButton.click();
    await expect(stations.first()).toBeVisible();

    await expect(page.locator('app-epg-timeline')).toHaveCount(0);
    expect(epgRequests).toHaveLength(0);
});

test('@stalker PWA skips bulk EPG across channel switches', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const epgInfoRequests: string[] = [];
    const shortEpgRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('action=get_epg_info')) {
            epgInfoRequests.push(request.url());
        }
        if (request.url().includes('action=get_short_epg')) {
            shortEpgRequests.push(request.url());
        }
    });

    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.nth(1)).toBeVisible({ timeout: 20_000 });
    expect(shortEpgRequests).toHaveLength(0);

    await channels.first().click();
    await expect(channels.first()).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-epg-timeline')).toHaveCount(0);

    await channels.nth(1).click();
    await expect(channels.nth(1)).toHaveClass(/active/, { timeout: 20_000 });
    await expect(page.locator('app-epg-timeline')).toHaveCount(0);
    expect(epgInfoRequests).toHaveLength(0);
    expect(shortEpgRequests).toHaveLength(0);
});

test('@stalker ITV full channel list loads via get_all_channels and search covers it', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const allChannelsRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('action=get_all_channels')) {
            allChannelsRequests.push(request.url());
        }
    });
    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });

    // BEFORE any category click (Xtream parity): entering the Live TV section
    // preloads the full list, so the main area shows the paginated
    // all-channels grid and the categories already carry count badges.
    const allItemsGrid = page.locator('app-stalker-itv-all-items');
    await expect(allItemsGrid.locator('mat-card').first()).toBeVisible({
        timeout: 20_000,
    });
    await expect(
        allItemsGrid.locator('.mat-mdc-paginator-range-label')
    ).toContainText('of 320');
    await expect(categories.nth(0).locator('.item-count')).toHaveText('320', {
        timeout: 10_000,
    });
    await expect(categories.nth(1).locator('.item-count')).toHaveText('40');

    await categories.nth(1).click();

    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });

    // Regression for "search only finds the first 14 loaded items": once the
    // full list is cached, the whole category (40 channels) is available
    // without scrolling through 14-item pages.
    await expect(page.locator('.category-subtitle')).toHaveText('40 items', {
        timeout: 20_000,
    });
    await expect.poll(() => allChannelsRequests.length).toBeGreaterThan(0);

    // Regression: switching to another category once the full list is cached
    // must serve that category from the cache, not get stuck on an empty
    // skeleton. (The reset-on-category-change effect used to clobber the
    // synchronously served list.)
    await categories.nth(2).click();
    await expect(page.locator('.category-subtitle')).toHaveText('40 items', {
        timeout: 20_000,
    });
    await expect(channels.first()).toBeVisible({ timeout: 10_000 });
    // No further get_all_channels request — it's served from the session cache.
    const requestsAfterFirstCategory = allChannelsRequests.length;
    await categories.nth(3).click();
    await expect(channels.first()).toBeVisible({ timeout: 10_000 });
    expect(allChannelsRequests.length).toBe(requestsAfterFirstCategory);

    // Back to the first category for the search assertions below.
    await categories.nth(1).click();
    await expect(page.locator('.category-subtitle')).toHaveText('40 items', {
        timeout: 20_000,
    });

    // Search a channel from deep in the list (beyond the first 14 items).
    const deepChannelName = (
        await channels.nth(30).locator('.channel-name').textContent()
    )?.trim();
    expect(deepChannelName).toBeTruthy();

    const searchInput = page.locator('input[type="search"]');
    await searchInput.fill(deepChannelName as string);
    await searchInput.press('Enter');

    await expect(
        page
            .locator('[data-test-id="channel-item"] .channel-name')
            .filter({ hasText: deepChannelName as string })
            .first()
    ).toBeVisible({ timeout: 10_000 });
    // The "loaded only" degraded-search hint must be gone in full-list mode.
    await expect(page.locator('.search-chip--status')).toHaveCount(0);
});

test('@stalker ITV censored category pages from the portal and hides its badge', async ({
    page,
}) => {
    await addStalkerPortal(page);

    const adultListRequests: string[] = [];
    page.on('request', (request) => {
        const url = request.url();
        if (
            url.includes('action=get_ordered_list') &&
            url.includes('type=itv') &&
            url.includes('genre=1099')
        ) {
            adultListRequests.push(url);
        }
    });

    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    // Wait until the full list is cached (a regular category shows its badge).
    await expect(categories.nth(1).locator('.item-count')).toHaveText('40', {
        timeout: 20_000,
    });

    // The censored genre is excluded from get_all_channels, so its real count
    // is unknown — no badge instead of a misleading "0".
    const adultCategory = page.locator('.category-item', {
        hasText: 'For adults',
    });
    await expect(adultCategory).toBeVisible();
    await expect(adultCategory.locator('.item-count')).toHaveCount(0);

    // Clicking it falls back to the legacy paged flow and still shows channels.
    await adultCategory.click();
    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => adultListRequests.length).toBeGreaterThan(0);
});

test('@stalker ITV falls back to page crawling on portals without get_all_channels', async ({
    page,
}) => {
    await addStalkerPortal(page, {
        name: 'Legacy Stalker Portal',
        mac: LEGACY_PAGINATION_MAC,
    });

    const allChannelsRequests: string[] = [];
    const crawlRequests: string[] = [];
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('action=get_all_channels')) {
            allChannelsRequests.push(url);
        }
        // The full-list crawl pages through ALL genres (genre=*).
        if (
            url.includes('action=get_ordered_list') &&
            url.includes('type=itv') &&
            (url.includes('genre=*') || url.includes('genre=%2A'))
        ) {
            crawlRequests.push(url);
        }
    });

    await page.getByRole('link', { name: /live|itv/i }).click();
    await page.waitForURL(/stalker.*itv/);

    const categories = page.locator('.category-item');
    await expect(categories.nth(1)).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();

    const channels = page.locator('[data-test-id="channel-item"]');
    await expect(channels.first()).toBeVisible({ timeout: 20_000 });

    // The crawl collects all 6 × 40 channels; the selected category then
    // shows its full 40 items without manual lazy-load scrolling.
    await expect(page.locator('.category-subtitle')).toHaveText('40 items', {
        timeout: 30_000,
    });
    await expect.poll(() => allChannelsRequests.length).toBeGreaterThan(0);
    expect(crawlRequests.length).toBeGreaterThan(1);
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

test('@stalker mock server returns radio categories and stations', async ({
    request,
}) => {
    const categoriesResponse = await request.get(
        `${MOCK_SERVER}/stalker?action=get_categories&type=radio&macAddress=${DEFAULT_MAC}`
    );
    expect(categoriesResponse.ok()).toBeTruthy();
    const categoriesBody = await categoriesResponse.json();
    expect(categoriesBody.payload.js.length).toBeGreaterThan(0);

    const firstCategory = categoriesBody.payload.js[0].id;
    const stationsResponse = await request.get(
        `${MOCK_SERVER}/stalker?action=get_ordered_list&type=radio&category=${firstCategory}&p=1&macAddress=${DEFAULT_MAC}&JsHttpRequest=1-xml`
    );
    expect(stationsResponse.ok()).toBeTruthy();
    const stationsBody = await stationsResponse.json();
    const firstStation = stationsBody.payload.js.data[0];
    expect(firstStation).toEqual(
        expect.objectContaining({
            category_id: firstCategory,
            radio: true,
        })
    );
});

test('@stalker favorites — embedded-series favorite refreshes newly released episodes', async ({
    page,
    request,
}) => {
    // Find an embedded-series VOD item in the mock catalog first
    const listResponse = await request.get(
        `${MOCK_SERVER}/stalker?action=get_ordered_list&type=vod&category=2001&p=1&macAddress=${EMBEDDED_SERIES_MAC}&JsHttpRequest=1-xml`
    );
    const listBody = await listResponse.json();
    const embeddedItem = listBody.payload.js.data.find(
        (item: { series?: unknown[] }) =>
            Array.isArray(item.series) && item.series.length > 0
    );
    expect(embeddedItem).toBeDefined();
    const episodeCount: number = embeddedItem.series.length;

    await addStalkerPortal(page, {
        name: 'Embedded Series Portal',
        mac: EMBEDDED_SERIES_MAC,
    });

    // Open the embedded-series item from its category and favorite it —
    // this persists a snapshot with the current episode list
    const categories = page.locator('.category-item');
    await expect(categories.first()).toBeVisible({ timeout: 10_000 });
    await categories.nth(1).click();
    const card = page.getByText(embeddedItem.name).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    await expect(
        page.getByRole('heading', {
            name: `${episodeCount}. Episode ${episodeCount}`,
            exact: true,
        })
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    // Wait for the async favorite persistence before navigating away
    await expect(
        page.getByRole('button', { name: 'Remove from favorites' })
    ).toBeVisible({ timeout: 10_000 });

    // From now on the portal has "released" one more episode: extend
    // series[] in every search response (the background snapshot refresh
    // re-fetches the item via a title search)
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const originalUrl = new URL(route.request().url());
        if (!originalUrl.searchParams.get('search')) {
            await route.fallback();
            return;
        }

        const mockUrl = new URL(BACKEND_PROXY);
        const targetId = originalUrl.searchParams.get('targetId');
        const providerUrl = targetId
            ? Buffer.from(targetId, 'base64url').toString()
            : originalUrl.searchParams.get('url');
        if (providerUrl) {
            mockUrl.searchParams.set('url', providerUrl);
        }
        originalUrl.searchParams.forEach((value, key) => {
            if (key === 'targetId') {
                return;
            }
            mockUrl.searchParams.set(key, value);
        });

        const response = await route.fetch({ url: mockUrl.toString() });
        const body = await response.json();
        const rows: { series?: string[] }[] =
            body?.payload?.js?.data ?? body?.js?.data ?? [];
        for (const row of rows) {
            if (Array.isArray(row.series) && row.series.length > 0) {
                row.series = [
                    ...row.series,
                    String(row.series.length + 1),
                ];
            }
        }
        await route.fulfill({ response, body: JSON.stringify(body) });
    });

    // Open the item from the Favorites view: the stored snapshot renders
    // first, then the background refresh patches in the new episode
    const favoritesUrl = new URL(page.url());
    favoritesUrl.pathname = favoritesUrl.pathname.replace(
        /\/vod.*$/,
        '/favorites'
    );
    favoritesUrl.search = '';
    await page.goto(favoritesUrl.toString());

    const favoriteCard = page.getByText(embeddedItem.name).first();
    await expect(favoriteCard).toBeVisible({ timeout: 10_000 });
    await favoriteCard.click();

    // Snapshot episodes are visible immediately…
    await expect(
        page.getByRole('heading', { name: '1. Episode 1', exact: true })
    ).toBeVisible({ timeout: 10_000 });
    // …and the newly released episode appears after the background refresh
    await expect(
        page.getByRole('heading', {
            name: `${episodeCount + 1}. Episode ${episodeCount + 1}`,
            exact: true,
        })
    ).toBeVisible({ timeout: 10_000 });
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

/**
 * Full-portal authentication. The tests above import through the tolerant
 * `/portal.php` alias (simple portal, no auth); these use the canonical
 * Ministra endpoint, which the mock guards like the real middleware:
 *
 *   - every action except handshake/get_profile/get_localization/do_auth needs
 *     `Authorization: Bearer <token>`
 *   - a token only counts once `get_profile` has adopted it
 *   - auth failures come back as HTTP 200 with a plain-text body, never a 401
 */
test.describe('@stalker full portal authentication', () => {
    // Importing a full portal costs a handshake, a profile call and the first
    // content load — on a cold dev server that alone approaches Playwright's
    // 30s default budget.
    test.beforeEach(() => {
        test.setTimeout(90_000);
    });

    test('handshakes and authenticates before loading content', async ({
        page,
    }) => {
        const { actions, tokensByAction } = recordPortalActions(page);

        await addFullStalkerPortal(page, { mac: AUTH_FLOW_MAC });

        // The portal only answers content actions for an adopted token, so
        // reaching the VOD categories at all proves the whole chain ran.
        await expect(page.locator('.category-item').first()).toBeVisible({
            timeout: 30_000,
        });

        expect(actions).toContain('handshake');
        expect(actions).toContain('get_profile');
        expect(actions.indexOf('handshake')).toBeLessThan(
            actions.indexOf('get_profile')
        );

        const contentAction = actions.find((action) =>
            ['get_categories', 'get_genres'].includes(action)
        );
        expect(contentAction).toBeDefined();
        expect(actions.indexOf('get_profile')).toBeLessThan(
            actions.indexOf(contentAction as string)
        );

        // Content requests must carry the token; the handshake must not.
        expect(tokensByAction.get('handshake')).toBeFalsy();
        expect(tokensByAction.get(contentAction as string)).toBeTruthy();

        // The full-portal workflow must also keep the watchdog alive — an
        // authenticated get_events fires immediately (init=1) on activation.
        // Without this assertion the suite would stay green if the watchdog
        // wiring silently died, because its failures are swallowed by design.
        await expect
            .poll(() => actions.includes('get_events'), { timeout: 30_000 })
            .toBe(true);
        expect(tokensByAction.get('get_events')).toBeTruthy();
    });

    test('never surfaces the portal plain-text auth failure as content', async ({
        page,
        request,
    }) => {
        const requests = recordPortalRequests(page);

        // A MAC outside the Infomir OUI makes the strict endpoint answer
        // get_profile with a bare {status:1}, so no token is ever adopted and
        // every content request keeps returning the plain-text failure. Unlike
        // an invalidated session this cannot be repaired by the app's retry,
        // which is what makes the negative assertion below meaningful instead
        // of vacuous.
        const failureBody = await (
            await request.get(
                `${BACKEND_PROXY}?url=${encodeURIComponent(
                    FULL_PORTAL_URL
                )}&macAddress=${encodeURIComponent(
                    AUTH_REJECTED_MAC
                )}&action=get_categories&type=vod`
            )
        ).json();
        expect(failureBody.payload).toBe('Authorization failed.');

        await addFullStalkerPortal(page, {
            mac: AUTH_REJECTED_MAC,
            expectContent: false,
        });

        // The app must have actually hit the failing portal...
        await expect
            .poll(
                () =>
                    requests.filter((entry) =>
                        CONTENT_ACTIONS.includes(entry.action)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // ...and must never render the raw portal response as content. A
        // portal answers auth failures with HTTP 200 + plain text, so an app
        // that trusts the status code would happily paint these strings.
        await expect(page.locator('body')).not.toContainText(
            'Authorization failed.'
        );
        await expect(page.locator('body')).not.toContainText(
            'Unauthorized request.'
        );
    });

    test('re-authenticates after the portal drops the session', async ({
        page,
        request,
    }) => {
        const requests = recordPortalRequests(page);

        await addFullStalkerPortal(page, { mac: AUTH_REAUTH_MAC });

        // The token the initial import authenticated with — recovery must end
        // up on a DIFFERENT one, or nothing was actually re-negotiated.
        const tokenBeforeInvalidation = requests.find(
            (entry) => CONTENT_ACTIONS.includes(entry.action) && entry.token
        )?.token;
        expect(tokenBeforeInvalidation).toBeTruthy();

        // Server-side session loss is what a real expired/replaced token looks
        // like: the next request gets "Authorization failed." with HTTP 200.
        const invalidated = await request.post(
            `${MOCK_SERVER}/invalidate-session?macAddress=${encodeURIComponent(
                AUTH_REAUTH_MAC
            )}`
        );
        expect(invalidated.ok()).toBe(true);

        const requestCountBeforeNavigation = requests.length;

        // Navigating to another content type forces a fresh portal request.
        await page.getByRole('link', { name: /live|itv/i }).click();

        // Recovery is only proven end to end when a CONTENT request goes out
        // under a freshly negotiated token — a re-handshake alone could still
        // leave the original request unreplayed or unauthorized. The mock only
        // answers content for an adopted token, so this doubles as proof the
        // new token was adopted via get_profile.
        await expect
            .poll(
                () =>
                    requests
                        .slice(requestCountBeforeNavigation)
                        .filter(
                            (entry) =>
                                CONTENT_ACTIONS.includes(entry.action) &&
                                entry.token &&
                                entry.token !== tokenBeforeInvalidation
                        ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const recovered = requests.slice(requestCountBeforeNavigation);
        expect(
            recovered.filter((entry) => entry.action === 'handshake').length
        ).toBeGreaterThan(0);

        // And the recovered session must actually render: the ITV categories
        // can only come from an authorized request against the new token.
        await expect(page.locator('.category-item').first()).toBeVisible({
            timeout: 15_000,
        });

        await expect(page.locator('body')).not.toContainText(
            'Authorization failed.'
        );
    });
});
