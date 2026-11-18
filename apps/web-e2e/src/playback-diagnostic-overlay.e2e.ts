import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const FIXTURE_DIR = join(__dirname, 'fixtures/playback');
const FIXTURE_HOST = 'https://playback-overlay.example.test';
const FATAL_HLS_PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="overlay-hls" group-title="Playback",Overlay HLS',
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
    'Video.js HLS failure coverage targets Chromium'
);

async function servePlaybackFixtures(page: Page): Promise<void> {
    await page.route(`${FIXTURE_HOST}/**`, async (route) => {
        const fixture = PLAYBACK_FIXTURES.get(
            new URL(route.request().url()).pathname
        );
        await route.fulfill(
            fixture
                ? {
                      status: 200,
                      contentType: fixture.contentType,
                      body: fixture.body,
                  }
                : { status: 404, contentType: 'text/plain', body: 'not found' }
        );
    });
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
        dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click(),
    ]);
    await expect(page.getByText('1 channel')).toBeVisible();
}

/** A token as the browser resolves it for `property` inside the element. */
function readToken(
    page: Page,
    selector: string,
    property: 'color' | 'font-family',
    token: string
): Promise<string> {
    return page
        .locator(selector)
        .first()
        .evaluate(
            (element, [cssProperty, name]) => {
                const probe = document.createElement('span');
                probe.style.setProperty(cssProperty, `var(${name})`);
                element.appendChild(probe);
                const value =
                    getComputedStyle(probe).getPropertyValue(cssProperty);
                probe.remove();
                return value;
            },
            [property, token] as const
        );
}

test('@web @m3u @playback diagnostic overlay replaces the Video.js error and uses app type and tokens', async ({
    page,
}) => {
    await servePlaybackFixtures(page);
    await page.goto('/');

    await importFatalHlsPlaylist(page);
    await page.getByText('1. Overlay HLS', { exact: true }).click();

    const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('app-vjs-player')).toBeAttached();

    // Video.js renders its own error dialog for the same failure; the
    // diagnostic panel replaces it, so no vendor text shows through.
    const vendorError = page.locator('app-vjs-player .vjs-error-display');
    await expect(vendorError).toBeAttached();
    await expect.soft(vendorError).toBeHidden();

    const bodyFont = await page
        .locator('body')
        .evaluate((body) => getComputedStyle(body).fontFamily);
    const panel = 'app-playback-diagnostic-panel';
    const monoFont = await readToken(
        page,
        panel,
        'font-family',
        '--app-font-mono'
    );
    const retry = banner.locator('[data-test-id="playback-retry"]');
    await expect(retry).toBeVisible();
    await expect.soft(retry).toHaveCSS('font-family', bodyFont);
    await expect
        .soft(banner.locator('.web-player-diagnostic__meta').first())
        .toHaveCSS('font-family', monoFont);

    const primary = banner
        .locator('.web-player-diagnostic__player-card--primary')
        .first();
    await expect(primary).toBeVisible();
    const hintRatio = await banner
        .locator('.web-player-diagnostic__player-hint')
        .first()
        .evaluate((hint) => {
            const style = getComputedStyle(hint);
            return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
        });
    expect.soft(hintRatio).toBeGreaterThanOrEqual(1.3);

    const ctaBackgrounds = new Set<string>();
    for (const dark of [false, true]) {
        await page.evaluate((isDark) => {
            // The settings service swaps both classes on the body.
            document.body.classList.toggle('dark-theme', isDark);
            document.body.classList.toggle('light-theme', !isDark);
        }, dark);
        const ctaBackground = await readToken(
            page,
            panel,
            'color',
            '--app-cta-bg'
        );
        ctaBackgrounds.add(ctaBackground);
        await expect.soft(primary).toHaveCSS('background-color', ctaBackground);
        await expect
            .soft(primary)
            .toHaveCSS(
                'color',
                await readToken(page, panel, 'color', '--app-cta-fg')
            );
    }
    // Light and dark themes define different CTA pairs, so both were checked.
    expect(ctaBackgrounds.size).toBe(2);
});
