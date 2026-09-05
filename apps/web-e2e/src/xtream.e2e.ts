import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { setInputValue, waitForScrollIdle } from './e2e-helpers';
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
    // v0.22 redesign: tabs were replaced with a flat 5-card radio picker.
    await dialog.getByRole('radio', { name: /Xtream credentials/i }).click();

    await setInputValue(dialog.locator('#title'), name);
    await setInputValue(dialog.locator('#serverUrl'), MOCK_SERVER);
    await setInputValue(dialog.locator('#username'), username);
    await setInputValue(dialog.locator('#password'), password);

    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
    await page.waitForURL(/xtreams.*vod/);
}

async function openPlaylistDetailsDialog(page: Page, title: string) {
    const playlistSettingsButton = page.getByRole('button', {
        name: 'Playlist Settings',
    });

    if (await playlistSettingsButton.isVisible()) {
        await playlistSettingsButton.click();
    } else {
        await page
            .locator('app-playlist-switcher .playlist-switcher-trigger')
            .click();

        const switcherMenu = page.getByRole('menu').filter({ hasText: title });
        const sourceRow = switcherMenu
            .locator('.playlist-item')
            .filter({ hasText: title })
            .first();
        await expect(sourceRow).toBeVisible();
        await sourceRow
            .getByRole('button', { name: 'Playlist actions' })
            .click();
        await page.getByRole('menuitem', { name: 'Playlist info' }).click();
    }

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    return dialog;
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

test('@xtream playlist details edit is retained in the PWA browser context', async ({
    page,
}) => {
    await addXtreamPortal(page, { name: 'Editable PWA Xtream Portal' });

    let dialog = await openPlaylistDetailsDialog(
        page,
        'Editable PWA Xtream Portal'
    );
    await setInputValue(
        dialog.locator('input[formcontrolname="title"]'),
        'Edited PWA Xtream Portal'
    );
    await setInputValue(
        dialog.locator('input[formcontrolname="serverUrl"]'),
        MOCK_SERVER
    );
    await setInputValue(
        dialog.locator('input[formcontrolname="username"]'),
        'minimal'
    );
    await setInputValue(
        dialog.locator('input[formcontrolname="password"]'),
        'minimal'
    );
    await dialog
        .locator('mat-dialog-actions')
        .getByRole('button', { name: 'Save', exact: true })
        .click();
    await expect(dialog).toBeHidden();

    await expect(
        page.getByText('Edited PWA Xtream Portal', { exact: false })
    ).toBeVisible();

    dialog = await openPlaylistDetailsDialog(page, 'Edited PWA Xtream Portal');
    await expect(dialog.locator('input[formcontrolname="title"]')).toHaveValue(
        'Edited PWA Xtream Portal'
    );
    await expect(
        dialog.locator('input[formcontrolname="serverUrl"]')
    ).toHaveValue(MOCK_SERVER);
    await expect(
        dialog.locator('input[formcontrolname="username"]')
    ).toHaveValue('minimal');
    await expect(
        dialog.locator('input[formcontrolname="password"]')
    ).toHaveValue('minimal');
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

// ---------------------------------------------------------------------------
// Player engine selection on the live route
//
// The Xtream live layout mounts app-web-player-view WITHOUT a playerOverride,
// so the engine must track the saved player setting live. Regression guarded:
// the engine used to come from a one-shot storage snapshot taken at mount, so
// a command-palette switch confirmed via snackbar and persisted the setting
// while the mounted player silently kept the previous engine.
// ---------------------------------------------------------------------------

async function openLiveChannel(page: Page): Promise<void> {
    await page.goto(page.url().replace(/\/vod.*$/, '/live'));

    // On the live root the category click updates store state without
    // navigating; the channel sidebar appearing is the completion signal.
    const firstCategory = page.locator('.context-panel .category-item').first();
    await expect(firstCategory).toBeVisible();
    await firstCategory.click();

    const channel = page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .first();
    await expect(channel).toBeVisible();
    await channel.click();
}

test('@xtream command palette player switch reaches the mounted live player', async ({
    page,
}) => {
    await addXtreamPortal(page);
    await openLiveChannel(page);

    const playerView = page.locator('app-web-player-view');
    await expect(playerView.locator('app-vjs-player')).toBeVisible({
        timeout: 15_000,
    });

    // Tag the mounted layout so the final assertion proves the switch reached
    // the EXISTING player instead of surviving through a layout remount.
    await page.locator('app-live-stream-layout').evaluate((el) => {
        (el as HTMLElement & { __e2eSameMount?: boolean }).__e2eSameMount =
            true;
    });

    await page.keyboard.press('Control+k');
    const palette = page.locator('.workspace-command-palette-overlay');
    await expect(palette).toBeVisible();
    await palette.locator('input[type="search"]').fill('html5');
    await palette
        .getByRole('button', { name: 'Switch player to HTML5 video player' })
        .click();

    await expect(playerView.locator('app-html-video-player')).toBeVisible({
        timeout: 15_000,
    });
    await expect(playerView.locator('app-vjs-player')).toHaveCount(0);
    expect(
        await page
            .locator('app-live-stream-layout')
            .evaluate(
                (el) =>
                    (el as HTMLElement & { __e2eSameMount?: boolean })
                        .__e2eSameMount
            )
    ).toBe(true);
});

test('@xtream the saved engine mounts the live player first time — no default-engine flash', async ({
    page,
}) => {
    // Persist HTML5 as the saved player before any player ever mounts.
    await page.goto('/workspace/settings/playback');
    await page.locator('[data-test-id="select-video-player"]').click();
    await page
        .getByRole('option', { name: 'HTML5 video player', exact: true })
        .click();
    const saveButton = page.getByRole('button', { name: 'Save changes' });
    await saveButton.click();
    await expect(saveButton).toBeHidden();

    await page.goto('/');
    await addXtreamPortal(page);
    await page.goto(page.url().replace(/\/vod.*$/, '/live'));
    const firstCategory = page.locator('.context-panel .category-item').first();
    await expect(firstCategory).toBeVisible();
    await firstCategory.click();

    // Record every engine that is ever attached. A polling assertion cannot
    // see the defect this guards: mounting Video.js first and correcting to
    // the saved engine once the async settings read lands leaves the same
    // final DOM.
    await page.evaluate(() => {
        const seen = new Set<string>();
        (window as unknown as { __enginesSeen: Set<string> }).__enginesSeen =
            seen;
        const record = () => {
            for (const selector of [
                'app-vjs-player',
                'app-html-video-player',
            ]) {
                if (document.querySelector(selector)) {
                    seen.add(selector);
                }
            }
        };
        record();
        new MutationObserver(record).observe(document.body, {
            childList: true,
            subtree: true,
        });
    });

    const channel = page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .first();
    await expect(channel).toBeVisible();
    await channel.click();

    await expect(
        page.locator('app-web-player-view app-html-video-player')
    ).toBeVisible({ timeout: 15_000 });
    expect(
        await page.evaluate(() => [
            ...(window as unknown as { __enginesSeen: Set<string> })
                .__enginesSeen,
        ])
    ).toEqual(['app-html-video-player']);
});

// ---------------------------------------------------------------------------
// Season-level watched toggle on the serial details page
//
// The season header exposes a bulk toggle (note: data-test-id with a dash —
// getByTestId only matches data-testid in this suite) that writes
// full-progress playback positions for every unwatched episode of the
// selected season and clears them again on the second click. The PWA
// persists positions to localStorage, so the state must survive a reload.
// ---------------------------------------------------------------------------

test('@xtream season watched toggle — marks a season, survives reload, and clears again', async ({
    page,
    request,
}) => {
    // Resolve a concrete series (category + name) from the mock so the card
    // click below targets a known item of the default scenario.
    const categories = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series_categories`
        )
    ).json()) as Array<{ category_id: string; category_name: string }>;
    const category = categories[0];

    const seriesItems = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series&category_id=${category.category_id}`
        )
    ).json()) as Array<{ name: string; series_id: number }>;
    const targetSeries = seriesItems[0];

    await addXtreamPortal(page);
    await page.goto(page.url().replace(/\/vod.*$/, '/series'));

    const categoryItem = page
        .locator('.context-panel .category-item')
        .filter({ hasText: category.category_name })
        .first();
    await expect(categoryItem).toBeVisible({ timeout: 10_000 });
    await categoryItem.click();

    const seriesCard = page
        .locator('app-grid-list mat-card')
        .filter({ hasText: targetSeries.name })
        .first();
    await expect(seriesCard).toBeVisible({ timeout: 10_000 });
    await seriesCard.click();

    // Serial details: default scenario has 3 seasons × 8 episodes and no
    // playback positions yet, so season 1 is auto-selected fully unwatched.
    const seasonToggle = page.locator('[data-test-id="toggle-season-watched"]');
    await expect(seasonToggle).toBeVisible({ timeout: 15_000 });
    await expect(seasonToggle).toContainText('Mark season as watched (8)');

    const episodeCards = page.locator('.episode-card');
    await expect(episodeCards).toHaveCount(8, { timeout: 10_000 });
    const watchedCards = page.locator('.episode-card--watched');
    await expect(watchedCards).toHaveCount(0);

    await seasonToggle.click();

    // Full-progress rows land for all 8 episodes: the button flips, every
    // episode card gets the watched state, and the per-episode toggles show
    // the filled check.
    await expect(seasonToggle).toContainText('Mark season as unwatched', {
        timeout: 15_000,
    });
    await expect(watchedCards).toHaveCount(8);
    await expect(
        page.locator(
            '[data-testid="episode-watched-toggle"].episode-card__watched-toggle--watched'
        )
    ).toHaveCount(8);

    // The selected season's tab shows the completed check; the untouched
    // seasons stay unmarked.
    const seasonTabs = page.locator('.season-tabs__pill');
    await expect(seasonTabs).toHaveCount(3);
    await expect(
        seasonTabs.first().locator('.season-tabs__done')
    ).toBeVisible();
    await expect(seasonTabs.nth(1).locator('.season-tabs__done')).toHaveCount(
        0
    );

    // PWA persistence: positions live in localStorage, so a reload of the
    // detail route must come back fully watched. With season 1 completed the
    // fresh mount auto-selects the earliest season with unwatched episodes
    // (issue #1441), so season 2 opens while season 1's tab keeps the check.
    await page.reload();
    await expect(seasonToggle).toBeVisible({ timeout: 20_000 });
    await expect(seasonToggle).toContainText('Mark season as watched (8)');
    await expect(watchedCards).toHaveCount(0, { timeout: 10_000 });
    await expect(
        seasonTabs.first().locator('.season-tabs__done')
    ).toBeVisible();

    // Season 1 itself still holds the 8 persisted rows.
    await seasonTabs.first().click();
    await expect(seasonToggle).toContainText('Mark season as unwatched', {
        timeout: 15_000,
    });
    await expect(watchedCards).toHaveCount(8, { timeout: 10_000 });

    // Second click clears every episode's position again.
    await seasonToggle.click();
    await expect(seasonToggle).toContainText('Mark season as watched (8)', {
        timeout: 15_000,
    });
    await expect(watchedCards).toHaveCount(0);
    await expect(page.locator('.season-tabs__done')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Series-level watched toggle: the season header's ⋮ menu marks EVERY season
// in one action (default scenario: 3 seasons × 8 episodes = 24), flips to
// unwatch-all once the whole series is watched, and survives a reload.
// ---------------------------------------------------------------------------

test('@xtream series watched toggle — marks every season from the header menu, survives reload, and clears again', async ({
    page,
    request,
}) => {
    const categories = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series_categories`
        )
    ).json()) as Array<{ category_id: string; category_name: string }>;
    const category = categories[0];

    const seriesItems = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series&category_id=${category.category_id}`
        )
    ).json()) as Array<{ name: string; series_id: number }>;
    const targetSeries = seriesItems[0];

    await addXtreamPortal(page);
    await page.goto(page.url().replace(/\/vod.*$/, '/series'));

    const categoryItem = page
        .locator('.context-panel .category-item')
        .filter({ hasText: category.category_name })
        .first();
    await expect(categoryItem).toBeVisible({ timeout: 10_000 });
    await categoryItem.click();

    const seriesCard = page
        .locator('app-grid-list mat-card')
        .filter({ hasText: targetSeries.name })
        .first();
    await expect(seriesCard).toBeVisible({ timeout: 10_000 });
    await seriesCard.click();

    // The ⋮ series menu sits at the end of the season-header actions row
    // (data-test-id with a dash — getByTestId only matches data-testid in
    // this suite; the menu item renders into the CDK overlay).
    const menuTrigger = page.locator('[data-test-id="series-watch-menu"]');
    await expect(menuTrigger).toBeVisible({ timeout: 15_000 });
    const seasonTabs = page.locator('.season-tabs__pill');
    await expect(seasonTabs).toHaveCount(3);

    await menuTrigger.click();
    const seriesToggle = page.locator('[data-test-id="toggle-series-watched"]');
    await expect(seriesToggle).toBeVisible();
    await expect(seriesToggle).toContainText('Mark series as watched (24)');
    await seriesToggle.click();

    // One batch marks all 24 episodes: every season tab gets the completed
    // check and the visible season's episodes flip to watched.
    await expect(page.locator('.season-tabs__done')).toHaveCount(3, {
        timeout: 15_000,
    });
    await expect(page.locator('.episode-card--watched')).toHaveCount(8);

    // The action now offers unwatch-all.
    await menuTrigger.click();
    await expect(seriesToggle).toContainText('Mark series as unwatched');
    await page.keyboard.press('Escape');

    // PWA persistence: positions live in localStorage, so a reload must come
    // back fully watched across all seasons.
    await page.reload();
    await expect(menuTrigger).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.season-tabs__done')).toHaveCount(3, {
        timeout: 10_000,
    });

    // Unwatch-all clears every season again.
    await menuTrigger.click();
    await expect(seriesToggle).toContainText('Mark series as unwatched');
    await seriesToggle.click();
    await expect(page.locator('.season-tabs__done')).toHaveCount(0, {
        timeout: 15_000,
    });
    await expect(page.locator('.episode-card--watched')).toHaveCount(0);
    await menuTrigger.click();
    await expect(seriesToggle).toContainText('Mark series as watched (24)');
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

