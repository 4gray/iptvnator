import { writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSettings,
    openGlobalFavorites,
    openGlobalRecent,
    openSettingsSection,
    saveSettings,
    test,
    workspaceRoot,
} from './electron-test-fixtures';
import {
    createLocalMediaServer,
    installEmbeddedMpvSessionCapture,
} from './embedded-mpv-frame-copy-packaged-fixtures';
import {
    applyTheme,
    expectTextContrast,
    expectThemeSurface,
    expectOverlayContrastOnWhite,
} from './theme-contrast';

for (const engine of [
    'native',
    'frame-copy',
    'html5',
    'videojs',
    'artplayer',
] as const) {
    test(`@playback @theme @electron ${engine} keeps controls readable across live theme and fullscreen changes`, async ({
        dataDir,
    }) => {
        const embedded = engine === 'native' || engine === 'frame-copy';
        const media = embedded ? await createLocalMediaServer() : undefined;
        const app = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
                IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY:
                    engine === 'frame-copy' ? '1' : '0',
                IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
            },
        });
        try {
            if (embedded) {
                const support = await app.mainWindow.evaluate(() =>
                    window.electron.getEmbeddedMpvSupport()
                );
                test.skip(
                    !support.supported || support.engine !== engine,
                    `Requested ${engine} runtime unavailable: ${JSON.stringify(support)}`
                );
            }
            await openSettings(app.mainWindow);
            await app.mainWindow.getByTestId('LIGHT_THEME').click();
            await openSettingsSection(app.mainWindow, 'playback');
            await app.mainWindow.getByTestId('select-video-player').click();
            await app.mainWindow
                .getByTestId(embedded ? 'embedded-mpv' : engine)
                .click();
            await saveSettings(app.mainWindow);
            await goToDashboard(app.mainWindow);
            const playlist = join(dataDir, 'theme.m3u');
            const url =
                media?.url ??
                pathToFileURL(
                    join(
                        workspaceRoot,
                        'apps/web-e2e/src/fixtures/playback/episode.webm'
                    )
                ).href;
            writeFileSync(
                playlist,
                `#EXTM3U\n#EXTINF:-1,Theme fixture\n${url}\n`
            );
            if (embedded) await installEmbeddedMpvSessionCapture(app);
            await importM3uPlaylistFromNativeDialog(app, playlist);
            if (engine === 'html5') {
                await channelItemByTitle(app.mainWindow, 'Theme fixture')
                    .first()
                    .locator('.favorite-button')
                    .first()
                    .click();
            }
            await channelItemByTitle(app.mainWindow, 'Theme fixture')
                .first()
                .click();
            if (engine === 'frame-copy') {
                // The experimental local runtime can fail its first frame-view
                // initialization. Cover the themed error UI and one user Retry;
                // successful decoding is still required below.
                await expect
                    .poll(() =>
                        app.mainWindow.evaluate(
                            () =>
                                (window.__packagedEmbeddedMpvSessions?.at(-1)
                                    ?.positionSeconds ?? 0) > 0 ||
                                !!document.querySelector(
                                    '.embedded-mpv-player__stalled'
                                )
                        )
                    )
                    .toBe(true);
                const stalled = app.mainWindow.locator(
                    '.embedded-mpv-player__stalled'
                );
                if (await stalled.isVisible()) {
                    test.info().annotations.push({
                        type: 'runtime-retry',
                        description:
                            'Frame-copy initialization required one user Retry before theme checks.',
                    });
                    for (const theme of ['dark', 'light'] as const) {
                        await applyTheme(app.mainWindow, theme);
                        await expectTextContrast(stalled.locator('p'));
                        await expectTextContrast(
                            stalled.getByRole('button', { name: 'Retry' })
                        );
                    }
                    await stalled
                        .getByRole('button', { name: 'Retry' })
                        .click();
                }
            }
            if (embedded) {
                await expect
                    .poll(() =>
                        app.mainWindow.evaluate(
                            () =>
                                window.__packagedEmbeddedMpvSessions?.at(-1)
                                    ?.positionSeconds ?? 0
                        )
                    )
                    .toBeGreaterThan(0);
            } else {
                await expect
                    .poll(() =>
                        app.mainWindow
                            .locator('app-web-player-view video')
                            .evaluate(
                                (video: HTMLVideoElement) => video.currentTime
                            )
                    )
                    .toBeGreaterThan(0);
            }
            const controls = app.mainWindow.locator(
                engine === 'native'
                    ? '.embedded-mpv-player__controls'
                    : 'app-player-controls'
            );
            const pause = controls.getByRole('button', {
                name: 'Pause',
                exact: true,
            });
            await expect(pause).toBeEnabled({ timeout: 20000 });
            await pause.click();
            const play = controls.getByRole('button', {
                name: 'Play',
                exact: true,
            });
            await expect(play).toBeVisible();
            for (const fullscreen of [false, true]) {
                if (fullscreen) {
                    await controls
                        .getByRole('button', {
                            name: 'Enter fullscreen',
                            exact: true,
                        })
                        .click();
                }
                for (const theme of ['light', 'dark', 'light'] as const) {
                    await applyTheme(app.mainWindow, theme);
                    await play.hover();
                    if (engine === 'native') await expectTextContrast(play, 3);
                    else await expectOverlayContrastOnWhite(controls, play);
                    // Leave pointer hover, then Tab back into the control to
                    // exercise a real keyboard focus-visible state.
                    await play.press('Tab');
                    await app.mainWindow.keyboard.press('Shift+Tab');
                    await expect(play).toBeFocused();
                    if (engine === 'native') await expectTextContrast(play, 3);
                    else await expectOverlayContrastOnWhite(controls, play);
                    if (!fullscreen) {
                        const timeline =
                            app.mainWindow.locator('app-epg-timeline');
                        await expectThemeSurface(timeline, theme);
                        await expectTextContrast(
                            timeline.locator('.epg-empty__title')
                        );
                        await expectTextContrast(
                            timeline.locator('.epg-empty__sub')
                        );
                    }
                    if (engine === 'native') {
                        await expectThemeSurface(controls, theme);
                        await expect(play).toHaveCSS('outline-width', '2px');
                        const disabled = controls
                            .locator(
                                '.embedded-mpv-player__transport button:disabled'
                            )
                            .first();
                        await expect(disabled).toBeDisabled();
                        await expectTextContrast(disabled, 1.5);
                        expect(
                            await disabled.evaluate(
                                (el) => getComputedStyle(el).color
                            )
                        ).not.toEqual(
                            await play.evaluate(
                                (el) => getComputedStyle(el).color
                            )
                        );
                        await expectTextContrast(
                            controls.locator('.embedded-mpv-player__time')
                        );
                    }
                    if (engine === 'native') {
                        await controls
                            .locator('[data-embedded-mpv-menu-button="speed"]')
                            .click();
                        const panel = controls.locator(
                            'app-embedded-mpv-dock-panel'
                        );
                        await expectTextContrast(
                            panel.locator('.embedded-mpv-dock-panel__title')
                        );
                        const selected = panel.locator(
                            '.embedded-mpv-dock-panel__chip--selected'
                        );
                        await expectTextContrast(selected);
                        await selected.hover();
                        await expectTextContrast(selected);
                        await panel
                            .locator('.embedded-mpv-dock-panel__back')
                            .click();
                    }
                    const controlBox = await controls.boundingBox();
                    const playBox = await play.boundingBox();
                    expect(playBox!.x).toBeGreaterThanOrEqual(controlBox!.x);
                    expect(playBox!.y + playBox!.height).toBeLessThanOrEqual(
                        controlBox!.y + controlBox!.height + 1
                    );
                    await app.mainWindow.screenshot({
                        path: test
                            .info()
                            .outputPath(
                                `${engine}-${theme}-${fullscreen ? 'fullscreen' : 'window'}.png`
                            ),
                    });
                }
            }
            await controls
                .getByRole('button', { name: 'Exit fullscreen', exact: true })
                .click();
            if (engine === 'html5') {
                for (const openCollection of [
                    openGlobalFavorites,
                    openGlobalRecent,
                ]) {
                    await openCollection(app.mainWindow);
                    await channelItemByTitle(app.mainWindow, 'Theme fixture')
                        .first()
                        .click();
                    for (const theme of ['light', 'dark'] as const) {
                        await applyTheme(app.mainWindow, theme);
                        const timeline =
                            app.mainWindow.locator('app-epg-timeline');
                        await expect(timeline).toBeVisible();
                        await expectThemeSurface(timeline, theme);
                        await expectTextContrast(
                            timeline.locator('.epg-timeline__heading b')
                        );
                    }
                }
            }
        } finally {
            await closeElectronApp(app);
            await media?.close();
        }
    });
}
