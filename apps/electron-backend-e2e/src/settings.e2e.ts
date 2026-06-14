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
    launchElectronApp,
    LaunchedElectronApp,
    m3uFixturePath,
    openGlobalRecent,
    openSettings,
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
    test('@settings @electron gates external MPV playback behind double-click when enabled', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await installExternalPlayerLaunchCapture(app);

            await openSettings(app.mainWindow);
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
            await selectSettingsOption(
                firstLaunch.mainWindow,
                'select-video-player',
                'html5'
            );
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
            await expect(
                secondLaunch.mainWindow.getByTestId('select-video-player')
            ).toContainText(/HTML5/i);
            await expect(
                secondLaunch.mainWindow.getByTestId('select-stream-format')
            ).toContainText('ts');
            await expect(
                secondLaunch.mainWindow.locator(
                    'mat-checkbox[formcontrolname="showExternalPlaybackBar"] input[type="checkbox"]'
                )
            ).not.toBeChecked();
            await expect(
                secondLaunch.mainWindow.locator(
                    'mat-checkbox[formcontrolname="remoteControl"] input[type="checkbox"]'
                )
            ).toBeChecked();
            await expect(
                secondLaunch.mainWindow.locator('#remoteControlPort')
            ).toHaveValue('8877');
            await expect(
                secondLaunch.mainWindow.locator('.epg-source-row input').first()
            ).toHaveValue(epgServer.resourceUrl);
        } finally {
            await closeElectronApp(secondLaunch);
            await epgServer.close();
        }
    });

    test('@settings @electron starts on sources when dashboard is disabled', async ({ dataDir }) => {
        const firstLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(firstLaunch.mainWindow);
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
});

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
