import { Page } from '@playwright/test';
import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openWorkspaceSection,
    openSettings,
    test,
} from './electron-test-fixtures';

const fallbackLogoSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#16436b"/><text x="48" y="58" text-anchor="middle" font-size="28" font-family="Arial" fill="#f5f7fb">GN</text></svg>`
).toString('base64');
const fallbackLogoDataUrl = `data:image/svg+xml;base64,${fallbackLogoSvg}`;
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
    test('@epg @electron adds an EPG source, fetches guide data, removes the source row, and clears stored EPG data', async ({
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

    test('@epg @electron uses the XMLTV channel icon as a fallback when the playlist has no tvg-logo', async ({
        dataDir,
    }) => {
        const playlistServer = await createMutableTextServer(
            buildM3uContent([
                {
                    name: 'Guide News Live',
                    tvgId: 'guide-news',
                    url: 'https://example.com/live/guide-news.m3u8',
                },
            ]),
            {
                contentType: 'application/x-mpegurl; charset=utf-8',
                resourcePath: '/playlist.m3u',
            }
        );
        const epgServer = await createMutableTextServer(
            `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="guide-news">
    <display-name>Guide News Live</display-name>
    <icon src="${fallbackLogoDataUrl}"/>
  </channel>
  <programme start="20260328070000 +0000" stop="20260328080000 +0000" channel="guide-news">
    <title>Guide Bulletin</title>
    <desc>EPG logo fallback test.</desc>
  </programme>
</tv>
`,
            {
                contentType: 'application/xml; charset=utf-8',
                resourcePath: '/guide.xml',
            }
        );
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                playlistServer.resourceUrl
            );

            await openSettings(app.mainWindow);
            await app.mainWindow
                .getByRole('button', { name: 'Add EPG source' })
                .click();
            await app.mainWindow
                .locator('.epg-source-row input')
                .first()
                .fill(epgServer.resourceUrl);
            await app.mainWindow.locator('.epg-source-row button').first().click();

            await expect
                .poll(() => getEpgChannelCount(app.mainWindow), {
                    timeout: 30000,
                })
                .toBeGreaterThan(0);

            await openWorkspaceSection(app.mainWindow, 'All channels');

            const channelItem = channelItemByTitle(
                app.mainWindow,
                'Guide News Live'
            );
            await expect(channelItem).toBeVisible();
            await expect(channelItem.locator('.channel-logo')).toHaveAttribute(
                'src',
                fallbackLogoDataUrl
            );
            await expect(
                channelItem.locator('.channel-logo-fallback')
            ).toHaveCount(0);
        } finally {
            await closeElectronApp(app);
            await playlistServer.close();
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
