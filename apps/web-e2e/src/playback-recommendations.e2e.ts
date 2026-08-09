import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const FIXTURE_DIR = join(__dirname, 'fixtures/playback');
const FIXTURE_HOST = 'https://playback-fixture.local';
const FATAL_HLS_PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="fatal-hls" group-title="Playback",Fatal HLS',
    `${FIXTURE_HOST}/fatal-media.m3u8`,
].join('\n');

const PLAYBACK_FIXTURES = new Map([
    [
        '/fatal-media.m3u8',
        {
            body: readFileSync(join(FIXTURE_DIR, 'fatal-media.m3u8')),
            contentType: 'application/vnd.apple.mpegurl',
        },
    ],
    [
        '/corrupt.ts',
        {
            body: readFileSync(join(FIXTURE_DIR, 'corrupt.ts')),
            contentType: 'video/mp2t',
        },
    ],
]);

test.use({
    launchOptions: {
        args: ['--autoplay-policy=no-user-gesture-required'],
    },
    serviceWorkers: 'block',
});

test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'HLS recovery coverage targets Chromium'
);

async function servePlaybackFixtures(page: Page): Promise<void> {
    await page.route(`${FIXTURE_HOST}/**`, async (route) => {
        const fixture = PLAYBACK_FIXTURES.get(
            new URL(route.request().url()).pathname
        );
        if (!fixture) {
            await route.fulfill({
                status: 404,
                contentType: 'text/plain',
                body: 'not found',
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: fixture.contentType,
            body: fixture.body,
        });
    });
}

async function openSettings(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Open settings' }).click();
    // The bare settings URL redirects to the default section page; the
    // player select lives on the playback section page.
    await page.waitForURL(/\/workspace\/settings\/general$/);
    await expect(
        page.getByRole('button', { name: 'Back', exact: true })
    ).toBeVisible();
    await page
        .locator('[data-test-id="settings-section-playback"]')
        .click();
    await page.waitForURL(/\/workspace\/settings\/playback$/);
}

async function selectAndSaveHtml5(page: Page): Promise<void> {
    const playerSelect = page.locator('[data-test-id="select-video-player"]');
    await playerSelect.click();
    await page
        .getByRole('option', { name: 'HTML5 video player', exact: true })
        .click();

    const saveButton = page.getByRole('button', { name: 'Save changes' });
    await saveButton.click();
    // A successful save removes the unsaved-changes bar with its button.
    await expect(saveButton).toBeHidden();
}

async function importFatalHlsPlaylist(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog
        .getByLabel('Insert m3u(8) playlist as text')
        .fill(FATAL_HLS_PLAYLIST);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Import', exact: true }).click(),
    ]);
    await expect(page.getByText('1 channel')).toBeVisible();
}

test('@web @m3u @playback temporarily switches to the recommended player', async ({
    page,
}) => {
    await servePlaybackFixtures(page);
    await page.goto('/');

    await openSettings(page);
    await selectAndSaveHtml5(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(/\/workspace\/dashboard$/);

    await importFatalHlsPlaylist(page);
    await page.getByText('1. Fatal HLS', { exact: true }).click();

    const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
    const videoJsRecommendation = page.locator(
        '[data-test-id="playback-recommendation-videojs"]'
    );
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(
        banner.locator('[data-test-id="playback-diagnostic-details"]')
    ).toContainText(
        /HLS\.js[\s\S]*type=mediaError[\s\S]*details=fragParsingError[\s\S]*disposition=fatal/
    );
    await expect(videoJsRecommendation).toBeVisible();
    await expect(videoJsRecommendation).toHaveClass(
        /web-player-diagnostic__player-card--primary/
    );

    await videoJsRecommendation.click();
    await expect(page.locator('app-vjs-player')).toBeVisible();

    await openSettings(page);
    await page.reload();
    await expect(page).toHaveURL(/\/workspace\/settings\/playback$/);
    const persistedPlayerSelect = page.locator(
        '[data-test-id="select-video-player"]'
    );
    await expect(persistedPlayerSelect).toBeVisible();
    await expect(persistedPlayerSelect).toBeEnabled();
    await expect(persistedPlayerSelect).toHaveText('HTML5 video player');
});
