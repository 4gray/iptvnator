import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * DASH + ClearKey playback (offline fixture, no network).
 *
 * The fixture host is virtual: every request to it is fulfilled from
 * `fixtures/dash/` via route interception, including HTTP Range requests
 * (Shaka fetches the init segment and sidx via byte ranges).
 */

const FIXTURE_DIR = join(__dirname, 'fixtures/dash');
const FIXTURE_HOST = 'https://dash-fixture.local';

const CLEARKEY_KID = '00112233445566778899aabbccddeeff';
const CLEARKEY_KEY = 'ffeeddccbbaa99887766554433221100';

const DASH_PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="ck-dash" group-title="DASH",ClearKey DASH',
    '#KODIPROP:inputstream.adaptive.license_type=clearkey',
    `#KODIPROP:inputstream.adaptive.license_key=${CLEARKEY_KID}:${CLEARKEY_KEY}`,
    `${FIXTURE_HOST}/clearkey.mpd`,
    '#EXTINF:-1 tvg-id="clear-dash" group-title="DASH",Clear DASH',
    `${FIXTURE_HOST}/clear.mpd`,
    '#EXTINF:-1 tvg-id="wv-dash" group-title="DASH",Widevine DASH',
    '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
    '#KODIPROP:inputstream.adaptive.license_key=https://license.example.com/wv',
    `${FIXTURE_HOST}/clearkey.mpd`,
].join('\n');

// The inline player starts playback programmatically; without this flag the
// bundled Chromium blocks play() before a user gesture reaches the video.
// The Angular service worker must be blocked: requests going through it
// bypass Playwright route interception, so the virtual fixture host would
// never resolve.
test.use({
    launchOptions: {
        args: ['--autoplay-policy=no-user-gesture-required'],
    },
    serviceWorkers: 'block',
});

// ClearKey EME + VP9 support is only deterministic in Chromium among the
// bundled Playwright browsers (WebKit lacks ClearKey); the Electron e2e suite
// covers the real desktop runtime.
test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'DASH ClearKey coverage targets Chromium'
);

