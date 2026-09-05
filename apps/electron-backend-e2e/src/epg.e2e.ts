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
    openSettingsSection,
    saveSettings,
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

function createCurrentXmltvFixture(
    channelId: string,
    channelName: string,
    programTitle: string,
    iconUrl?: string
): string {
    const start = new Date(Date.now() - 15 * 60 * 1000);
    const stop = new Date(Date.now() + 45 * 60 * 1000);

    return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="${channelId}">
    <display-name>${channelName}</display-name>
    ${iconUrl ? `<icon src="${iconUrl}"/>` : ''}
  </channel>
  <programme start="${formatXmltvDate(start)} +0000" stop="${formatXmltvDate(stop)} +0000" channel="${channelId}">
    <title>${programTitle}</title>
    <desc>M3U-declared EPG source smoke test.</desc>
  </programme>
</tv>
`;
}

function formatXmltvDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');

    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join('');
}

test.describe('Electron EPG', () => {
    test('@epg @electron adds an EPG source, fetches guide data, removes its stored EPG data on save', async ({
        dataDir,
    }) => {
        const epgServer = await createMutableTextServer(epgFixtureXml, {
            contentType: 'application/xml; charset=utf-8',
            resourcePath: '/guide.xml',
        });
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'epg');
            await app.mainWindow
                .getByRole('button', { name: 'Add EPG source' })
                .click();
            await app.mainWindow
                .locator('.epg-source-row input')
                .first()
                .fill(epgServer.resourceUrl);

            await app.mainWindow
                .locator('.epg-source-row button')
                .first()
                .click();
            await expect(
                app.mainWindow.locator('.epg-progress-panel')
            ).toBeVisible();
            await expect
                .poll(() => getEpgChannelCount(app.mainWindow), {
                    timeout: 30000,
                })
                .toBeGreaterThan(0);
            await expect(
                app.mainWindow
                    .locator('.epg-progress-panel .stat-badge')
                    .first()
            ).toBeVisible();

            await saveSettings(app.mainWindow);

            await app.mainWindow
                .locator('.epg-source-row button')
                .nth(1)
                .click();
            await expect(app.mainWindow.locator('.epg-source-row')).toHaveCount(
                0
            );
            // Adding and removing the source row leaves the settings form
            // dirty; save so the unsaved-changes close guard has nothing to
            // ask about when the app closes below — an unanswered dialog
            // would block the close and leak the Electron process.
            await saveSettings(app.mainWindow);

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

    test('@epg @electron removes only the saved source, preserves shared IDs and mappings, and repairs old orphan data on restart', async ({
        dataDir,
    }) => {
        test.setTimeout(120000);
        const first = await createMutableTextServer(
            createCurrentXmltvFixture(
                'shared-news',
                'Shared News',
                'Removed Bulletin'
            ),
            { contentType: 'application/xml', resourcePath: '/first.xml' }
        );
        const second = await createMutableTextServer(
            createCurrentXmltvFixture(
                'shared-news',
                'Shared News',
                'Retained Bulletin'
            ),
            { contentType: 'application/xml', resourcePath: '/second.xml' }
        );
        let app = await launchElectronApp(dataDir);
        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'epg');
            for (const [index, url] of [
                first.resourceUrl,
                second.resourceUrl,
            ].entries()) {
                await app.mainWindow
                    .getByRole('button', { name: 'Add EPG source' })
                    .click();
                const inputs = app.mainWindow.locator('.epg-source-row input');
                await expect(inputs).toHaveCount(index + 1);
                await inputs.nth(index).fill(url);
            }
            await saveSettings(app.mainWindow);
            const programs = () =>
                app.mainWindow.evaluate(async () =>
                    (
                        await window.electron.getChannelPrograms('mapped-news')
                    ).map((p) => p.title)
                );
            await app.mainWindow.evaluate(() =>
                window.electron.setEpgMapping('mapped-news', 'shared-news')
            );
            await expect
                .poll(programs, { timeout: 30000 })
                .toEqual(['Removed Bulletin', 'Retained Bulletin']);
            await app.mainWindow
                .locator('.epg-source-row')
                .first()
                .locator('button')
                .nth(1)
                .click();
            // A staged removal must not delete data before Save.
            expect(await programs()).toContain('Removed Bulletin');
            await saveSettings(app.mainWindow);
            await expect.poll(programs).toEqual(['Retained Bulletin']);
            await closeElectronApp(app);
            app = await launchElectronApp(dataDir);
            await expect.poll(programs).toEqual(['Retained Bulletin']);
            // Simulate a cache left by 0.23: import a source absent from settings.
            await app.mainWindow.evaluate(
                (url) => window.electron.forceFetchEpg(url),
                first.resourceUrl
            );
            await expect.poll(programs).toContain('Removed Bulletin');
            await closeElectronApp(app);
            app = await launchElectronApp(dataDir);
            await expect.poll(programs).toEqual(['Retained Bulletin']);
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'epg');
            await app.mainWindow
                .locator('.epg-source-row button')
                .nth(1)
                .click();
            await saveSettings(app.mainWindow);
            await expect.poll(programs).toEqual([]);
            await expect.poll(() => getEpgChannelCount(app.mainWindow)).toBe(0);
            expect(
                await app.mainWindow.evaluate(() =>
                    window.electron.getEpgMapping('mapped-news')
                )
            ).toMatchObject({ epgChannelId: 'shared-news' });
        } finally {
            await closeElectronApp(app);
            await first.close();
            await second.close();
        }
    });

    test('@epg @electron restores the first source name and logo after removing the last metadata writer', async ({
        dataDir,
    }) => {
        const first = await createMutableTextServer(
            createCurrentXmltvFixture(
                'shared-logo',
                'First News',
                'First Bulletin',
                'https://example.com/first.png'
            ),
            { contentType: 'application/xml', resourcePath: '/first.xml' }
        );
        const second = await createMutableTextServer(
            createCurrentXmltvFixture(
                'shared-logo',
                'Second News',
                'Second Bulletin',
                'https://example.com/second.png'
            ),
            { contentType: 'application/xml', resourcePath: '/second.xml' }
        );
        let app = await launchElectronApp(dataDir);
        const metadata = () =>
            app.mainWindow.evaluate(
                async () =>
                    (
                        await window.electron.getEpgChannelMetadata([
                            'shared-logo',
                        ])
                    )['shared-logo']
            );
        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'epg');
            for (const [index, source] of [first, second].entries()) {
                await app.mainWindow
                    .getByRole('button', { name: 'Add EPG source' })
                    .click();
                const inputs = app.mainWindow.locator('.epg-source-row input');
                await expect(inputs).toHaveCount(index + 1);
                await inputs.nth(index).fill(source.resourceUrl);
                await saveSettings(app.mainWindow);
                await expect.poll(metadata, { timeout: 30000 }).toMatchObject({
                    displayName: index === 0 ? 'First News' : 'Second News',
                    iconUrl: `https://example.com/${index === 0 ? 'first' : 'second'}.png`,
                });
            }
            await app.mainWindow
                .locator('.epg-source-row')
                .nth(1)
                .locator('button')
                .nth(1)
                .click();
            await saveSettings(app.mainWindow);
            const firstMetadata = {
                displayName: 'First News',
                iconUrl: 'https://example.com/first.png',
            };
            await expect.poll(metadata).toMatchObject(firstMetadata);
            await closeElectronApp(app);
            app = await launchElectronApp(dataDir);
            await expect.poll(metadata).toMatchObject(firstMetadata);
            expect(
                await app.mainWindow.evaluate(async () =>
                    (
                        await window.electron.getChannelPrograms('shared-logo')
                    ).map((p) => p.title)
                )
            ).toEqual(['First Bulletin']);
        } finally {
            await closeElectronApp(app);
            await first.close();
            await second.close();
        }
    });

    test('@epg @electron imports and renders an EPG source declared by an M3U playlist header', async ({
        dataDir,
    }) => {
        test.setTimeout(90000);
        const epgServer = await createMutableTextServer(
            createCurrentXmltvFixture(
                'playlist-guide-news',
                'Playlist Guide News',
                'Playlist Scoped Bulletin'
            ),
            {
                contentType: 'application/xml; charset=utf-8',
                resourcePath: '/guides/ua/playlist-guide.xml',
            }
        );
        const detectedEpgUrls = [
            `${epgServer.origin}/guides/us/ignored.xml`,
            `${epgServer.origin}/guides/de/ignored.xml`,
            epgServer.resourceUrl,
            `${epgServer.origin}/guides/fr/ignored.xml`,
            `${epgServer.origin}/guides/uk/ignored.xml`,
            `${epgServer.origin}/guides/es/ignored.xml`,
        ];
        const playlistContent = buildM3uContent([
            {
                name: 'Playlist Guide News',
                tvgCountry: 'UA',
                tvgId: 'playlist-guide-news',
                url: 'https://example.com/live/playlist-guide-news.m3u8',
            },
        ]).replace(
            '#EXTM3U',
            `#EXTM3U x-tvg-url="${detectedEpgUrls.join(',')}"`
        );
        const playlistServer = await createMutableTextServer(playlistContent, {
            contentType: 'application/x-mpegurl; charset=utf-8',
            resourcePath: '/playlist-with-epg.m3u',
        });
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                playlistServer.resourceUrl
            );

            await expect(
                app.mainWindow.locator('.epg-progress-panel')
            ).toBeVisible();
            await expect(
                app.mainWindow.locator('.epg-progress-panel .import-item')
            ).toHaveCount(1);
            await expect(
                app.mainWindow.locator(
                    '.epg-progress-panel .import-item.status-complete'
                )
            ).toHaveCount(1, { timeout: 30000 });
            await expect
                .poll(() => getEpgChannelCount(app.mainWindow), {
                    timeout: 30000,
                })
                .toBeGreaterThan(0);

            await openWorkspaceSection(app.mainWindow, 'All channels');

            const channelItem = channelItemByTitle(
                app.mainWindow,
                'Playlist Guide News'
            );
            await expect(channelItem).toBeVisible();
            await expect(channelItem.locator('.epg-title')).toContainText(
                'Playlist Scoped Bulletin',
                { timeout: 30000 }
            );
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'epg');
            await app.mainWindow
                .getByRole('button', { name: 'Add EPG source' })
                .click();
            await app.mainWindow
                .locator('.epg-source-row input')
                .fill(epgServer.resourceUrl);
            await saveSettings(app.mainWindow);
            await app.mainWindow
                .locator('.epg-source-row button')
                .nth(1)
                .click();
            await saveSettings(app.mainWindow);
            // The same URL still belongs to the saved M3U playlist.
            const retained = await app.mainWindow.evaluate(async () =>
                window.electron.getChannelPrograms('playlist-guide-news')
            );
            expect(retained.map((program) => program.title)).toContain(
                'Playlist Scoped Bulletin'
            );
        } finally {
            await closeElectronApp(app);
            await playlistServer.close();
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
            await openSettingsSection(app.mainWindow, 'epg');
            await app.mainWindow
                .getByRole('button', { name: 'Add EPG source' })
                .click();
            await app.mainWindow
                .locator('.epg-source-row input')
                .first()
                .fill(epgServer.resourceUrl);
            await app.mainWindow
                .locator('.epg-source-row button')
                .first()
                .click();

            await expect
                .poll(() => getEpgChannelCount(app.mainWindow), {
                    timeout: 30000,
                })
                .toBeGreaterThan(0);

            // The added source is still only staged in the form — leaving
            // settings without saving would surface the unsaved-changes
            // dialog and block the navigation below.
            await saveSettings(app.mainWindow);

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
