/**
 * Setup actions that browse the seeded sources for a shot: portal catalogs
 * and live lists, the M3U groups view, and alternative sources. Actions
 * here call each other directly rather than through `runAction`, which
 * keeps this module free of a dependency on the dispatcher.
 */

import type { Page } from '@playwright/test';

import {
    type CaptureAction,
    clickHrefSuffix,
    goHome,
    openXtreamSection,
    requirePlaylistId,
} from './capture-navigation-helpers';

/* ------------------------------------------------------------------ */
/* Portal catalogs                                                     */
/* ------------------------------------------------------------------ */

async function openXtreamVod(page: Page, param: string | null): Promise<void> {
    await openXtreamSection(page, 'vod', param ?? 'Action & Mystery');
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+/, {
        timeout: 30_000,
    });
    await page
        .locator('app-content-hero')
        .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(700);
}

export async function openXtreamSeries(
    page: Page,
    param: string | null
): Promise<void> {
    await openXtreamSection(page, 'series', param ?? 'Urban Drama');
    await page.waitForURL(
        /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+/,
        { timeout: 30_000 }
    );
    await page
        .locator('app-season-container')
        .waitFor({ state: 'visible', timeout: 30_000 });

    // Season tabs auto-select a season; click the first pill only
    // when no episodes rendered on their own.
    const episode = page.locator('.episode-card, .episode-list-item').first();

    if (!(await episode.isVisible().catch(() => false))) {
        await page
            .locator('.season-tabs__pill, [data-testid="season-dropdown"]')
            .first()
            .click();
    }

    await episode.waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(700);
}

export async function openM3uGroups(page: Page): Promise<void> {
    const playlistId = requirePlaylistId('playlists');

    await goHome(page);
    await page
        .locator(`a[href*="/workspace/playlists/${playlistId}"]`)
        .first()
        .click();
    await page.waitForURL(
        (url) => url.href.includes(`/workspace/playlists/${playlistId}/`),
        { timeout: 20_000 }
    );
    await clickHrefSuffix(page, `/workspace/playlists/${playlistId}/groups`);
    await page
        .locator('.group-nav-item')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.group-nav-item').first().click();
    // Deliberately no channel click: starting playback would pull a
    // real HLS stream (the mock redirects to a public demo stream),
    // and third-party video frames must never enter a release shot.
    await page
        .locator('[data-test-id="channel-item"]')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(500);
}

/* ------------------------------------------------------------------ */
/* Live lists                                                          */
/* ------------------------------------------------------------------ */

/**
 * Opens a portal's live section and selects a category. Deliberately no
 * channel click: playback would pull the mock's redirect to a public demo
 * stream, and third-party video frames must never enter a published shot.
 */
async function openLiveCategory(
    page: Page,
    provider: 'xtreams' | 'stalker',
    liveSection: 'live' | 'itv',
    param: string | null
): Promise<void> {
    const playlistId = requirePlaylistId(provider);

    await goHome(page);
    await clickHrefSuffix(page, `/workspace/${provider}/${playlistId}/vod`);
    await clickHrefSuffix(
        page,
        `/workspace/${provider}/${playlistId}/${liveSection}`
    );

    const categories = page.locator(
        'app-workspace-context-panel .category-item'
    );
    const category = param
        ? categories.filter({ hasText: param }).first()
        : categories.first();

    await category.waitFor({ state: 'visible', timeout: 30_000 });
    await category.click();
    await page
        .locator('app-channel-list-item')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(700);
}

async function openXtreamLive(page: Page, param: string | null): Promise<void> {
    await openLiveCategory(page, 'xtreams', 'live', param);
}

async function openStalkerLive(
    page: Page,
    param: string | null
): Promise<void> {
    await openLiveCategory(page, 'stalker', 'itv', param);
}

async function openXtreamLiveChannel(
    page: Page,
    param: string | null
): Promise<void> {
    // Unlike `open-xtream-live`, this selects a channel: the marketing
    // scenario serves live streams from local bytes (`local-media`),
    // so playback never reaches a public stream. The player shows a
    // format error, which the phone-view shot never frames; what it
    // needs is the remote status the selection publishes.
    await openXtreamLive(page, param);
    const channel = page.locator('app-channel-list-item').first();

    await channel.click();
    await page.waitForTimeout(1500);
}

/* ------------------------------------------------------------------ */
/* Alternative sources (guide shots)                                   */
/* ------------------------------------------------------------------ */

/**
 * Opens a movie of the primary portal whose copy also exists in the secondary
 * one (seeded with `secondaryXtream`), and waits for lazy discovery to render
 * the Sources chip.
 */
async function openXtreamVodSources(
    page: Page,
    param: string | null
): Promise<void> {
    requirePlaylistId('xtreams-secondary');
    await openXtreamVod(page, param ?? 'Action & Mystery');
    await page
        .locator('app-vod-sources-chip button')
        .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);
}

async function openXtreamVodSourcesMenu(
    page: Page,
    param: string | null
): Promise<void> {
    await openXtreamVodSources(page, param);
    await page.locator('app-vod-sources-chip button').click();

    const menu = page.locator('app-vod-sources-menu');

    await menu.waitFor({ state: 'visible', timeout: 15_000 });
    // "check all" probes every unchecked copy (one get_vod_info plus a
    // HEAD against the mock) so the rows carry verdicts in the frame.
    const checkAll = menu.locator('.sources-menu__check-all');

    if (await checkAll.isVisible().catch(() => false)) {
        await checkAll.click();
        await checkAll
            .waitFor({ state: 'hidden', timeout: 30_000 })
            .catch(() => undefined);
    }

    await page.waitForTimeout(700);
}

export const PORTAL_ACTIONS: Readonly<Record<string, CaptureAction>> = {
    'open-xtream-vod': openXtreamVod,
    'open-xtream-series': openXtreamSeries,
    'open-m3u-groups': openM3uGroups,
    'open-xtream-live': openXtreamLive,
    'open-xtream-live-channel': openXtreamLiveChannel,
    'open-stalker-live': openStalkerLive,
    'open-xtream-vod-sources': openXtreamVodSources,
    'open-xtream-vod-sources-menu': openXtreamVodSourcesMenu,
};