// ---------------------------------------------------------------------------
// Fullscreen survives an episode switch
//
// app-web-player-view remounts the engine component for every playback
// application (next episode, channel, or alternative source). DOM fullscreen
// used to be owned by that engine's shell, so the Fullscreen API exited the
// moment the old shell left the document — every "next episode" click and
// every autoplay hand-off dropped the viewer back to the page. The owner is
// now the app-web-player-view host, which spans all applications of one mount.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inline series playback helpers
// ---------------------------------------------------------------------------

/**
 * Serve a tiny VP8 clip for every episode stream. Chromium ships no
 * proprietary codecs, so the clip stands in for the mock's external HLS
 * redirect; the browser sniffs the WebM container from the bytes. Registered
 * after the beforeEach proxy route, so it runs first and fetches from the
 * mock itself (the mock ignores the url parameter).
 */
async function routeEpisodeClip(page: Page): Promise<void> {
    const episodeClip = readFileSync(
        join(__dirname, 'fixtures/playback/episode.webm')
    );
    await page.route(
        (url) =>
            url.origin === MOCK_SERVER && url.pathname.startsWith('/series/'),
        async (route) => {
            // Chromium's media pipeline seeks through byte ranges; a plain
            // 200 to a Range request clamps every seek to the start, which
            // would defeat end-of-episode steps.
            const range = /^bytes=(\d*)-(\d*)$/.exec(
                route.request().headers()['range'] ?? ''
            );
            const last = episodeClip.length - 1;
            const start = range?.[1]
                ? Number(range[1])
                : range?.[2]
                  ? Math.max(0, episodeClip.length - Number(range[2]))
                  : 0;
            const end =
                range?.[1] && range[2]
                    ? Math.min(Number(range[2]), last)
                    : last;
            await route.fulfill({
                status: range ? 206 : 200,
                headers: {
                    'accept-ranges': 'bytes',
                    'content-length': String(end - start + 1),
                    'content-type': 'video/webm',
                    ...(range
                        ? {
                              'content-range': `bytes ${start}-${end}/${episodeClip.length}`,
                          }
                        : {}),
                },
                body: episodeClip.subarray(start, end + 1),
            });
        }
    );
}

