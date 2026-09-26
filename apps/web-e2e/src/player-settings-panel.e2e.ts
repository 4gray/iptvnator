import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

/**
 * The shared controls' settings panel: on a wide player the speed chip opens
 * the panel beside the video and a choice applies in place; on a compact
 * player the tune button opens a bottom sheet that a tap on the video
 * dismisses. Runs against the built-in HTML5 player and a local clip so no
 * remote media is involved.
 */

const FIXTURE_HOST = 'https://player-settings-fixture.local';
const PLAYLIST = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="Movies",Settings Clip',
    `${FIXTURE_HOST}/clip.mp4`,
].join('\n');

test.use({ serviceWorkers: 'block' });

async function serveClip(page: Page): Promise<void> {
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

async function selectHtml5Player(page: Page): Promise<void> {
    await page.goto('/workspace/settings/playback');
    const select = page.locator('[data-test-id="select-video-player"]');
    await expect(select).toBeVisible();
    const previous = await select.innerText();
    await select.click();
    await page
        .getByRole('option', { name: 'HTML5 video player', exact: true })
        .click();
    if (!previous.includes('HTML5 video player')) {
        const saveButton = page.getByRole('button', { name: 'Save changes' });
        await saveButton.click();
        await expect(saveButton).toBeHidden();
    }
}

async function importPlaylist(page: Page): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.getByLabel('Insert m3u(8) playlist as text').fill(PLAYLIST);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Import', exact: true }).click(),
    ]);
    await expect(page.getByText('1 channels')).toBeVisible();
}

async function startClip(page: Page) {
    await page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: 'Settings Clip' })
        .click();
    const view = page.locator('app-web-player-view');
    const video = view.locator('video');
    await expect
        .poll(() =>
            video.evaluate(
                (el: HTMLVideoElement) =>
                    Number.isFinite(el.duration) && el.duration > 5
            )
        )
        .toBe(true);
    // Reveal the dock and keep it revealed for the assertions below.
    await view.hover();
    const controls = view.locator('app-player-controls');
    await controls.getByRole('button', { name: 'Pause', exact: true }).click();
    return { view, video, controls };
}

test('@web @playback settings panel opens from the speed chip and applies in place', async ({
    page,
}) => {
    test.setTimeout(90_000);
    // Chips and the side panel need a player of at least 960px.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await serveClip(page);
    await selectHtml5Player(page);
    await importPlaylist(page);
    const { video, controls } = await startClip(page);

    const speedChip = controls.locator(
        '[data-test-id="player-controls-speed-chip"]'
    );
    await expect(speedChip).toContainText('1×');
    await expect(
        controls.locator('[data-test-id="player-controls-settings-panel"]')
    ).toHaveCount(0);

    await speedChip.click();
    const panel = controls.getByRole('dialog', { name: 'Settings' });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveClass(/player-controls__settings--sheet/);
    await expect(controls.locator('.player-controls__bar')).toHaveClass(
        /player-controls__bar--panel-open/
    );
    // Chips fold away while the panel is open; the tune button lights up.
    await expect(speedChip).toHaveCount(0);
    await expect(
        controls.locator('[data-test-id="player-controls-settings-button"]')
    ).toHaveAttribute('aria-expanded', 'true');

    await panel.getByRole('radio', { name: '1.5×', exact: true }).click();
    await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.playbackRate))
        .toBe(1.5);
    // The choice keeps the panel open for comparison…
    await expect(panel).toBeVisible();

    // …and Escape closes it; the chip now reads the modified value.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(controls.locator('.player-controls__bar')).not.toHaveClass(
        /player-controls__bar--panel-open/
    );
    await expect(
        controls.locator('[data-test-id="player-controls-speed-chip"]')
    ).toContainText('1.5×');
    await expect(
        controls.locator('[data-test-id="player-controls-speed-chip"]')
    ).toHaveClass(/player-controls__chip--modified/);
});

test('@web @playback compact player folds the chips into a tune button with a bottom sheet', async ({
    page,
}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 900, height: 700 });
    await serveClip(page);
    await selectHtml5Player(page);
    await importPlaylist(page);
    const { view, controls } = await startClip(page);

    await expect(controls.locator('.player-controls__bar')).toHaveClass(
        /player-controls__bar--compact/
    );
    await expect(
        controls.locator('[data-test-id="player-controls-speed-chip"]')
    ).toHaveCount(0);

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
