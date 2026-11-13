import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { interceptProviderTargetRegistration } from './provider-target-route';
import {
    addLiveFormatPortal,
    configureLiveFormat,
    expectLiveFormatPlaying,
    liveChannels,
    liveFormatMock,
} from './xtream-live-format.fixture';

/*
 * Multiview PiP in the PWA on the Xtream mock's `live-fallback` account with
 * the TS stream format: its channels play a local MPEG-TS clip.
 */

test.use({
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    serviceWorkers: 'block',
});
test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Chromium media engines'
);
test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await interceptProviderTargetRegistration(page);
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const url = new URL(route.request().url());
        url.host = new URL(liveFormatMock).host;
        await route.continue({ url: url.toString() });
    });
    await page.goto('/');
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tile = (page: Page, role: 'main' | 'pip') =>
    page.locator(`app-multiview-tile[data-tile-role="${role}"]`);

test('@web @pwa @xtream @playback multiview PiP starts from the dock and swaps', async ({
    page,
}) => {
    await configureLiveFormat(page, 'html5', 'ts');
    await addLiveFormatPortal(page);
    const main = (
        (await liveChannels(page)
            .nth(0)
            .locator('.channel-name')
            .textContent()) ?? ''
    ).trim();
    const added = (
        (await liveChannels(page)
            .nth(1)
            .locator('.channel-name')
            .textContent()) ?? ''
    ).trim();
    await liveChannels(page).first().click();
    const video = await expectLiveFormatPlaying(page, 'html5');

    const box = await video.boundingBox();
    await page.mouse.move(
        (box?.x ?? 0) + (box?.width ?? 0) / 2,
        (box?.y ?? 0) + (box?.height ?? 0) / 2
    );
    await page.locator('[data-test-id="player-controls-multiview"]').click();
    const picker = page.locator('app-multiview-picker-dialog');
    await expect(picker).toBeVisible();
    await page.locator('[data-test-id="multiview-picker-search"]').fill(added);
    await expect(
        picker.locator('app-multiview-picker-row', { hasText: added })
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();

    await expect(page.locator('app-multiview-tile')).toHaveCount(2);
    await expect(tile(page, 'pip')).toHaveAttribute(
        'aria-label',
        new RegExp(`${escape(added)}.*muted`)
    );
    await expect
        .poll(
            () =>
                tile(page, 'pip')
                    .locator('video')
                    .first()
                    .evaluate((v: HTMLVideoElement) => v.currentTime)
                    .catch(() => 0),
            { timeout: 30_000 }
        )
        .toBeGreaterThan(0.3);

    await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
    );
    await page.keyboard.press('s');
    await expect(tile(page, 'main')).toHaveAttribute(
        'aria-label',
        new RegExp(`${escape(added)}.*sound on`)
    );
    await expect(tile(page, 'pip')).toHaveAttribute(
        'aria-label',
        new RegExp(escape(main))
    );

    await page.locator('[data-test-id="multiview-bar-exit"]').click();
    await expect(page.locator('app-multiview-tile')).toHaveCount(0);
    await expectLiveFormatPlaying(page, 'html5');
});
