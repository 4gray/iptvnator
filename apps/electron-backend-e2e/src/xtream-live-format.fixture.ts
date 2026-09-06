import { expect, type Page } from '@playwright/test';

export const liveFormatMock = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;
export type LiveFormatPlayer = 'html5' | 'videojs' | 'artplayer';

export async function configureLiveFormat(
    page: Page,
    player: LiveFormatPlayer,
    format = 'auto'
) {
    await page.getByRole('link', { name: 'Open settings' }).click();
    await page.locator('[data-test-id="settings-section-playback"]').click();
    await page.locator('[data-test-id="select-video-player"]').click();
    await page
        .getByRole('option', {
            name: {
                html5: 'HTML5 video player',
                videojs: 'Video.js player',
                artplayer: 'ArtPlayer',
            }[player],
            exact: true,
        })
        .click();
    await page.locator('[data-test-id="select-stream-format"]').click();
    await page.getByRole('option', { name: format, exact: true }).click();
    if (player !== 'videojs' || format !== 'auto') {
        const save = page.getByRole('button', { name: 'Save changes' });
        await expect(save).toBeVisible();
        await save.click();
        await expect(save).toBeHidden();
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
}

export async function addLiveFormatPortal(page: Page) {
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Xtream credentials/i }).click();
    await dialog.locator('#title').fill('Synthetic live');
    await dialog.locator('#serverUrl').fill(liveFormatMock);
    await dialog.locator('#username').fill('live-fallback');
    await dialog.locator('#password').fill('live-fallback');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForURL(/xtreams.*vod/);
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page.locator('.context-panel .category-item').first().click();
    await expect(liveChannels(page).first()).toBeVisible();
}

export const liveChannels = (page: Page) =>
    page.locator('app-live-stream-layout [data-test-id="channel-item"]');
export function observeLiveFormatMedia(page: Page) {
    const media: { file: string; status: number }[] = [];
    page.on('response', (response) => {
        if (response.url().startsWith(`${liveFormatMock}/live/`))
            media.push({
                file: new URL(response.url()).pathname.split('/').pop() ?? '',
                status: response.status(),
            });
    });
    return media;
}
export async function expectLiveFormatPlaying(
    page: Page,
    player: LiveFormatPlayer
) {
    await expect(
        page.locator(
            `app-${player === 'html5' ? 'html-video' : player === 'videojs' ? 'vjs' : 'art'}-player`
        )
    ).toBeVisible();
    const video = page.locator('app-web-player-view video').first();
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
            timeout: 50_000,
        })
        .toBeGreaterThan(0.5);
    return video;
}
