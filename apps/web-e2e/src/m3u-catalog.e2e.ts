import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

/**
 * The M3U catalog split end to end, with the setting at its default: a
 * playlist that holds films and episodes keeps only its broadcasts in the
 * channel list and offers the rest through its own Movies and Series
 * sections.
 *
 * The playlist is imported as raw text on purpose. The split is decided on
 * what the playlist parser really emits, and the parser gives every row
 * blank `tvg` and `catchup` objects — a row built by hand in a unit test
 * does not.
 */

const FIXTURE_HOST = 'https://m3u-catalog-fixture.local';
const PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="live-one" group-title="News",Live One',
    `${FIXTURE_HOST}/live.m3u8`,
    // No path evidence: only the container says this is a file.
    '#EXTINF:-1 group-title="Films",Dune (2021) 1080p',
    `${FIXTURE_HOST}/dune.mp4`,
    '#EXTINF:-1 group-title="Shows",Example Show S01E01',
    `${FIXTURE_HOST}/series/example-1.mp4`,
    '#EXTINF:-1 group-title="Shows",Example Show S01E02',
    `${FIXTURE_HOST}/series/example-2.mp4`,
].join('\n');
const LIVE_ONLY_PLAYLIST = PLAYLIST.split('\n').slice(0, 3).join('\n');

test.use({ serviceWorkers: 'block' });

async function serveClip(page: Page): Promise<void> {
    const clip = readFileSync(
        join(__dirname, 'fixtures/playback/episode.webm')
    );
    await page.route(`${FIXTURE_HOST}/**`, async (route) => {
        if (new URL(route.request().url()).pathname === '/live.m3u8') {
            // Never answered: these cases do not play the live row.
            await page.waitForEvent('close', { timeout: 0 });
            return;
        }
        const range = /^bytes=(\d*)-(\d*)$/.exec(
            route.request().headers()['range'] ?? ''
        );
        const last = clip.length - 1;
        const start = range?.[1] ? Number(range[1]) : 0;
        const end =
            range?.[1] && range[2] ? Math.min(Number(range[2]), last) : last;
        await route.fulfill({
            status: range ? 206 : 200,
            headers: {
                'content-type': 'video/webm',
                'accept-ranges': 'bytes',
                'content-length': String(end - start + 1),
                ...(range
                    ? {
                          'content-range': `bytes ${start}-${end}/${clip.length}`,
                      }
                    : {}),
            },
            body: clip.subarray(start, end + 1),
        });
    });
}

async function importPlaylist(page: Page, content: string): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.getByLabel('Insert m3u(8) playlist as text').fill(content);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click(),
    ]);
}

const sidebarEntry = (page: Page, name: string) =>
    page.locator('[data-test-id="channel-item"]').filter({ hasText: name });
const railLink = (page: Page, section: 'Movies' | 'Series') =>
    page.getByRole('link', { name: section, exact: true });
const card = (page: Page, title: string) =>
    page.locator('app-grid-list mat-card').filter({ hasText: title });

test('@web @m3u films and episodes leave the channel list for their own sections', async ({
    page,
}) => {
    await serveClip(page);
    await importPlaylist(page, PLAYLIST);

    await expect(sidebarEntry(page, 'Live One')).toBeVisible();
    await expect(sidebarEntry(page, 'Dune (2021) 1080p')).toHaveCount(0);
    await expect(sidebarEntry(page, 'Example Show')).toHaveCount(0);

    await railLink(page, 'Movies').click();
    await expect(page).toHaveURL(/\/workspace\/playlists\/.+\/vod/);
    await expect(card(page, 'Dune (2021) 1080p')).toBeVisible();
    await expect(card(page, 'Example Show')).toHaveCount(0);

    // A film card opens the row it names in the player.
    await card(page, 'Dune (2021) 1080p').click();
    await expect(page).toHaveURL(/\/workspace\/playlists\/.+\/all$/);
    const video = page.locator('video').first();
    await expect
        .poll(() =>
            video.evaluate((el: HTMLVideoElement) =>
                el.currentSrc.endsWith('/dune.mp4')
            )
        )
        .toBe(true);
});

test('@web @m3u episode rows collapse into a series with its episodes', async ({
    page,
}) => {
    await serveClip(page);
    await importPlaylist(page, PLAYLIST);

    await railLink(page, 'Series').click();
    await expect(page).toHaveURL(/\/workspace\/playlists\/.+\/series/);
    // Two episode rows, one series card.
    await expect(card(page, 'Example Show')).toHaveCount(1);

    await card(page, 'Example Show').click();
    await expect(page).toHaveURL(/\/workspace\/playlists\/.+\/series\/\d+$/);
    const episodes = page.locator('app-season-container .episode-card');
    await expect(episodes).toHaveCount(2);

    await episodes.first().click();
    const video = page.locator('app-portal-inline-player video');
    await expect
        .poll(() =>
            video.evaluate((el: HTMLVideoElement) =>
                el.currentSrc.endsWith('/series/example-1.mp4')
            )
        )
        .toBe(true);
});

test('@web @m3u a live-only playlist gets no catalog sections', async ({
    page,
}) => {
    await importPlaylist(page, LIVE_ONLY_PLAYLIST);

    await expect(sidebarEntry(page, 'Live One')).toBeVisible();
    await expect(railLink(page, 'Movies')).toHaveCount(0);
    await expect(railLink(page, 'Series')).toHaveCount(0);
});
