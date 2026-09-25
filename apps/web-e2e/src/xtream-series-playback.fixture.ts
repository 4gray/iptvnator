import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { setInputValue } from './e2e-helpers';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

/**
 * Shared Xtream helpers for `xtream.e2e.ts` and `xtream-series-playback.e2e.ts`:
 * the mock-server address and credentials, the PWA proxy intercept, the
 * portal import, and the inline series playback setup.
 */

const XTREAM_MOCK_PORT = process.env['XTREAM_MOCK_PORT'] ?? '3211';
export const MOCK_SERVER = `http://localhost:${XTREAM_MOCK_PORT}`;

/** Default scenario credentials */
export const DEFAULT_USERNAME = 'user1';
export const DEFAULT_PASSWORD = 'pass1';

/**
 * Intercept calls from the Angular PWA proxy (/xtream) and redirect them
 * to the mock server. This avoids any real backend requirement.
 */
export async function interceptXtreamRequests(page: Page): Promise<void> {
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
export async function addXtreamPortal(
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
export async function routeEpisodeClip(page: Page): Promise<void> {
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
export async function rewriteSeriesEpisodesToMp4(page: Page): Promise<void> {
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
export async function selectWebPlayer(
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
export async function playFirstSeriesEpisode(
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
