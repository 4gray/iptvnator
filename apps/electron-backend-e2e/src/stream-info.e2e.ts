import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    test,
} from './electron-test-fixtures';
import { expectOverlayContrastOnWhite } from './theme-contrast';

const streamHost = 'https://stream-info-fixture.test';
const media = readFileSync(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
);
const playlist = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="info-one" group-title="News",Positive News TV',
    `${streamHost}/one.webm`,
].join('\n');

/**
 * The popover's numbers come from the live `<video>` element, so this is the
 * one check that cannot be made in a unit test: a real playing stream must
 * produce real rows.
 */
test('@playback @electron stream info popover reports the playing stream', async ({
    dataDir,
}) => {
    // A fresh profile already defaults to Video.js with shared controls on.
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        const playlistPath = join(dataDir, 'stream-info.m3u');
        writeFileSync(playlistPath, playlist);
        await page.route(`${streamHost}/**`, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'video/webm',
                body: media,
            })
        );
        await goToDashboard(page);
        await importM3uPlaylistFromNativeDialog(app, playlistPath);
        await page.waitForURL(/\/workspace\/playlists\/.+/);
        await channelItemByTitle(page, 'Positive News TV').first().click();

        const video = page.locator('app-web-player-view video');
        await expect(video).toHaveCount(1);
        await expect
            .poll(() =>
                video.evaluate(
                    (element: HTMLVideoElement) =>
                        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
                )
            )
            .toBe(true);

        const controls = page.locator('app-player-controls');
        const infoButton = controls.getByTestId(
            'player-controls-stream-info-button'
        );
        await expect(infoButton).toBeVisible();

        // The icon sits over live video, so it is only readable because of the
        // top scrim. Assert that against a white backing — the worst case the
        // scrim exists for, and something no unit test can see (the SCSS is
        // not loaded there).
        const scrim = controls.getByTestId('player-controls-top-scrim');
        await expect(scrim).toHaveCount(1);
        expect(
            await scrim.evaluate(
                (element) => getComputedStyle(element).backgroundImage
            )
        ).toContain('gradient');
        await infoButton.hover();
        await expectOverlayContrastOnWhite(controls, infoButton);

        await infoButton.click();
        const panel = controls.getByTestId('player-controls-stream-info-panel');
        await expect(panel).toBeVisible();

        // The element knows its own size as soon as it has data, so the
        // resolution row is the one that must always be there.
        const rows = panel.locator('.player-controls__stats-row');
        await expect.poll(() => rows.first().innerText()).toMatch(/\d+ × \d+/);

        // Closing must dismiss the panel (and with it the sampling loop).
        await infoButton.click();
        await expect(panel).toHaveCount(0);
    } finally {
        await closeElectronApp(app);
    }
});
