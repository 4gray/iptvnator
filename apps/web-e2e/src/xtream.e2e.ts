import { APIRequestContext, test, expect, Page } from '@playwright/test';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

/**
 * Xtream Codes E2E Tests
 *
 * These tests use the xtream-mock-server (apps/xtream-mock-server) to simulate
 * a real Xtream Codes API portal. The mock server starts automatically alongside
 * the Angular dev server when running e2e tests (see playwright.config.ts).
 *
 * Default scenario (user1:pass1) provides:
 *   - 8 categories per content type (live / VOD / series)
 *   - 40 items per category
 *   - 3 seasons × 8 episodes per series item
 *
 * Tag: @xtream — run only Xtream tests with: nx e2e web-e2e --grep "@xtream"
 */

const XTREAM_MOCK_PORT = process.env['XTREAM_MOCK_PORT'] ?? '3211';
const MOCK_SERVER = `http://localhost:${XTREAM_MOCK_PORT}`;

/** Default scenario credentials */
const DEFAULT_USERNAME = 'user1';
const DEFAULT_PASSWORD = 'pass1';
const EPG_USERNAME = 'epg';
const EPG_PASSWORD = 'epg';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Intercept calls from the Angular PWA proxy (/xtream) and redirect them
 * to the mock server. This avoids any real backend requirement.
 */
async function interceptXtreamRequests(page: Page): Promise<void> {
    const providerTargets = await interceptProviderTargetRegistration(page);

    await page.route('**/localhost:3000/xtream**', async (route) => {
        const originalUrl = new URL(route.request().url());
        const mockUrl = new URL(`${MOCK_SERVER}/xtream`);
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

/**
 * Add an Xtream portal via the UI.
 */
async function addXtreamPortal(
    page: Page,
    options: { name?: string; username?: string; password?: string } = {}
): Promise<void> {
    const {
        name = 'Mock Xtream Portal',
        username = DEFAULT_USERNAME,
        password = DEFAULT_PASSWORD,
    } = options;

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'Xtream', exact: true }).click();

    await dialog.locator('#title').fill(name);
    await dialog.locator('#serverUrl').fill(MOCK_SERVER);
    await dialog.locator('#username').fill(username);
    await dialog.locator('#password').fill(password);

    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
    await page.waitForURL(/xtreams.*vod/);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);

    // Playwright creates a fresh browser context per test, so extra
    // IndexedDB cleanup here only risks racing with app-managed DB handles.
    await page.goto('/');

    await interceptXtreamRequests(page);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@xtream health check — mock server is running', async ({ request }) => {
    const response = await request.get(`${MOCK_SERVER}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.server).toBe('xtream-mock-server');
});

test('@xtream get_account_info — active account returns correct fields', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}`
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body.user_info.username).toBe(DEFAULT_USERNAME);
    expect(body.user_info.status).toBe('Active');
    expect(body.server_info.url).toBeDefined();
    expect(Array.isArray(body.user_info.allowed_output_formats)).toBeTruthy();
});

test('@xtream get_account_info — expired account returns Expired status', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=expired&password=expired`
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    // Expired scenario: still returns 'Active' but exp_date is in the past
    // The app's portal-status.service.ts detects expiry via exp_date, not status string
    expect(body.user_info.status).toBe('Active');
    const expDate = new Date(parseInt(body.user_info.exp_date) * 1000);
    expect(expDate.getFullYear()).toBe(2020);
});

test('@xtream get_live_categories — returns expected category count', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_live_categories`
    );
    expect(response.ok()).toBeTruthy();
    const categories = await response.json();
    expect(Array.isArray(categories)).toBeTruthy();
    // Default scenario: 8 live categories
    expect(categories.length).toBe(8);
    expect(categories[0]).toHaveProperty('category_id');
    expect(categories[0]).toHaveProperty('category_name');
});

test('@xtream get_live_streams — streams have required fields', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_live_streams`
    );
    expect(response.ok()).toBeTruthy();
    const streams = await response.json();
    expect(Array.isArray(streams)).toBeTruthy();
    expect(streams.length).toBeGreaterThan(0);

    const first = streams[0];
    expect(first.stream_type).toBe('live');
    expect(first.stream_id).toBeGreaterThan(0);
    expect(first.epg_channel_id).toMatch(/channel-\d+\.mock/);
});

test('@xtream get_vod_streams — streams have rating and container_extension', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_vod_streams`
    );
    expect(response.ok()).toBeTruthy();
    const streams = await response.json();
    expect(Array.isArray(streams)).toBeTruthy();

    const first = streams[0];
    expect(first.stream_type).toBe('movie');
    expect(typeof first.rating).toBe('number');
    expect(['mkv', 'mp4', 'avi']).toContain(first.container_extension);
});

