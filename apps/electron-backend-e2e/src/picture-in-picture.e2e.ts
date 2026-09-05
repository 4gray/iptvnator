import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    m3uFixturePath,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
} from './electron-test-fixtures';

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
                await goToDashboard(page);
                await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
                await page.waitForURL(/\/workspace\/playlists\/.+/);
                // The test exercises the real settings/channel/host lifecycle.
                // Keep synthetic HLS pending and emulate only the OS PiP API,
                // which is not reliably available on headless CI desktops.
                await page.route(
                    'https://example.channels/**',
                    () => undefined
                );
                await channelItemByTitle(page, 'Channel 1').first().click();
                const video = page.locator('app-web-player-view video');
                await expect(video).toHaveCount(1);
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

                await channelItemByTitle(page, 'Positive News TV')
                    .first()
                    .click();

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
