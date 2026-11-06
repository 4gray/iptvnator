import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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
    workspaceRoot,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    createLocalMediaServer,
    installEmbeddedMpvSessionCapture,
} from './embedded-mpv-frame-copy-packaged-fixtures';

/**
 * mpv's `chapter-list` must reach the shared controls: the chaptered fixture
 * (Intro 0 s, Episode 5 s, Credits 24 s of 30 s) is drawn as three titled
 * timeline segments. Frame-copy is the Embedded MPV engine that mounts
 * `app-player-controls`; the test skips where that runtime is unavailable.
 */
test('@playback @electron @embedded-mpv frame-copy draws file chapters on the timeline', async ({
    dataDir,
}) => {
    const media = await createLocalMediaServer({
        body: readFileSync(
            join(
                workspaceRoot,
                'apps/web-e2e/src/fixtures/playback/episode-chapters.webm'
            )
        ),
        resourcePath: '/episode-chapters.webm',
        contentType: 'video/webm',
    });
    // The launch sits inside the cleanup scope: a failed launch must still
    // close the media server.
    let app: LaunchedElectronApp | undefined;
    try {
        const launched = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
                IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: '1',
                IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
            },
        });
        app = launched;
        const support = await launched.mainWindow.evaluate(() =>
            window.electron.getEmbeddedMpvSupport()
        );
        test.skip(
            !support.supported || support.engine !== 'frame-copy',
            `Frame-copy runtime unavailable: ${JSON.stringify(support)}`
        );
        await openSettings(launched.mainWindow);
        await openSettingsSection(launched.mainWindow, 'playback');
        await launched.mainWindow.getByTestId('select-video-player').click();
        await launched.mainWindow.getByTestId('embedded-mpv').click();
        await saveSettings(launched.mainWindow);
        await goToDashboard(launched.mainWindow);

        const playlist = join(dataDir, 'chapters.m3u');
        writeFileSync(
            playlist,
            `#EXTM3U\n#EXTINF:-1,Chaptered fixture\n${media.url}\n`
        );
        await installEmbeddedMpvSessionCapture(launched);
        await importM3uPlaylistFromNativeDialog(launched, playlist);
        await channelItemByTitle(launched.mainWindow, 'Chaptered fixture')
            .first()
            .click();

        // The local frame-copy runtime can fail a frame-view initialization,
        // and the failure can surface at any point while the session starts;
        // a user Retry recovers it (see player-theme). Retry whenever the
        // stalled state shows until mpv's chapters arrive.
        const stalled = launched.mainWindow.locator(
            '.embedded-mpv-player__stalled'
        );
        await expect(async () => {
            if (await stalled.isVisible()) {
                await stalled.getByRole('button', { name: 'Retry' }).click();
            }
            expect(
                await launched.mainWindow.evaluate(
                    () =>
                        window.__packagedEmbeddedMpvSessions?.at(-1)
                            ?.chapters ?? []
                )
            ).toEqual([
                { timeSeconds: 0, title: 'Intro' },
                { timeSeconds: 5, title: 'Episode' },
                { timeSeconds: 24, title: 'Credits' },
            ]);
        }).toPass({ timeout: 30000 });

        const segments = launched.mainWindow.locator(
            'app-player-controls .player-controls__timeline-segment'
        );
        await expect(segments).toHaveCount(3);
        await expect
            .poll(() =>
                segments.evaluateAll((elements) =>
                    elements.map((element) => ({
                        title: element.getAttribute('data-segment-title'),
                        left: Math.round(parseFloat(element.style.left)),
                    }))
                )
            )
            .toEqual([
                { title: 'Intro', left: 0 },
                { title: 'Episode', left: 17 },
                { title: 'Credits', left: 80 },
            ]);
        // The seek bar names the chapter at the position for assistive
        // technology, as it does for catch-up programmes.
        await expect(
            launched.mainWindow.locator(
                'app-player-controls .player-controls__slider--timeline'
            )
        ).toHaveAttribute(
            'aria-valuetext',
            /^(Intro|Episode|Credits) · \d+:\d{2}$/
        );
    } finally {
        try {
            if (app) {
                await closeElectronApp(app);
            }
        } finally {
            await media.close();
        }
    }
});