test('@xtream get_series — series list has correct structure', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series`
    );
    expect(response.ok()).toBeTruthy();
    const series = await response.json();
    expect(Array.isArray(series)).toBeTruthy();
    expect(series.length).toBeGreaterThan(0);

    const first = series[0];
    expect(first.series_id).toBeGreaterThan(0);
    expect(typeof first.name).toBe('string');
    expect(typeof first.cover).toBe('string');
    expect(Array.isArray(first.backdrop_path)).toBeTruthy();
});

test('@xtream get_series_info — seasons and episodes present', async ({
    request,
}) => {
    // Get a series ID first
    const listResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series`
    );
    const series = await listResponse.json();
    const firstSeriesId = series[0].series_id;

    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series_info&series_id=${firstSeriesId}`
    );
    expect(response.ok()).toBeTruthy();
    const info = await response.json();

    expect(Array.isArray(info.seasons)).toBeTruthy();
    // Default scenario: 3 seasons per series
    expect(info.seasons.length).toBe(3);
    expect(info.seasons[0].name).toBe('Season 1');

    // Episodes are keyed by season number string
    expect(info.episodes['1']).toBeDefined();
    expect(Array.isArray(info.episodes['1'])).toBeTruthy();
    // Default scenario: 8 episodes per season
    expect(info.episodes['1'].length).toBe(8);
    expect(info.episodes['1'][0].episode_num).toBe(1);
});

test('@xtream get_vod_info — returns full movie details', async ({
    request,
}) => {
    // Get a VOD stream ID first
    const listResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_vod_streams`
    );
    const streams = await listResponse.json();
    const firstVodId = streams[0].stream_id;

    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_vod_info&vod_id=${firstVodId}`
    );
    expect(response.ok()).toBeTruthy();
    const details = await response.json();

    expect(details.info).toBeDefined();
    expect(details.movie_data).toBeDefined();
    expect(details.info.duration_secs).toBeGreaterThan(0);
    expect(details.movie_data.stream_id).toBe(firstVodId);
});

test('@xtream get_short_epg — returns base64-encoded listings', async ({
    request,
}) => {
    // Get a live stream ID first
    const listResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_live_streams`
    );
    const streams = await listResponse.json();
    const streamId = streams[0].stream_id;

    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_short_epg&stream_id=${streamId}`
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(Array.isArray(body.epg_listings)).toBeTruthy();
    expect(body.epg_listings.length).toBeGreaterThan(0);

    const listing = body.epg_listings[0];
    // Verify base64 encoding — decode and check it's valid text
    const decodedTitle = Buffer.from(listing.title, 'base64').toString('utf-8');
    expect(decodedTitle.length).toBeGreaterThan(0);
    expect(listing.start_timestamp).toBeDefined();
    expect(listing.stop_timestamp).toBeDefined();
});

test('@xtream epg fixture — short epg starts at the current program, respects limit, and exposes timestamp-vs-string mismatches', async ({
    request,
}) => {
    const stream = await getEpgFixtureStream(request);

    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${EPG_USERNAME}&password=${EPG_PASSWORD}&action=get_short_epg&stream_id=${stream.stream_id}&limit=2`
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body.epg_listings).toHaveLength(2);

    const [currentListing, nextListing] = body.epg_listings;
    expect(decodeXtreamText(currentListing.title)).toBe('Global Headlines');
    expect(decodeXtreamText(nextListing.title)).toBe('Market Wrap');

    const now = Math.floor(Date.now() / 1000);
    expect(
        Number.parseInt(currentListing.start_timestamp, 10)
    ).toBeLessThanOrEqual(now);
    expect(
        Number.parseInt(currentListing.stop_timestamp, 10)
    ).toBeGreaterThanOrEqual(now);
    expect(currentListing.start).not.toBe(
        formatXtreamDateTime(
            Number.parseInt(currentListing.start_timestamp, 10)
        )
    );
    expect(currentListing.end).not.toBe(
        formatXtreamDateTime(Number.parseInt(currentListing.stop_timestamp, 10))
    );
});

