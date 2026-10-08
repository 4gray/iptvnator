import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from './fixtures';

/**
 * A one-channel M3U playlist whose only stream is the local test clip, served
 * through route interception: the shared-controls specs play it in a web
 * engine without any remote media.
 */
const FIXTURE_HOST = 'https://player-settings-fixture.local';
export const CLIP_TITLE = 'Settings Clip';
const PLAYLIST = [
    '#EXTM3U',
    `#EXTINF:-1 group-title="Movies",${CLIP_TITLE}`,
    `${FIXTURE_HOST}/clip.mp4`,
].join('\n');

export async function serveClip(page: Page): Promise<void> {
    const clip = readFileSync(
        join(__dirname, 'fixtures/playback/episode.webm')
    );
    await page.route(`${FIXTURE_HOST}/**`, async (route) => {
        const range = /^bytes=(\d*)-(\d*)$/.exec(
            route.request().headers()['range'] ?? ''
        );
        const last = clip.length - 1;
        const start = range?.[1]
            ? Number(range[1])
            : range?.[2]
              ? Math.max(0, clip.length - Number(range[2]))
              : 0;
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

export async function selectPlayer(
    page: Page,
    player = 'HTML5 video player'
): Promise<void> {
    await page.goto('/workspace/settings/playback');
    const select = page.locator('[data-test-id="select-video-player"]');
    await expect(select).toBeVisible();
    const previous = await select.innerText();
    await select.click();
    await page.getByRole('option', { name: player, exact: true }).click();
    if (!previous.includes(player)) {
        const saveButton = page.getByRole('button', { name: 'Save changes' });
        await saveButton.click();
        await expect(saveButton).toBeHidden();
    }
}

/** Imports the playlist and returns the URL of its channel list. */
export async function importPlaylist(page: Page): Promise<string> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.getByLabel('Insert m3u(8) playlist as text').fill(PLAYLIST);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click(),
    ]);
    await expect(page.getByText('1 channels')).toBeVisible();
    return page.url();
}

/**
 * Starts the clip and pauses it with the dock revealed. The play button is
 * found by test id, so this works in every app language.
 */
export async function startClip(page: Page) {
    await page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: CLIP_TITLE })
        .click();
    const view = page.locator('app-web-player-view');
    const video = view.locator('video');
    await expect
        .poll(() =>
            video.evaluate(
                (el: HTMLVideoElement) =>
                    Number.isFinite(el.duration) &&
                    el.duration > 5 &&
                    !el.paused
            )
        )
        .toBe(true);
    // Reveal the dock and keep it revealed for the assertions below.
    await view.hover();
    const controls = view.locator('app-player-controls');
    await controls.locator('[data-test-id="player-controls-play"]').click();
    await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
        .toBe(true);
    return { view, video, controls };
}
