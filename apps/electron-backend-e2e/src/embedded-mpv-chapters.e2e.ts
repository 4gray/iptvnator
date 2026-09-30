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
    const app = await launchElectronApp(dataDir, {
        env: {
            IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
            IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: '1',
            IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
        },
    });
    try {
        const support = await app.mainWindow.evaluate(() =>
            window.electron.getEmbeddedMpvSupport()
        );
        test.skip(
            !support.supported || support.engine !== 'frame-copy',
            `Frame-copy runtime unavailable: ${JSON.stringify(support)}`
        );
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'playback');
        await app.mainWindow.getByTestId('select-video-player').click();
        await app.mainWindow.getByTestId('embedded-mpv').click();
        await saveSettings(app.mainWindow);
        await goToDashboard(app.mainWindow);

        const playlist = join(dataDir, 'chapters.m3u');
        writeFileSync(
            playlist,
            `#EXTM3U\n#EXTINF:-1,Chaptered fixture\n${media.url}\n`
        );
        await installEmbeddedMpvSessionCapture(app);
        await importM3uPlaylistFromNativeDialog(app, playlist);
        await channelItemByTitle(app.mainWindow, 'Chaptered fixture')
            .first()
            .click();

        // The local frame-copy runtime can fail its first frame-view
        // initialization; one user Retry recovers it (see player-theme).
        await expect
            .poll(() =>
                app.mainWindow.evaluate(
                    () =>
                        (window.__packagedEmbeddedMpvSessions?.at(-1)?.chapters
                            ?.length ?? 0) > 0 ||
                        !!document.querySelector('.embedded-mpv-player__stalled')
                ),
                { timeout: 20000 }
            )
            .toBe(true);
        const stalled = app.mainWindow.locator('.embedded-mpv-player__stalled');
        if (await stalled.isVisible()) {
            await stalled.getByRole('button', { name: 'Retry' }).click();
        }

        await expect
            .poll(
                () =>
                    app.mainWindow.evaluate(
                        () =>
                            window.__packagedEmbeddedMpvSessions?.at(-1)
                                ?.chapters ?? []
                    ),
                { timeout: 20000 }
            )
            .toEqual([
                { timeSeconds: 0, title: 'Intro' },
                { timeSeconds: 5, title: 'Episode' },
                { timeSeconds: 24, title: 'Credits' },
            ]);

        const segments = app.mainWindow.locator(
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
    } finally {
        await closeElectronApp(app);
        await media.close();
    }
});