async function serveDashFixtures(page: Page): Promise<void> {
    await page.route(`${FIXTURE_HOST}/**`, async (route) => {
        const url = new URL(route.request().url());
        let body: Buffer;
        try {
            body = readFileSync(join(FIXTURE_DIR, url.pathname.slice(1)));
        } catch {
            await route.fulfill({ status: 404, body: 'not found' });
            return;
        }

        const contentType = url.pathname.endsWith('.mpd')
            ? 'application/dash+xml'
            : 'video/mp4';
        const rangeHeader = route.request().headers()['range'];
        const range = rangeHeader
            ? /bytes=(\d+)-(\d+)?/.exec(rangeHeader)
            : null;
        if (!range) {
            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                },
                body,
            });
            return;
        }

        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : body.length - 1;
        await route.fulfill({
            status: 206,
            headers: {
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes ${start}-${end}/${body.length}`,
            },
            body: body.subarray(start, end + 1),
        });
    });
}

async function importDashPlaylist(page: Page): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.locator('textarea').fill(DASH_PLAYLIST);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Import', exact: true }).click(),
    ]);
    await expect(page.getByText('3 channels')).toBeVisible();
}

async function expectVideoPlaying(page: Page): Promise<void> {
    const video = page.locator('app-web-player-view video').first();
    await expect(video).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(
            () =>
                video.evaluate(
                    (element: HTMLVideoElement) => element.currentTime
                ),
            { timeout: 20_000 }
        )
        .toBeGreaterThan(0.5);
    await expect(
        page.locator('[data-test-id="playback-diagnostic-banner"]')
    ).toBeHidden();
}

test('@web @m3u @dash ClearKey and clear DASH channels play inline', async ({
    page,
}) => {
    await serveDashFixtures(page);
    await importDashPlaylist(page);

    await page.getByText('1. ClearKey DASH').click();
    await expectVideoPlaying(page);

    await page.getByText('2. Clear DASH').click();
    await expectVideoPlaying(page);
});

test('@web @m3u @dash unsupported DRM shows the encryption diagnostic', async ({
    page,
}) => {
    await serveDashFixtures(page);
    await importDashPlaylist(page);

    await page.getByText('3. Widevine DASH').click();

    const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(
        'This player does not support the stream’s DRM configuration.'
    );
    await banner.locator('summary').click();
    const details = banner.locator(
        '[data-test-id="playback-diagnostic-details"]'
    );
    await expect(details).toContainText('DRM declared by source');
    await expect(details).toContainText('Widevine');
    await expect(
        banner.locator('[data-test-id="playback-fallback-mpv"]')
    ).toHaveCount(0);
    await expect(
        banner.locator('[data-test-id="playback-fallback-vlc"]')
    ).toHaveCount(0);
    await expect(
        banner.locator('[data-test-id^="playback-recommendation-"]')
    ).toHaveCount(0);
});

test('@web @m3u @dash manifest DRM and codecs survive a startup failure', async ({
    page,
}) => {
    await serveDashFixtures(page);
    let manifestRequests = 0;
    const body = readFileSync(
        join(FIXTURE_DIR, 'clear.mpd'),
        'utf8'
    ).replaceAll(
        '<Representation ',
        '<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>' +
            '<ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>' +
            '<!-- private-license-marker -->' +
            '<Representation '
    );
    await page.route(`${FIXTURE_HOST}/clear.mpd`, async (route) => {
        manifestRequests += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/dash+xml',
            body,
        });
    });
    await importDashPlaylist(page);
    await page.getByText('2. Clear DASH').click();
    const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await banner.locator('summary').click();
    const details = banner.locator(
        '[data-test-id="playback-diagnostic-details"]'
    );
    await expect(details).toContainText('Widevine, PlayReady');
    await expect(details).toContainText('vp09.00.11.08.01.02.02.02.00');
    await expect(details).toContainText('opus');
    await expect(details).not.toContainText('private-license-marker');
    expect(manifestRequests).toBe(1);
});

test('@web @m3u @dash segment failures show their stage and preserve codecs', async ({
    page,
    context,
}) => {
    await serveDashFixtures(page);
    await page.route(`${FIXTURE_HOST}/clear-video.mp4`, (route) =>
        route.fulfill({ status: 403, body: 'private-response-marker' })
    );
    await importDashPlaylist(page);
    await page.getByText('2. Clear DASH').click();
    const banner = page.locator('[data-test-id="playback-diagnostic-banner"]');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await banner.locator('summary').click();
    const details = banner.locator(
        '[data-test-id="playback-diagnostic-details"]'
    );
    await expect(details).toContainText('Media segment loading');
    await expect(details).toContainText('vp09.00.11.08.01.02.02.02.00');
    await expect(details).toContainText('HTTP 403');
    await expect(details).not.toContainText('private-response-marker');
    await expect(details).not.toContainText('DRM declared by source');
    await expect(banner).toContainText(
        'The server denied access to the media segments.'
    );
    await expect(banner).not.toContainText(/token.*expired/i);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const copy = banner.getByRole('button', {
        name: 'Copy diagnostics',
        exact: true,
    });
    await copy.click();
    await expect(
        banner.locator('[data-test-id="playback-copy-diagnostic-status"]')
    ).toHaveText('Diagnostics copied');
    const reportText = await page.evaluate(() =>
        navigator.clipboard.readText()
    );
    expect(JSON.parse(reportText)).toMatchObject({
        app: 'IPTVnator',
        engine: 'shaka',
        stage: 'segment',
        httpStatus: 403,
        videoCodecs: ['vp09.00.11.08.01.02.02.02.00'],
    });
    for (const secret of [
        'private-response-marker',
        FIXTURE_HOST,
        'sourceUrl',
    ]) {
        expect(reportText).not.toContain(secret);
    }
    await page.getByText('3. Widevine DASH').click();
    await expect(banner).toContainText(
        'This player does not support the stream’s DRM configuration.'
    );
    await expect(
        banner.locator('[data-test-id="playback-copy-diagnostic-status"]')
    ).toBeEmpty();
    await copy.click();
    const next = JSON.parse(
        await page.evaluate(() => navigator.clipboard.readText())
    );
    expect(next).toMatchObject({
        code: 'drm-or-encryption',
        drmSystems: ['widevine'],
    });
    expect(next).not.toHaveProperty('httpStatus');
    expect(next).not.toHaveProperty('stage');
});