/**
 * The mock's episodes are .mkv, which the HTML5 player would hand to hls.js;
 * get_series_info is rewritten to .mp4 — the extension the player gives to
 * the native source path.
 */
async function rewriteSeriesEpisodesToMp4(page: Page): Promise<void> {
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        if (original.searchParams.get('action') !== 'get_series_info') {
            await route.fallback();
            return;
        }
        const mockUrl = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') {
                mockUrl.searchParams.set(key, value);
            }
        });
        const response = await route.fetch({ url: mockUrl.toString() });
        const body = (await response.json()) as {
            payload: {
                episodes?: Record<
                    string,
                    Array<{ container_extension: string }>
                >;
            };
        };
        for (const episodes of Object.values(body.payload.episodes ?? {})) {
            for (const episode of episodes) {
                episode.container_extension = 'mp4';
            }
        }
        await route.fulfill({ response, json: body });
    });
}

/** Persist the web player engine and the shared-controls preference. */
async function selectWebPlayer(
    page: Page,
    engine: string,
    sharedControls = true
): Promise<void> {
    await page.goto('/workspace/settings/playback');
    await page.locator('[data-test-id="select-video-player"]').click();
    await page.getByRole('option', { name: engine, exact: true }).click();
    const toggle = page.locator(
        '[data-test-id="web-player-shared-controls-toggle"]'
    );
    if ((await toggle.locator('input').isChecked()) !== sharedControls) {
        await toggle.click();
    }
    const saveButton = page.getByRole('button', { name: 'Save changes' });
    await saveButton.click();
    await expect(saveButton).toBeHidden();
}