test('@xtream epg fixture — full epg and legacy alias return the same ordered schedule with a midnight boundary program', async ({
    request,
}) => {
    const stream = await getEpgFixtureStream(request);

    const fullResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${EPG_USERNAME}&password=${EPG_PASSWORD}&action=get_simple_data_table&stream_id=${stream.stream_id}`
    );
    const aliasResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${EPG_USERNAME}&password=${EPG_PASSWORD}&action=get_simple_date_table&stream_id=${stream.stream_id}`
    );

    expect(fullResponse.ok()).toBeTruthy();
    expect(aliasResponse.ok()).toBeTruthy();

    const fullBody = await fullResponse.json();
    const aliasBody = await aliasResponse.json();

    expect(aliasBody).toEqual(fullBody);

    const titles = fullBody.epg_listings.map((listing: XtreamRawEpgListing) =>
        decodeXtreamText(listing.title)
    );
    expect(titles).toEqual([
        'Earlier Bulletin',
        'Global Headlines',
        'Market Wrap',
        'Overnight Update',
        'Late Edition',
        'After Midnight',
    ]);

    const boundaryListing = fullBody.epg_listings.find(
        (listing: XtreamRawEpgListing) =>
            decodeXtreamText(listing.title) === 'Late Edition'
    );
    if (!boundaryListing) {
        throw new Error(
            'Expected the full EPG fixture to include Late Edition.'
        );
    }

    const boundaryStart = new Date(
        Number.parseInt(boundaryListing.start_timestamp, 10) * 1000
    );
    const boundaryStop = new Date(
        Number.parseInt(boundaryListing.stop_timestamp, 10) * 1000
    );

    expect(boundaryStart.getUTCDate()).not.toBe(boundaryStop.getUTCDate());
});

test('@xtream reset — data regenerates identically after reset', async ({
    request,
}) => {
    const url = `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_live_categories`;

    const before = await (await request.get(url)).json();
    await request.post(`${MOCK_SERVER}/reset`);
    const after = await (await request.get(url)).json();

    // Data is deterministic: same after reset
    expect(after).toEqual(before);
});

test('@xtream proxy endpoint — returns payload wrapper', async ({
    request,
}) => {
    const response = await request.get(
        `${MOCK_SERVER}/xtream?url=${MOCK_SERVER}&username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_vod_categories`
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body.action).toBe('get_vod_categories');
    expect(Array.isArray(body.payload)).toBeTruthy();
    expect(body.payload.length).toBeGreaterThan(0);
});

test('@xtream category filter — get_live_streams filtered by category_id', async ({
    request,
}) => {
    // Get categories to find a real ID
    const catResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_live_categories`
    );
    const categories = await catResponse.json();
    const categoryId = categories[0].category_id;

    // Fetch streams filtered by that category
    const streamResponse = await request.get(
        `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_live_streams&category_id=${categoryId}`
    );
    const streams = await streamResponse.json();
    expect(Array.isArray(streams)).toBeTruthy();
    expect(streams.length).toBeGreaterThan(0);

    // All returned streams should belong to this category
    for (const s of streams) {
        expect(String(s.category_id)).toBe(String(categoryId));
    }
});

test('@xtream add portal and see it in the playlist list', async ({ page }) => {
    await addXtreamPortal(page, { name: 'My Xtream Test Portal' });

    await expect(
        page.getByText('My Xtream Test Portal', { exact: false })
    ).toBeVisible();
});

test('@xtream minimal scenario — reduced item count', async ({ request }) => {
    const response = await request.get(
        `${MOCK_SERVER}/player_api.php?username=minimal&password=minimal&action=get_live_categories`
    );
    const categories = await response.json();
    // Minimal scenario: 2 categories
    expect(categories.length).toBe(2);

    const streams = await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=minimal&password=minimal&action=get_live_streams`
        )
    ).json();
    // 2 categories × 5 items = 10
    expect(streams.length).toBe(10);
});

type XtreamLiveStream = {
    category_id: string;
    name: string;
    stream_id: number;
};

type XtreamRawEpgListing = {
    end: string;
    start: string;
    start_timestamp: string;
    stop_timestamp: string;
    title: string;
};

async function getEpgFixtureStream(
    request: APIRequestContext
): Promise<XtreamLiveStream> {
    const categories = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${EPG_USERNAME}&password=${EPG_PASSWORD}&action=get_live_categories`
        )
    ).json()) as Array<{ category_id: string; category_name: string }>;

    const epgCategory = categories.find(
        (category) => category.category_name === 'EPG Focus'
    );
    if (!epgCategory) {
        throw new Error('Expected the EPG fixture category to exist.');
    }

    const streams = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${EPG_USERNAME}&password=${EPG_PASSWORD}&action=get_live_streams&category_id=${epgCategory.category_id}`
        )
    ).json()) as XtreamLiveStream[];

    const stream = streams.find((item) => item.name === 'Timezone News');
    if (!stream) {
        throw new Error('Expected the EPG fixture stream to exist.');
    }
    return stream;
}

function decodeXtreamText(value: string): string {
    return Buffer.from(value, 'base64').toString('utf-8');
}

function formatXtreamDateTime(timestampSeconds: number): string {
    return new Date(timestampSeconds * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('.000Z', '');
}
