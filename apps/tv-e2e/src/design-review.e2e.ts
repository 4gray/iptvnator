import { expect, test, type Page } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { addSource, nav, start } from './helpers';
import { prepareLiveMedia } from './live-media';
import { enableMarketingTmdb } from './marketing-tmdb';

/**
 * Captures the 24 screens of the TV design review at 1920×1080 with the
 * fictional marketing catalog. Opt-in: set TV_DESIGN_REVIEW=1 (and optionally
 * TV_DESIGN_REVIEW_DIR) so ordinary E2E runs skip it.
 */
const enabled = process.env['TV_DESIGN_REVIEW'] === '1';
const outDir = join(
    workspaceRoot,
    process.env['TV_DESIGN_REVIEW_DIR'] ?? 'dist/tv-design-review'
);

async function settle(page: Page) {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    // Lazy artwork outside the viewport may never load; wait briefly only.
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    Array.from(document.images)
                        .filter((image) => image.getBoundingClientRect().width)
                        .every((image) => image.complete)
                ),
            { timeout: 5000 }
        )
        .toBe(true)
        .catch(() => undefined);
    await page.waitForTimeout(400);
}

async function shot(page: Page, name: string) {
    await settle(page);
    await page.screenshot({ path: join(outDir, `${name}.png`) });
}

test.describe('TV design review capture', () => {
    test.skip(!enabled, 'Set TV_DESIGN_REVIEW=1 to capture review screens');
    test.setTimeout(600000);

    test('captures the 24 review screens', async ({ page }) => {
        await mkdir(outDir, { recursive: true });
        await start(page);
        await shot(page, '01-first-launch-sources-empty');

        await addSource(page, 'xtream', {
            name: 'Demo Xtream',
            username: 'marketing',
            password: 'marketing',
        });
        await enableMarketingTmdb(page);
        await shot(page, '02-settings-tmdb');
        await page
            .getByRole('tab', { name: 'Connection', exact: false })
            .click();
        await shot(page, '03-settings-connection');
        await page
            .getByRole('tab', { name: 'Appearance', exact: false })
            .click();
        await shot(page, '04-settings-appearance');

        await nav(page, 'Home');
        await expect(page.locator('.hero h1')).not.toHaveText(
            'Make yourself at home.'
        );
        await page.locator('.hero button').first().focus();
        await shot(page, '05-home-hero');
        const firstRailCard = page.locator('.rail .poster-card').first();
        await firstRailCard.focus();
        await firstRailCard.scrollIntoViewIfNeeded();
        await shot(page, '06-home-rails-focus');

        await nav(page, 'Movies');
        await page.locator('.poster-card').first().focus();
        await shot(page, '07-movies-grid');
        await page.locator('.poster-card').first().click();
        await expect(page.locator('.detail-hero h1')).toBeVisible();
        await shot(page, '08-movie-detail');

        await nav(page, 'Series');
        await page.locator('.poster-card').first().focus();
        await shot(page, '09-series-grid');
        await page.locator('.poster-card').first().click();
        await expect(page.locator('.detail-hero h1')).toHaveText(
            'Skyline Sentinels'
        );
        await shot(page, '10-series-detail');
        await page.locator('.episode').first().focus();
        await page.locator('.episode').first().scrollIntoViewIfNeeded();
        await shot(page, '11-series-detail-episodes');

        await nav(page, 'Home');
        const live = await prepareLiveMedia(page);
        await shot(page, '13-live-channel-list');
        await page.locator('.channel-pane-header button').click();
        await expect(page.locator('.live-category').first()).toBeVisible();
        await shot(page, '12-live-categories');
        await page.locator('[data-focus="live-category:"]').click();
        await page.locator('.channel').first().click();
        await expect
            .poll(() => live.evaluate((v: HTMLVideoElement) => v.currentTime))
            .toBeGreaterThan(0.1);
        await page.getByRole('button', { name: 'Open fullscreen' }).click();
        await expect(
            page.locator('[data-focus="player-toggle"]')
        ).toBeFocused();
        await shot(page, '15-live-player-controls');
        await page.waitForTimeout(6000);
        await shot(page, '14-live-player-preview-or-fullscreen');
        await page.keyboard.press('Enter');
        await page
            .getByRole('button', { name: 'Channels', exact: true })
            .click();
        await expect(
            page.getByRole('dialog', { name: 'Channel browser' })
        ).toBeVisible();
        await shot(page, '16-live-channel-drawer');
        await page.keyboard.press('Escape');
        await page.locator('[data-focus="player-grid"]').click();
        await expect(page.locator('.grid-channel').first()).toBeVisible();
        await shot(page, '17-live-multi-channel-guide');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        await nav(page, 'Movies');
        await page.locator('.poster-card').first().click();
        await page.locator('[data-focus="favorite"]').click();
        await nav(page, 'Movies');
        await page.locator('.poster-card').nth(1).click();
        await page.locator('[data-focus="favorite"]').click();
        await nav(page, 'Movies');
        await page.locator('.poster-card').first().click();
        await page.locator('[data-focus="detail-play"]').click();
        const video = page.locator('video');
        await expect
            .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
            .toBeGreaterThan(0.1);
        await page.getByLabel('Playback position').fill('4');
        await page.getByRole('button', { name: 'Pause', exact: false }).focus();
        await shot(page, '31-movie-player-overlay');
        await page.getByLabel('Playback position').focus();
        await shot(page, '32-movie-player-controls');
        await page.getByRole('button', { name: 'Pause', exact: false }).click();
        await page.keyboard.press('Escape');
        await expect(page.locator('.detail-hero h1')).toBeVisible();
        await shot(page, '33-movie-detail-resume-state');

        await nav(page, 'Favorites');
        await shot(page, '34-favorites-filled');
        await nav(page, 'History');
        await shot(page, '35-history-filled');
        await nav(page, 'Search');
        const search = page.getByRole('searchbox').first();
        await search.click();
        await search.fill('the');
        await expect(page.locator('.poster-card').first()).toBeVisible();
        await page.locator('.poster-card').first().focus();
        await shot(page, '36-search-results');
        await nav(page, 'Home');
        await page.locator('.hero button').first().focus();
        await shot(page, '37-home-with-resume');
    });
});
