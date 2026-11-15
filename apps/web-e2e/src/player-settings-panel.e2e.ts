import { expect, test } from './fixtures';
import {
    importPlaylist,
    selectPlayer,
    serveClip,
    startClip,
} from './player-settings-panel.fixture';

/**
 * The settings button opens a side panel on a wide player and a bottom
 * sheet on a compact player. Choices apply in place, and a tap on the video
 * dismisses. Runs against the built-in HTML5 player and a local clip so no
 * remote media is involved.
 */

test.use({ serviceWorkers: 'block' });

test('@web @playback settings panel opens beside the video and applies speed in place', async ({
    page,
}) => {
    test.setTimeout(90_000);
    // The side panel needs a player of at least 960px.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await serveClip(page);
    await selectPlayer(page);
    await importPlaylist(page);
    const { video, controls } = await startClip(page);

    const tune = controls.locator(
        '[data-test-id="player-controls-settings-button"]'
    );
    await expect(
        controls.locator('[data-test-id="player-controls-speed-chip"]')
    ).toHaveCount(0);
    await expect(
        controls.locator('[data-test-id="player-controls-subtitle-chip"]')
    ).toHaveCount(0);
    await expect(
        controls.getByRole('button', { name: 'Add second stream', exact: true })
    ).toHaveCount(0);
    await expect(
        controls.locator('[data-test-id="player-controls-settings-panel"]')
    ).toHaveCount(0);

    await tune.click();
    const panel = controls.getByRole('dialog', { name: 'Settings' });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveClass(/player-controls__settings--sheet/);
    await expect(controls.locator('.player-controls__bar')).toHaveClass(
        /player-controls__bar--panel-open/
    );
    await expect(tune).toHaveAttribute('aria-expanded', 'true');

    await panel.getByRole('radio', { name: '1.5×', exact: true }).click();
    await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.playbackRate))
        .toBe(1.5);
    // The choice keeps the panel open for comparison…
    await expect(panel).toBeVisible();

    // Escape closes the panel and reveals the changed-settings indicator.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(controls.locator('.player-controls__bar')).not.toHaveClass(
        /player-controls__bar--panel-open/
    );
    await expect(
        tune.locator('.player-controls__tune-dot--violet')
    ).toHaveCount(1);
});

test('@web @playback compact player opens settings as a bottom sheet', async ({
    page,
}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 900, height: 700 });
    await serveClip(page);
    await selectPlayer(page);
    await importPlaylist(page);
    const { view, controls } = await startClip(page);

    await expect(controls.locator('.player-controls__bar')).toHaveClass(
        /player-controls__bar--compact/
    );

    const tune = controls.locator(
        '[data-test-id="player-controls-settings-button"]'
    );
    await tune.click();
    const sheet = controls.getByRole('dialog', { name: 'Settings' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveClass(/player-controls__settings--sheet/);
    await expect(controls.locator('.player-controls__bar')).toHaveClass(
        /player-controls__bar--sheet-open/
    );

    await sheet.getByRole('radio', { name: '2×', exact: true }).click();
    await expect
        .poll(() =>
            view
                .locator('video')
                .evaluate((el: HTMLVideoElement) => el.playbackRate)
        )
        .toBe(2);
    // A modified value shows as a violet dot once the sheet is closed.
    await sheet.locator('[data-test-id="player-settings-close"]').click();
    await expect(sheet).toHaveCount(0);
    await expect(
        controls
            .locator('[data-test-id="player-controls-settings-dots"]')
            .locator('.player-controls__tune-dot--violet')
    ).toHaveCount(1);

    // Reopen and dismiss by tapping the video: the tap closes the sheet
    // instead of toggling playback.
    await tune.click();
    await expect(sheet).toBeVisible();
    await view
        .locator('video')
        .click({ position: { x: 40, y: 40 }, force: true });
    await expect(sheet).toHaveCount(0);
    await expect(
        controls.getByRole('button', { name: 'Play', exact: true })
    ).toBeVisible();
});
