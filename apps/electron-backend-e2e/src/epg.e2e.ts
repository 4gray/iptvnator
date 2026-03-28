import { Page } from '@playwright/test';
import {
    closeElectronApp,
    createMutableTextServer,
    expect,
    launchElectronApp,
    openSettings,
    test,
} from './electron-test-fixtures';

const epgFixtureXml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="guide-news">
    <display-name>Guide News</display-name>
  </channel>
  <programme start="20260328070000 +0000" stop="20260328080000 +0000" channel="guide-news">
    <title>Guide Bulletin</title>
    <desc>EPG refresh smoke test.</desc>
  </programme>
</tv>
`;

test.describe('Electron EPG', () => {
    test('adds an EPG source, fetches guide data, removes the source row, and clears stored EPG data', async ({
        dataDir,
    }) => {
        const epgServer = await createMutableTextServer(epgFixtureXml, {
            contentType: 'application/xml; charset=utf-8',
            resourcePath: '/guide.xml',
        });
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await app.mainWindow
                .getByRole('button', { name: 'Add EPG source' })
                .click();
            await app.mainWindow
                .locator('.epg-source-row input')
                .first()
                .fill(epgServer.resourceUrl);

            await app.mainWindow.locator('.epg-source-row button').first().click();
            await expect(
                app.mainWindow.locator('.epg-progress-panel')
            ).toBeVisible();
            await expect
                .poll(() => getEpgChannelCount(app.mainWindow), {
                    timeout: 30000,
                })
                .toBeGreaterThan(0);
            await expect(
                app.mainWindow.locator('.epg-progress-panel .stat-badge').first()
            ).toBeVisible();

            await app.mainWindow.locator('.epg-source-row button').nth(1).click();
            await expect(app.mainWindow.locator('.epg-source-row')).toHaveCount(0);

            await app.mainWindow
                .getByRole('button', { name: 'Clear EPG data' })
                .click();
            const dialog = app.mainWindow.locator('mat-dialog-container');
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect
                .poll(() => getEpgChannelCount(app.mainWindow), {
                    timeout: 20000,
                })
                .toBe(0);
        } finally {
            await closeElectronApp(app);
            await epgServer.close();
        }
    });
});

async function getEpgChannelCount(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const channels = await window.electron?.getEpgChannelsByRange?.(0, 20);
        return Array.isArray(channels) ? channels.length : 0;
    });
}
