import { expect, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';
import { playLive } from './live-media';

test('Space pauses fullscreen while remote OK and preview buttons keep their actions', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const video = await playLive(page);
    const back = page.locator('[data-focus="player-back"]');
    await back.focus();
    await page.keyboard.press('Space');
    await expect(video).toHaveJSProperty('paused', true);
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();

    const toggle = page.locator('[data-focus="player-toggle"]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(video).toHaveJSProperty('paused', false);
    await page.keyboard.press('Escape');
    await expect(page.locator('.native-player.preview')).toBeVisible();
    await expect(page.locator('[data-focus="live-fullscreen"]')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('.native-player.fullscreen')).toBeVisible();
    await expect(video).toHaveJSProperty('paused', false);
});

test('a channel dialog button owns Space without pausing the stream', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const video = await playLive(page);
    await page.locator('[data-focus="player-channels"]').click();
    const drawer = page.getByRole('dialog', { name: 'Channel browser' });
    const close = drawer.locator('[data-focus="channels-close"]');
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Space');
    await expect(drawer).toBeHidden();
    await expect(video).toHaveJSProperty('paused', false);
});

test('picture clicks and Space after seeking toggle playback without activating the controls', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.locator('[data-focus="detail-play"]').click();
    const player = page.locator('.native-player.fullscreen');
    const video = player.locator('video');
    await expect
        .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime)
        )
        .toBeGreaterThan(0.1);

    await player.getByRole('heading').click();
    await expect(video).toHaveJSProperty('paused', false);
    await page.mouse.click(960, 540);
    await expect(video).toHaveJSProperty('paused', true);

    const slider = player.getByRole('slider', { name: 'Playback position' });
    await slider.click({ position: { x: 30, y: 5 } });
    await expect(slider).toBeFocused();
    await expect(video).toHaveJSProperty('paused', true);
    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('0');
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('1');
    await page.keyboard.press('Space');
    await expect(video).toHaveJSProperty('paused', false);
});
