import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
} from './electron-test-fixtures';

const streamHost = 'https://pip-fixture.test';
const media = readFileSync(
    join(__dirname, '../../web-e2e/src/fixtures/playback/episode.webm')
);
const playlist = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="pip-one" group-title="News",Channel 1',
    `${streamHost}/one.webm`,
    '#EXTINF:-1 tvg-id="pip-two" group-title="News",Positive News TV',
    `${streamHost}/two.webm`,
].join('\n');

for (const player of ['html5', 'videojs', 'artplayer']) {
    for (const sharedControls of [false, true]) {
        test(`@playback @electron closes ${player} PiP on channel change (shared controls: ${sharedControls})`, async ({
            dataDir,
        }) => {
            const app = await launchElectronApp(dataDir);
            const page = app.mainWindow;
            try {
                await openSettings(page);
                await openSettingsSection(page, 'playback');
                await page.getByTestId('select-video-player').click();
                await page.getByTestId(player).click();
                await page
                    .getByTestId('web-player-shared-controls-setting')
                    .locator('input[type="checkbox"]')
                    .setChecked(sharedControls);
                // The default Video.js/shared combination may already be saved.
                if (await page.getByTestId('save-settings').isVisible()) {
                    await saveSettings(page);
                }
                const playlistPath = join(dataDir, 'pip.m3u');
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
                // Import can auto-select the first channel. Select a distinct
                // source and wait for its actual media to load before owning PiP;
                // merely finding a video can capture the retiring initial host.
                await channelItemByTitle(page, 'Positive News TV')
                    .first()
                    .click();
                const video = page.locator('app-web-player-view video');
                await expect(video).toHaveCount(1);
                await expect
                    .poll(() =>
                        video.evaluate((element: HTMLVideoElement) => ({
                            source: element.currentSrc,
                            loaded:
                                element.readyState >=
                                HTMLMediaElement.HAVE_CURRENT_DATA,
                        }))
                    )
                    .toEqual({
                        source: `${streamHost}/two.webm`,
                        loaded: true,
                    });
                // Emulate only the OS PiP API, unavailable on headless CI.
                const oldVideo = await video.elementHandle();
                if (!oldVideo)
                    throw new Error(
                        'The selected channel has no video element'
                    );
                await oldVideo.evaluate((element: HTMLVideoElement) => {
                    let owner: Element | null = element;
                    Object.defineProperty(document, 'pictureInPictureElement', {
                        configurable: true,
                        get: () => owner,
                        set: (value: Element | null) => {
                            owner = value;
                        },
                    });
                    Object.defineProperty(document, 'exitPictureInPicture', {
                        configurable: true,
                        value: async () => {
                            const previous = owner;
                            owner = null;
                            previous?.dispatchEvent(
                                new Event('leavepictureinpicture')
                            );
                        },
                    });
                    element.dispatchEvent(new Event('enterpictureinpicture'));
                });
                await expect
                    .poll(() =>
                        page.evaluate(() => !!document.pictureInPictureElement)
                    )
                    .toBe(true);

                await channelItemByTitle(page, 'Channel 1').first().click();

                await expect
                    .poll(() =>
                        oldVideo.evaluate((element) => element.isConnected)
                    )
                    .toBe(false);
                await expect(video).toHaveCount(1);
                await expect
                    .poll(() =>
                        page.evaluate(
                            () => document.pictureInPictureElement === null
                        )
                    )
                    .toBe(true);
                // Native/vendor controls can finish a pending entry after the
                // host is gone. The retired element must close that entry too.
                if (!sharedControls) {
                    await oldVideo.evaluate((element) => {
                        Reflect.set(
                            document,
                            'pictureInPictureElement',
                            element
                        );
                        element.dispatchEvent(
                            new Event('enterpictureinpicture')
                        );
                    });
                    await expect
                        .poll(() =>
                            page.evaluate(
                                () => document.pictureInPictureElement === null
                            )
                        )
                        .toBe(true);
                }
                await oldVideo.dispose();
            } finally {
                await closeElectronApp(app);
            }
        });
    }
}
