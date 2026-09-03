import { Page } from '@playwright/test';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    createMutableTextServer,
    enableRemoteControl,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchCompetingElectronInstance,
    launchElectronApp,
    LaunchedElectronApp,
    m3uFixturePath,
    openGlobalRecent,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    defaultXtreamPassword,
    defaultXtreamUsername,
} from './electron-test-fixtures';
import { fetchXtreamVodFixture } from './portal-mock-fixtures';

const epgFixtureXml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="news-1">
    <display-name>News One</display-name>
  </channel>
  <programme start="20260328070000 +0000" stop="20260328080000 +0000" channel="news-1">
    <title>Morning Bulletin</title>
    <desc>Daily morning news.</desc>
  </programme>
</tv>
`;

test.describe('Electron Settings', () => {
    test('@settings @electron shows manual app update fallback when self-update is unavailable', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'about');

            await expect(app.mainWindow.getByTestId('app-update-status')).toBeVisible();
            await expect(app.mainWindow.getByTestId('app-update-check')).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('app-update-open-release')
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('app-update-download')
            ).toHaveCount(0);
            await expect(
                app.mainWindow.getByTestId('app-update-install')
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @electron gates external MPV playback behind double-click when enabled', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await installExternalPlayerLaunchCapture(app);

            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'playback');
            await expect(
                app.mainWindow.getByTestId(
                    'external-player-double-click-setting'
                )
            ).toHaveCount(0);

            await selectSettingsOption(
                app.mainWindow,
                'select-video-player',
                'mpv'
            );

            const doubleClickSetting = app.mainWindow.getByTestId(
                'external-player-double-click-setting'
            );
            const doubleClickCheckbox = doubleClickSetting.locator(
                'input[type="checkbox"]'
            );

            await expect(doubleClickSetting).toBeVisible();
            await expect(doubleClickCheckbox).not.toBeChecked();
            await saveSettings(app.mainWindow);

            await goToDashboard(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/);

            const firstChannel = channelItemByTitle(
                app.mainWindow,
                'Channel 1'
            ).first();

            await expect(firstChannel).toBeVisible({ timeout: 20000 });
            await firstChannel.click();
            await expectExternalPlayerLaunchCount(app, 1);
            await expectExternalPlayerLaunch(app, 0, {
                player: 'mpv',
                title: 'Channel 1',
                url: 'https://example.channels/path-to-file/1.m3u8',
            });

            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'playback');
            await expect(doubleClickSetting).toBeVisible();
            await doubleClickCheckbox.check();
            await saveSettings(app.mainWindow);
            await app.mainWindow.goBack();
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/);
            await resetExternalPlayerLaunches(app);

            const secondChannel = channelItemByTitle(
                app.mainWindow,
                'Positive News TV'
            ).first();

            await expect(secondChannel).toBeVisible({ timeout: 20000 });
            await secondChannel.click();
            await expect(secondChannel).toHaveClass(/active/);
            await expectNoExternalPlayerLaunchesAfterSettled(app);

            await secondChannel.dblclick();
            await expectExternalPlayerLaunchCount(app, 1);
            await expectExternalPlayerLaunch(app, 0, {
                player: 'mpv',
                title: 'Positive News TV',
                url: 'https://example.channels/path-to-file/2.m3u8',
            });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @persistence @electron refuses a second instance so it cannot break settings storage', async ({
        dataDir,
    }) => {
        const runningApp = await launchElectronApp(dataDir);

        try {
            const competing = await launchCompetingElectronInstance(dataDir);

            expect(
                {
                    exitCode: competing.exitCode,
                    signal: competing.signal,
                    timedOut: competing.timedOut,
                },
                competing.stderr
            ).toEqual({ exitCode: 0, signal: null, timedOut: false });
            // The running instance keeps its window and its storage lock.
            expect(runningApp.electronApp.windows().length).toBeGreaterThan(0);
            await expect(runningApp.mainWindow.locator('body')).toBeVisible();
        } finally {
            await closeElectronApp(runningApp);
        }

        // The lock is released on exit, so a later launch starts normally.
        const relaunch = await launchElectronApp(dataDir);
        await closeElectronApp(relaunch);
    });

    test('@settings @electron re-opens a window when a second launch arrives with none open', async ({
        dataDir,
    }) => {
        // Only macOS keeps the process alive after its last window closes;
        // elsewhere `window-all-closed` quits and the next launch is a plain
        // cold start.
        test.skip(
            process.platform !== 'darwin',
            'macOS-only windowless-process behaviour'
        );
        const runningApp = await launchElectronApp(dataDir);

        try {
            await runningApp.electronApp.evaluate(({ BrowserWindow }) => {
                for (const window of BrowserWindow.getAllWindows()) {
                    window.close();
                }
            });
            await expect
                .poll(() => runningApp.electronApp.windows().length)
                .toBe(0);

            const recreatedWindow =
                runningApp.electronApp.waitForEvent('window');
            const competing = await launchCompetingElectronInstance(dataDir);

            expect(competing.timedOut).toBe(false);
            expect(competing.exitCode).toBe(0);
            // Without this the guard would quit the launch into nothing and
            // leave the user staring at no window at all.
            await expect((await recreatedWindow).locator('body')).toBeVisible();
        } finally {
            await closeElectronApp(runningApp);
        }
    });

    test('@settings @persistence @electron persists changed desktop settings across app restart', async ({
        dataDir,
    }) => {
        const epgServer = await createMutableTextServer(epgFixtureXml, {
            contentType: 'application/xml; charset=utf-8',
            resourcePath: '/settings-guide.xml',
        });
        const firstLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(firstLaunch.mainWindow);
            await selectSettingsOption(
                firstLaunch.mainWindow,
                'select-language',
                'de'
            );
            await firstLaunch.mainWindow
                .locator('[data-test-id="DARK_THEME"]')
                .click();
            await openSettingsSection(firstLaunch.mainWindow, 'playback');
            await selectSettingsOption(
                firstLaunch.mainWindow,
                'select-video-player',
                'html5'
            );
            const sharedControlsCheckbox = firstLaunch.mainWindow
                .getByTestId('web-player-shared-controls-setting')
                .locator('input[type="checkbox"]');
            await expect(sharedControlsCheckbox).toBeVisible();
            // Shared controls default ON — persist the discriminating opt-out
            // so the relaunch proves an explicit false survives the
            // absent-means-true coercion.
            await sharedControlsCheckbox.uncheck();
            await selectSettingsOption(
                firstLaunch.mainWindow,
                'select-stream-format',
                'ts'
            );
            await firstLaunch.mainWindow
                .locator(
                    'mat-checkbox[formcontrolname="showExternalPlaybackBar"] input[type="checkbox"]'
                )
                .uncheck();
            await enableRemoteControl(firstLaunch.mainWindow, 8877);
            await openSettingsSection(firstLaunch.mainWindow, 'epg');
            await firstLaunch.mainWindow
                .getByRole('button', { name: 'Add EPG source' })
                .click();
            await firstLaunch.mainWindow
                .locator('.epg-source-row input')
                .first()
                .fill(epgServer.resourceUrl);
            await saveSettings(firstLaunch.mainWindow);
        } finally {
            await closeElectronApp(firstLaunch);
        }

        const secondLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(secondLaunch.mainWindow);

            await expect(
                secondLaunch.mainWindow.getByTestId('select-language')
            ).toContainText('Deutsch');
            await expect(
                secondLaunch.mainWindow.locator('[data-test-id="DARK_THEME"]')
            ).toHaveAttribute('aria-checked', 'true');
            await openSettingsSection(secondLaunch.mainWindow, 'playback');
            await expect(
                secondLaunch.mainWindow.getByTestId('select-video-player')
            ).toContainText(/HTML5/i);
            await expect(
                secondLaunch.mainWindow
                    .getByTestId('web-player-shared-controls-setting')
                    .locator('input[type="checkbox"]')
            ).not.toBeChecked();
            await expect(
                secondLaunch.mainWindow.getByTestId('select-stream-format')
            ).toContainText('ts');
            await expect(
                secondLaunch.mainWindow.locator(
                    'mat-checkbox[formcontrolname="showExternalPlaybackBar"] input[type="checkbox"]'
                )
            ).not.toBeChecked();
            await openSettingsSection(secondLaunch.mainWindow, 'remote-control');
            await expect(
                secondLaunch.mainWindow.locator(
                    'mat-checkbox[formcontrolname="remoteControl"] input[type="checkbox"]'
                )
            ).toBeChecked();
            await expect(
                secondLaunch.mainWindow.locator('#remoteControlPort')
            ).toHaveValue('8877');
            await openSettingsSection(secondLaunch.mainWindow, 'epg');
            await expect(
                secondLaunch.mainWindow.locator('.epg-source-row input').first()
            ).toHaveValue(epgServer.resourceUrl);
        } finally {
            await closeElectronApp(secondLaunch);
            await epgServer.close();
        }
    });

    test('@settings @playback @electron applies shared controls to the next HTML5 session', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'playback');
            await selectSettingsOption(
                app.mainWindow,
                'select-video-player',
                'html5'
            );
            const sharedControlsCheckbox = app.mainWindow
                .getByTestId('web-player-shared-controls-setting')
                .locator('input[type="checkbox"]');
            await expect(sharedControlsCheckbox).toBeVisible();
            await sharedControlsCheckbox.check();
            await saveSettings(app.mainWindow);

            await goToDashboard(app.mainWindow);
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/);
            await app.mainWindow.route(
                'https://example.channels/path-to-file/1.m3u8',
                () => {
                    // Keep the synthetic stream pending so its network failure
                    // cannot replace the shared controls with a diagnostic.
                }
            );

            const firstChannel = channelItemByTitle(
                app.mainWindow,
                'Channel 1'
            ).first();

            await expect(firstChannel).toBeVisible({ timeout: 20000 });
            await firstChannel.click();
            const video = app.mainWindow.locator(
                'app-html-video-player video'
            );
            await expect(video).toBeAttached();
            await video.evaluate<void, HTMLVideoElement>((video) => {
                const ownerDocument = video.ownerDocument;
                let activePictureInPictureElement: Element | null = null;
                video.dataset['pictureInPictureRequestCount'] = '0';
                video.dataset['pictureInPictureExitCount'] = '0';

                Object.defineProperty(
                    ownerDocument,
                    'pictureInPictureEnabled',
                    {
                        configurable: true,
                        value: true,
                    }
                );
                Object.defineProperty(
                    ownerDocument,
                    'pictureInPictureElement',
                    {
                        configurable: true,
                        get: () => activePictureInPictureElement,
                    }
                );
                Object.defineProperty(ownerDocument, 'exitPictureInPicture', {
                    configurable: true,
                    value: async (): Promise<void> => {
                        video.dataset['pictureInPictureExitCount'] = String(
                            Number(
                                video.dataset['pictureInPictureExitCount'] ??
                                    '0'
                            ) + 1
                        );
                        const previousOwner = activePictureInPictureElement;
                        activePictureInPictureElement = null;
                        previousOwner?.dispatchEvent(
                            new Event('leavepictureinpicture')
                        );
                    },
                });
                Object.defineProperty(video, 'requestPictureInPicture', {
                    configurable: true,
                    value: async (): Promise<PictureInPictureWindow> => {
                        video.dataset['pictureInPictureRequestCount'] = String(
                            Number(
                                video.dataset['pictureInPictureRequestCount'] ??
                                    '0'
                            ) + 1
                        );
                        activePictureInPictureElement = video;
                        video.dispatchEvent(new Event('enterpictureinpicture'));

                        const pictureInPictureWindow: PictureInPictureWindow =
                            Object.assign(new EventTarget(), {
                                height: video.videoHeight,
                                onresize: null,
                                width: video.videoWidth,
                            });
                        return pictureInPictureWindow;
                    },
                });
                Object.defineProperty(video, 'disablePictureInPicture', {
                    configurable: true,
                    value: false,
                });
                Object.defineProperty(video, 'readyState', {
                    configurable: true,
                    value: HTMLMediaElement.HAVE_METADATA,
                });
                video.dispatchEvent(new Event('loadedmetadata'));
            });

            const playerControls = app.mainWindow.locator(
                'app-html-video-player app-player-controls'
            );
            await expect(playerControls).toBeVisible();
            await expect(
                app.mainWindow.locator('app-html-video-player video[controls]')
            ).toHaveCount(0);
            const enterPictureInPicture = playerControls.getByRole('button', {
                name: 'Enter picture-in-picture',
            });

            await expect(enterPictureInPicture).toBeVisible();
            await expect(enterPictureInPicture).toBeEnabled();
            await expect(enterPictureInPicture).toHaveAttribute(
                'aria-pressed',
                'false'
            );
            await expect(video).toHaveAttribute(
                'data-picture-in-picture-request-count',
                '0'
            );
            await enterPictureInPicture.click();
            await expect(video).toHaveAttribute(
                'data-picture-in-picture-request-count',
                '1'
            );

            const exitPictureInPicture = playerControls.getByRole('button', {
                name: 'Exit picture-in-picture',
            });
            await expect(exitPictureInPicture).toBeVisible();
            await expect(exitPictureInPicture).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            await expect(video).toHaveAttribute(
                'data-picture-in-picture-exit-count',
                '0'
            );
            await exitPictureInPicture.click();
            await expect(video).toHaveAttribute(
                'data-picture-in-picture-exit-count',
                '1'
            );
            await expect(enterPictureInPicture).toBeVisible();
            await expect(enterPictureInPicture).toHaveAttribute(
                'aria-pressed',
                'false'
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @electron intercepts window close while settings edits are unsaved', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await selectSettingsOption(app.mainWindow, 'select-language', 'de');
            await expect(
                app.mainWindow.getByTestId('settings-unsaved-bar')
            ).toBeVisible();
            // Round-trip on the same renderer->main IPC pipe: once this
            // resolves, the earlier close-guard arming has been processed.
            await app.mainWindow.evaluate(() =>
                window.electron.getWindowState()
            );

            const requestWindowClose = () =>
                app.electronApp.evaluate(({ BrowserWindow }) => {
                    BrowserWindow.getAllWindows()[0]?.close();
                });

            await requestWindowClose();

            // The close is intercepted: the window stays open and the same
            // save/discard/stay dialog the router guard shows takes over.
            await expect(
                app.mainWindow.getByTestId('unsaved-dialog-stay')
            ).toBeVisible();
            expect(app.electronApp.windows()).toHaveLength(1);

            await app.mainWindow.getByTestId('unsaved-dialog-stay').click();
            await expect(
                app.mainWindow.getByTestId('unsaved-dialog-stay')
            ).toHaveCount(0);
            expect(app.electronApp.windows()).toHaveLength(1);

            // Second attempt, this time saving: the close then completes.
            await requestWindowClose();
            await expect(
                app.mainWindow.getByTestId('unsaved-dialog-save')
            ).toBeVisible();
            await app.mainWindow
                .getByTestId('unsaved-dialog-save')
                .click({ noWaitAfter: true });
            await expect.poll(() => app.electronApp.windows().length).toBe(0);
        } finally {
            await closeElectronApp(app);
        }

        // The save the dialog promised actually landed before the close.
        const relaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(relaunch.mainWindow);
            await expect(
                relaunch.mainWindow.getByTestId('select-language')
            ).toContainText('Deutsch');
        } finally {
            await closeElectronApp(relaunch);
        }
    });

    test('@settings @persistence @electron persists the EPG view mode across app restart', async ({
        dataDir,
    }) => {
        const firstLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(firstLaunch.mainWindow);
            await openSettingsSection(firstLaunch.mainWindow, 'epg');
            const listToggle = firstLaunch.mainWindow.locator(
                '[data-test-id="epg-view-mode-list"]'
            );
            await expect(listToggle).toBeVisible();
            await listToggle.click();
            await expect(listToggle).toHaveAttribute('aria-checked', 'true');
            await saveSettings(firstLaunch.mainWindow);
        } finally {
            await closeElectronApp(firstLaunch);
        }

        const secondLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(secondLaunch.mainWindow);
            await openSettingsSection(secondLaunch.mainWindow, 'epg');
            await expect(
                secondLaunch.mainWindow.locator(
                    '[data-test-id="epg-view-mode-list"]'
                )
            ).toHaveAttribute('aria-checked', 'true');
        } finally {
            await closeElectronApp(secondLaunch);
        }
    });

    test('@settings @electron starts on sources when dashboard is disabled', async ({ dataDir }) => {
        const firstLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(firstLaunch.mainWindow);
            await openSettingsSection(firstLaunch.mainWindow, 'dashboard');
            await firstLaunch.mainWindow
                .locator(
                    'mat-checkbox[formcontrolname="showDashboard"] input[type="checkbox"]'
                )
                .uncheck();
            for (const toggleId of [
                'toggle-dashboard-hero',
                'toggle-dashboard-rail-continue-watching',
                'toggle-dashboard-rail-live-favorites',
                'toggle-dashboard-rail-recently-watched-live',
                'toggle-dashboard-rail-favorite-movies-and-series',
                'toggle-dashboard-rail-recent-sources',
                'toggle-dashboard-rail-xtream-recently-added',
                'toggle-dashboard-rail-tmdb-trending',
                'toggle-dashboard-rail-tmdb-recommendations',
            ]) {
                await expect(
                    firstLaunch.mainWindow
                        .getByTestId(toggleId)
                        .locator('input[type="checkbox"]')
                ).toBeDisabled();
            }
            await saveSettings(firstLaunch.mainWindow);
        } finally {
            await closeElectronApp(firstLaunch);
        }

        const secondLaunch = await launchElectronApp(dataDir);

        try {
            await secondLaunch.mainWindow.waitForURL(/\/workspace\/sources$/);
            await expect(
                secondLaunch.mainWindow.getByRole('link', {
                    name: 'Dashboard',
                    exact: true,
                })
            ).toHaveCount(0);
            await expect(secondLaunch.mainWindow.locator('a.brand')).toHaveAttribute(
                'href',
                /\/workspace\/sources$/
            );
        } finally {
            await closeElectronApp(secondLaunch);
        }
    });

    test('@settings @dashboard @electron hides an individually disabled dashboard rail while dashboard remains enabled', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/);

            await goToDashboard(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('dashboard-recent-sources-rail')
            ).toBeVisible({ timeout: 20000 });

            await openSettings(app.mainWindow);
            await app.mainWindow
                .locator('.settings-section-item')
                .filter({ hasText: 'Dashboard' })
                .first()
                .click();
            await expect(
                app.mainWindow
                    .getByTestId('toggle-show-dashboard')
                    .locator('input[type="checkbox"]')
            ).toBeChecked();
            await app.mainWindow
                .getByTestId('toggle-dashboard-rail-recent-sources')
                .locator('input[type="checkbox"]')
                .uncheck();
            await saveSettings(app.mainWindow);

            await goToDashboard(app.mainWindow);
            await app.mainWindow.waitForURL(/\/workspace\/dashboard$/);
            await expect(
                app.mainWindow.getByTestId('dashboard-recent-sources-rail')
            ).toHaveCount(0);
            await expect(
                app.mainWindow.getByRole('link', {
                    name: 'Dashboard',
                    exact: true,
                })
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });

    // The TMDB recommendations rail itself needs the TMDB opt-in, live
    // TMDB data and catalog matches, so its rendering is covered by unit
    // tests rather than here. What IS deterministic — and what a form
    // regression would silently break — is that its toggle persists.
    test('@settings @dashboard @electron persists the TMDB recommendations rail toggle across a restart', async ({
        dataDir,
    }) => {
        let app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'dashboard');

            const toggle = app.mainWindow
                .getByTestId('toggle-dashboard-rail-tmdb-recommendations')
                .locator('input[type="checkbox"]');
            await expect(toggle).toBeChecked();
            await toggle.uncheck();
            await saveSettings(app.mainWindow);
        } finally {
            app = await restartElectronApp(app, dataDir);
        }

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'dashboard');
            await expect(
                app.mainWindow
                    .getByTestId('toggle-dashboard-rail-tmdb-recommendations')
                    .locator('input[type="checkbox"]')
            ).not.toBeChecked();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('restores the last section-level view across restart when configured', async ({
        dataDir,
    }) => {
        let app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await selectSettingsOption(
                app.mainWindow,
                'select-startup-behavior',
                'restore-last-view'
            );
            await saveSettings(app.mainWindow);

            await openGlobalRecent(app.mainWindow);
        } finally {
            app = await restartElectronApp(app, dataDir);
        }

        try {
            await app.mainWindow.waitForURL(/\/workspace\/global-recent$/);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('ignores settings and restores only the section root after a detail route', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const vodFixture = await fetchXtreamVodFixture(request, {
            password: defaultXtreamPassword,
            username: defaultXtreamUsername,
        });
        let app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await selectSettingsOption(
                app.mainWindow,
                'select-startup-behavior',
                'restore-last-view'
            );
            await saveSettings(app.mainWindow);

            await addXtreamPortal(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);

            await openWorkspaceSection(app.mainWindow, 'Movies');
            await clickCategoryByNameExact(
                app.mainWindow,
                vodFixture.categoryName
            );
            await clickFirstGridListCard(app.mainWindow);
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/vod\/[^/]+\/[^/]+$/
            );

            await openSettings(app.mainWindow);
        } finally {
            app = await restartElectronApp(app, dataDir);
        }

        try {
            await app.mainWindow.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod$/);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @electron @persistence sizes and clears the TMDB metadata cache', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            // Seeded through the same preload bridge the enrichment service
            // uses, so this exercises real IPC -> DB worker -> SQLite.
            // Enrichment itself cannot run here: it needs a TMDB API key,
            // which builds outside the release pipeline do not carry.
            await app.mainWindow.evaluate(async () => {
                await window.electron.dbSetTmdbMetadata({
                    mediaType: 'movie',
                    lookupKey: 'id:603|v2',
                    language: 'en-US',
                    tmdbId: 603,
                    payload: JSON.stringify({ id: 603, title: 'The Matrix' }),
                    fetchedAt: new Date().toISOString(),
                });
            });

            await openSettings(app.mainWindow);
            await app.mainWindow.getByTestId('settings-section-tmdb').click();

            // Sizing is deferred until this section is the active one
            await expect(
                app.mainWindow.getByTestId('tmdb-cache-size')
            ).toHaveText(/\b1 entries/);

            const clearButton =
                app.mainWindow.getByTestId('tmdb-clear-cache');
            await expect(clearButton).toBeEnabled();
            await clearButton.click();

            // Re-read reports an empty cache, so there is nothing to clear
            await expect(clearButton).toBeDisabled();
            await expect(
                app.mainWindow.getByTestId('tmdb-cache-size')
            ).toHaveText(/\b0 entries/);

            // ...and the row is gone from the database, not just the panel
            const remaining = await app.mainWindow.evaluate(() =>
                window.electron.dbGetTmdbMetadata('movie', 'id:603|v2', 'en-US')
            );
            expect(remaining).toBeNull();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @persistence @electron launches fullscreen once the startup window mode is saved and toggles it with F11', async ({
        dataDir,
    }) => {
        let app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('startup-window-mode-setting')
            ).toBeVisible();
            await selectSettingsOption(
                app.mainWindow,
                'select-startup-window-mode',
                'startup-window-mode-fullscreen'
            );
            await saveSettings(app.mainWindow);

            // The mode is read when the window is created, so saving it
            // leaves the running window alone.
            expect(await isMainWindowFullScreen(app)).toBe(false);
        } finally {
            app = await restartElectronApp(app, dataDir);
        }

        try {
            await expect
                .poll(() => isMainWindowFullScreen(app), { timeout: 10_000 })
                .toBe(true);
            await openSettings(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('select-startup-window-mode')
            ).toContainText(/Fullscreen/);

            // F11 is the way out on Windows/Linux, where the title bar is
            // hidden and the custom window controls hide while fullscreen.
            await app.mainWindow.keyboard.press('F11');
            await expect
                .poll(() => isMainWindowFullScreen(app), { timeout: 10_000 })
                .toBe(false);

            await app.mainWindow.keyboard.press('F11');
            await expect
                .poll(() => isMainWindowFullScreen(app), { timeout: 10_000 })
                .toBe(true);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @electron --fullscreen forces one fullscreen launch without persisting it', async ({
        dataDir,
    }) => {
        let app = await launchElectronApp(dataDir, {
            appArgs: ['--fullscreen'],
        });

        try {
            await expect
                .poll(() => isMainWindowFullScreen(app), { timeout: 10_000 })
                .toBe(true);
        } finally {
            app = await restartElectronApp(app, dataDir);
        }

        try {
            // The switch is a one-shot: the next plain launch follows the
            // stored setting, which is still the default.
            expect(await isMainWindowFullScreen(app)).toBe(false);
            await openSettings(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('select-startup-window-mode')
            ).toContainText(/Last window size/);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@settings @persistence @electron launches maximized when the startup window mode says so', async ({
        dataDir,
    }) => {
        test.skip(
            process.platform === 'linux' && !!process.env['CI'],
            'xvfb on Linux CI has no window manager, so maximize never takes effect'
        );
        let app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await selectSettingsOption(
                app.mainWindow,
                'select-startup-window-mode',
                'startup-window-mode-maximized'
            );
            await saveSettings(app.mainWindow);
        } finally {
            app = await restartElectronApp(app, dataDir);
        }

        try {
            await expect
                .poll(
                    () =>
                        app.electronApp.evaluate(({ BrowserWindow }) => {
                            const mainWindow = BrowserWindow.getAllWindows()[0];
                            return mainWindow ? mainWindow.isMaximized() : false;
                        }),
                    { timeout: 10_000 }
                )
                .toBe(true);
            expect(await isMainWindowFullScreen(app)).toBe(false);
        } finally {
            await closeElectronApp(app);
        }
    });
});

function isMainWindowFullScreen(app: LaunchedElectronApp): Promise<boolean> {
    return app.electronApp.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        return mainWindow ? mainWindow.isFullScreen() : false;
    });
}

async function selectSettingsOption(
    page: Page,
    selectTestId: string,
    optionTestId: string
): Promise<void> {
    await page.getByTestId(selectTestId).click();
    await page.getByTestId(optionTestId).click();
}

type CapturedExternalPlayerLaunch = {
    player: 'mpv' | 'vlc';
    title: string;
    url: string;
};

const externalPlayerLaunchCaptureKey =
    '__iptvnatorE2eExternalPlayerLaunches';

async function installExternalPlayerLaunchCapture(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.evaluate(({ ipcMain }, captureKey) => {
        const globalRef = globalThis as typeof globalThis &
            Record<string, CapturedExternalPlayerLaunch[] | undefined>;
        globalRef[captureKey] = [];

        const captureLaunch =
            (player: 'mpv' | 'vlc') =>
            async (
                _event: unknown,
                url: string,
                title: string,
                thumbnail?: string | null
            ) => {
                const launches = globalRef[captureKey] ?? [];
                const now = new Date().toISOString();

                launches.push({
                    player,
                    title,
                    url,
                });
                globalRef[captureKey] = launches;

                return {
                    canClose: false,
                    id: `e2e-${player}-${launches.length}`,
                    player,
                    startedAt: now,
                    status: 'opened',
                    streamUrl: url,
                    thumbnail: thumbnail ?? null,
                    title,
                    updatedAt: now,
                };
            };

        ipcMain.removeHandler('OPEN_MPV_PLAYER');
        ipcMain.removeHandler('OPEN_VLC_PLAYER');
        ipcMain.handle('OPEN_MPV_PLAYER', captureLaunch('mpv'));
        ipcMain.handle('OPEN_VLC_PLAYER', captureLaunch('vlc'));
    }, externalPlayerLaunchCaptureKey);
}

async function getExternalPlayerLaunches(
    app: LaunchedElectronApp
): Promise<CapturedExternalPlayerLaunch[]> {
    return app.electronApp.evaluate((_, captureKey) => {
        const globalRef = globalThis as typeof globalThis &
            Record<string, CapturedExternalPlayerLaunch[] | undefined>;

        return globalRef[captureKey] ?? [];
    }, externalPlayerLaunchCaptureKey);
}

async function resetExternalPlayerLaunches(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.evaluate((_, captureKey) => {
        const globalRef = globalThis as typeof globalThis &
            Record<string, CapturedExternalPlayerLaunch[] | undefined>;

        globalRef[captureKey] = [];
    }, externalPlayerLaunchCaptureKey);
}

async function expectExternalPlayerLaunchCount(
    app: LaunchedElectronApp,
    count: number
): Promise<void> {
    await expect
        .poll(async () => (await getExternalPlayerLaunches(app)).length, {
            timeout: 10000,
        })
        .toBe(count);
}

async function expectExternalPlayerLaunch(
    app: LaunchedElectronApp,
    index: number,
    expected: CapturedExternalPlayerLaunch
): Promise<void> {
    const launches = await getExternalPlayerLaunches(app);

    expect(launches[index]).toMatchObject({
        player: expected.player,
        url: expected.url,
    });
    expect(launches[index]?.title.trim()).toBe(expected.title);
}

async function expectNoExternalPlayerLaunchesAfterSettled(
    app: LaunchedElectronApp
): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(await getExternalPlayerLaunches(app)).toHaveLength(0);
}