/** Add the mock portal and start the first episode of the first series. */
async function playFirstSeriesEpisode(
    page: Page,
    request: APIRequestContext
): Promise<{ playerView: Locator; video: Locator }> {
    const categories = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series_categories`
        )
    ).json()) as Array<{ category_id: string; category_name: string }>;
    const category = categories[0];
    const seriesItems = (await (
        await request.get(
            `${MOCK_SERVER}/player_api.php?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}&action=get_series&category_id=${category.category_id}`
        )
    ).json()) as Array<{ name: string; series_id: number }>;
    const targetSeries = seriesItems[0];

    await page.goto('/');
    await addXtreamPortal(page);
    await page.goto(page.url().replace(/\/vod.*$/, '/series'));
    const categoryItem = page
        .locator('.context-panel .category-item')
        .filter({ hasText: category.category_name })
        .first();
    await expect(categoryItem).toBeVisible({ timeout: 10_000 });
    await categoryItem.click();
    const seriesCard = page
        .locator('app-grid-list mat-card')
        .filter({ hasText: targetSeries.name })
        .first();
    await expect(seriesCard).toBeVisible({ timeout: 10_000 });
    await seriesCard.click();

    const episodeCards = page.locator('.episode-card');
    await expect(episodeCards).toHaveCount(8, { timeout: 15_000 });
    await episodeCards.first().click();

    const playerView = page.locator(
        'app-portal-inline-player app-web-player-view'
    );
    return { playerView, video: playerView.locator('video') };
}

test.describe('@xtream inline series fullscreen', () => {
    // No autoplay-policy flag is needed: the episode click is a user
    // activation and the fixture clip carries no audio track.
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'DOM fullscreen assertions target Chromium'
    );

    test('stays in fullscreen across manual and automatic episode switches', async ({
        page,
        request,
    }) => {
        await routeEpisodeClip(page);
        await rewriteSeriesEpisodesToMp4(page);

        // Persist the HTML5 engine first: Video.js rejects the mock's
        // video/matroska source type before any bytes are sniffed.
        await selectWebPlayer(page, 'HTML5 video player');
        const { playerView, video } = await playFirstSeriesEpisode(
            page,
            request
        );
        await expect(playerView.locator('app-html-video-player')).toBeVisible({
            timeout: 15_000,
        });
        const waitForMetadata = () =>
            expect
                .poll(() =>
                    video.evaluate((el) => (el as HTMLVideoElement).readyState)
                )
                .toBeGreaterThanOrEqual(1);
        await waitForMetadata();

        // The bar auto-hides during playback; a hover reveals it. The
        // overlay title renders only while the controls consider themselves
        // fullscreen, so it doubles as the controls-state assertion.
        // Asserted as "some element is fullscreen" rather than by owner tag,
        // so the test guards the behavior, not the wiring.
        const fullscreenOwner = () =>
            page.evaluate(() => document.fullscreenElement?.tagName ?? null);
        const overlayTitle = playerView.locator(
            '[data-test-id="player-controls-media-title"]'
        );
        await playerView.hover();
        await playerView
            .getByRole('button', { name: 'Enter fullscreen' })
            .click();
        await expect.poll(fullscreenOwner).not.toBeNull();
        await expect(overlayTitle).toContainText('S01E01');

        // Chromium leaves the clicked button focused; the shared controls
        // release that focus so Space reaches the playback shortcut instead
        // of activating the button again (which left fullscreen while the
        // video kept playing).
        const paused = () =>
            video.evaluate((el) => (el as HTMLVideoElement).paused);
        await expect.poll(paused).toBe(false);
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(true);
        expect(await fullscreenOwner()).not.toBeNull();
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(false);

        // Manual switch from the shared controls' own next-episode button.
        await playerView.hover();
        await playerView
            .locator('[data-test-id="player-controls-next-episode"]')
            .click();
        await expect(overlayTitle).toContainText('S01E02', {
            timeout: 15_000,
        });
        expect(await fullscreenOwner()).not.toBeNull();

        // Automatic switch: the clip reaching its end autoplays the next
        // episode with no user activation anywhere near it.
        await waitForMetadata();
        await video.evaluate(async (el) => {
            const media = el as HTMLVideoElement;
            media.currentTime = Math.max(0, media.duration - 0.2);
            // Headless autoplay is not guaranteed for a remounted element;
            // the document already carries user activation from the clicks.
            await media.play();
        });
        await expect(overlayTitle).toContainText('S01E03', {
            timeout: 15_000,
        });
        expect(await fullscreenOwner()).not.toBeNull();
    });
});

test.describe('@xtream vendor-chrome Video.js shortcuts', () => {
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'DOM fullscreen assertions target Chromium'
    );

    test('keep working after a mouse click on a control-bar button', async ({
        page,
        request,
    }) => {
        await routeEpisodeClip(page);
        await rewriteSeriesEpisodesToMp4(page);
        // Video.js with the shared controls opted out: the vendor control bar.
        await selectWebPlayer(page, 'Video.js player', false);
        const { playerView, video } = await playFirstSeriesEpisode(
            page,
            request
        );
        await expect(playerView.locator('app-vjs-player')).toBeVisible({
            timeout: 15_000,
        });
        await expect(playerView.locator('app-player-controls')).toHaveCount(0);
        const paused = () =>
            video.evaluate((el) => (el as HTMLVideoElement).paused);
        const fullscreenOwner = () =>
            page.evaluate(() => document.fullscreenElement?.tagName ?? null);
        await expect.poll(paused).toBe(false);

        // Chromium leaves the clicked Video.js button focused, and a focused
        // Video.js component swallows every key; the legacy chrome releases
        // that focus so Space and M reach the playback shortcuts instead of
        // Space activating the button again (which left fullscreen while the
        // video kept playing).
        await playerView.hover();
        await playerView.locator('.vjs-fullscreen-control').click();
        await expect.poll(fullscreenOwner).not.toBeNull();
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(true);
        expect(await fullscreenOwner()).not.toBeNull();
        await page.keyboard.press('Space');
        await expect.poll(paused).toBe(false);
        await page.keyboard.press('m');
        await expect
            .poll(() => video.evaluate((el) => (el as HTMLVideoElement).muted))
            .toBe(true);
    });
});

for (const theme of ['light', 'dark']) {
    test(`@xtream navigation: channel focus and separate scrollbar (${theme})`, async ({
        page,
    }) => {
        await addXtreamPortal(page);
        await page.getByRole('link', { name: 'Live TV', exact: true }).click();
        await page.evaluate(
            (dark) => document.body.classList.toggle('dark-theme', dark),
            theme === 'dark'
        );
        const category = page.locator('.context-panel .category-item').first();
        await category.click();
        const viewport = page.locator('.scroll-viewport-portals');
        await expect(viewport).toBeVisible();
        await category.focus();
        await page.keyboard.press('ArrowRight');
        await expect(viewport).toBeFocused();
        await expect(page.locator('app-web-player-view')).toHaveCount(0);
        await page.keyboard.press('Tab');
        const firstAction = viewport.locator('button.channel-content').first();
        await expect(firstAction).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(viewport).toBeFocused();

        const row = viewport.locator('.channel-name').first();
        await row.click();
        await expect(viewport).toBeFocused();
        await page.keyboard.press('PageDown');
        await expect
            .poll(() => viewport.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(100);
        await waitForScrollIdle(viewport);
        const position = await viewport.evaluate((el) => el.scrollTop);
        await page.keyboard.press('PageDown');
        await expect
            .poll(() => viewport.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(position);
        await waitForScrollIdle(viewport);
        await page.keyboard.press('Home');
        await expect
            .poll(() => viewport.evaluate((el) => el.scrollTop))
            .toBe(0);
        await firstAction.focus();
        await page.keyboard.press('Space');
        await expect(page.locator('app-web-player-view')).toBeVisible();
        await expect(firstAction).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(
            viewport.locator('.favorite-button').first()
        ).toBeFocused();
        await page.keyboard.press('Space');
        await expect(
            viewport.locator('.favorite-button').first()
        ).toBeFocused();
        await viewport.focus();
        const overlap = await viewport.evaluate((el) => {
            const handle = el
                .closest('.sidebar')!
                .querySelector('.resize-handle')!;
            return (
                el.getBoundingClientRect().right -
                handle.getBoundingClientRect().left
            );
        });
        expect(overlap).toBeLessThanOrEqual(0);
        await page.keyboard.press('ArrowLeft');
        await expect(category).toBeFocused();
    });

    for (const section of ['Movies', 'Series']) {
        test(`@xtream navigation: detail scroll ${section} (${theme})`, async ({
            page,
        }) => {
            await page.setViewportSize({ width: 1200, height: 540 });
            await addXtreamPortal(page);
            await page
                .getByRole('link', { name: section, exact: true })
                .click();
            await page.locator('app-grid-list mat-card').first().click();
            const shell = page.locator('app-portal-detail-shell');
            await expect(shell).toBeVisible();
            await page.evaluate(
                (dark) => document.body.classList.toggle('dark-theme', dark),
                theme === 'dark'
            );
            await expect(shell).toBeFocused();
            await expect
                .poll(() =>
                    shell.evaluate((el) => el.scrollHeight - el.clientHeight)
                )
                .toBeGreaterThan(0);
            expect(
                await shell.evaluate(
                    (el) => getComputedStyle(el).scrollbarWidth
                )
            ).not.toBe('none');
            await page.keyboard.press('PageDown');
            await expect
                .poll(() => shell.evaluate((el) => el.scrollTop))
                .toBeGreaterThan(0);
        });
    }
}
