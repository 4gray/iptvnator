import { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickFirstGridListCard,
    closeElectronApp,
    createMutableTextServer,
    enableRemoteControl,
    expect,
    launchElectronApp,
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
    test('persists changed desktop settings across app restart', async ({
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

    test('starts on sources when dashboard is disabled', async ({ dataDir }) => {
        const firstLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(firstLaunch.mainWindow);
            await firstLaunch.mainWindow
                .locator(
                    'mat-checkbox[formcontrolname="showDashboard"] input[type="checkbox"]'
                )
                .uncheck();
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
