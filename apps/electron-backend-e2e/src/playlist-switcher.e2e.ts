import { Page } from '@playwright/test';
import {
    channelItemByTitle,
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openPlaylistFavorites,
    openPlaylistRecent,
    openSettings,
    openSourceEditor,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    saveSettings,
    saveSourceDialog,
    sourceRowByTitle,
    test,
    updateSourceDialog,
    waitForDbOperationEvent,
    waitForM3uCatalog,
    waitForStalkerCatalog,
    waitForXtreamCatalog,
    writeTemporaryM3uFile,
    xtreamMockServer,
} from './electron-test-fixtures';

const xtreamStressUsername = 'stress';
const xtreamStressPassword = 'stress';
const dbWorkerBatchDelayMs = '20';

const localAFileName = 'switcher-local-a.m3u';
const localADisplayName = 'switcher-local-a';
const localBFileName = 'switcher-local-b.m3u';
const localBDisplayName = 'switcher-local-b';
const localAChannelName = 'Switcher Favorite A';
const localBChannelName = 'Switcher Favorite B';
const offlineLocalFileName = 'offline-local-source.m3u';
const offlineLocalDisplayName = 'offline-local-source';
const xtreamAName = 'Switcher Xtream A';
const xtreamBName = 'Switcher Xtream B';
const stalkerAName = 'Switcher Stalker A';
const stalkerBName = 'Switcher Stalker B';
const offlineXtreamName = 'Offline Cached Xtream';
const importingXtreamName = 'Importing Xtream Portal';

test.describe('Electron Playlist Switcher', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120000);

    test('preserves same-type sections and cross-type mappings when switching from the workspace header', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream', 'stalker']);
        const localAPath = writeTemporaryM3uFile(dataDir, localAFileName, [
            {
                groupTitle: 'News',
                name: 'Switcher Local A',
                url: 'https://streams.example.test/switcher-local-a.m3u8',
            },
        ]);
        const localBPath = writeTemporaryM3uFile(dataDir, localBFileName, [
            {
                groupTitle: 'Sports',
                name: 'Switcher Local B',
                url: 'https://streams.example.test/switcher-local-b.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, localAPath);
            await importM3uPlaylistFromNativeDialog(app, localBPath);
            await addXtreamPortal(app.mainWindow, {
                name: xtreamAName,
            });
            await addXtreamPortal(app.mainWindow, {
                name: xtreamBName,
            });
            await addStalkerPortal(app.mainWindow, {
                name: stalkerAName,
            });
            await addStalkerPortal(app.mainWindow, {
                name: stalkerBName,
            });
            await openSources(app.mainWindow);

            await sourceRowByTitle(app.mainWindow, localADisplayName)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Recently viewed');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/recent$/
            );

            await switchPlaylistFromHeader(app.mainWindow, localBDisplayName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/recent$/
            );

            await switchPlaylistFromHeader(app.mainWindow, xtreamAName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/recent$/
            );

            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await waitForXtreamCatalog(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/live$/
            );

            await switchPlaylistFromHeader(app.mainWindow, xtreamBName);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/live$/
            );

            await openWorkspaceSection(app.mainWindow, 'Recently added');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/recently-added$/
            );

            await switchPlaylistFromHeader(app.mainWindow, stalkerAName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/recent$/
            );

            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await waitForStalkerCatalog(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/itv$/
            );

            await switchPlaylistFromHeader(app.mainWindow, stalkerBName);
            await waitForStalkerCatalog(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/itv$/
            );

            await switchPlaylistFromHeader(app.mainWindow, xtreamAName);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/live$/
            );

            await switchPlaylistFromHeader(app.mainWindow, localADisplayName);
            await waitForM3uCatalog(app.mainWindow);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/all$/
            );

            await openWorkspaceSection(app.mainWindow, 'Favorites');
            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/favorites$/
            );

            await switchPlaylistFromHeader(app.mainWindow, stalkerBName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/stalker\/[^/]+\/favorites$/
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('refreshes M3U unified collections immediately when switching same-type playlists from the header', async ({
        dataDir,
    }) => {
        const localAPath = writeTemporaryM3uFile(dataDir, localAFileName, [
            {
                groupTitle: 'News',
                name: localAChannelName,
                url: 'https://streams.example.test/switcher-favorite-a.m3u8',
            },
        ]);
        const localBPath = writeTemporaryM3uFile(dataDir, localBFileName, [
            {
                groupTitle: 'Sports',
                name: localBChannelName,
                url: 'https://streams.example.test/switcher-favorite-b.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, localAPath);
            await importM3uPlaylistFromNativeDialog(app, localBPath);

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, localADisplayName)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await toggleFavoriteForChannel(app.mainWindow, localAChannelName);
            await channelItemByTitle(app.mainWindow, localAChannelName)
                .first()
                .click();

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, localBDisplayName)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await toggleFavoriteForChannel(app.mainWindow, localBChannelName);
            await channelItemByTitle(app.mainWindow, localBChannelName)
                .first()
                .click();

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, localADisplayName)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);

            await openPlaylistFavorites(app.mainWindow);
            await expect(channelItemByTitle(app.mainWindow, localAChannelName)).toHaveCount(
                1
            );
            await expect(channelItemByTitle(app.mainWindow, localBChannelName)).toHaveCount(
                0
            );

            await switchPlaylistFromHeader(app.mainWindow, localBDisplayName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/favorites$/
            );
            await expect(channelItemByTitle(app.mainWindow, localBChannelName)).toHaveCount(
                1
            );
            await expect(channelItemByTitle(app.mainWindow, localAChannelName)).toHaveCount(
                0
            );

            await openPlaylistRecent(app.mainWindow);
            await expect(channelItemByTitle(app.mainWindow, localBChannelName)).toHaveCount(
                1
            );
            await expect(channelItemByTitle(app.mainWindow, localAChannelName)).toHaveCount(
                0
            );

            await switchPlaylistFromHeader(app.mainWindow, localADisplayName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/playlists\/[^/]+\/recent$/
            );
            await expect(channelItemByTitle(app.mainWindow, localAChannelName)).toHaveCount(
                1
            );
            await expect(channelItemByTitle(app.mainWindow, localBChannelName)).toHaveCount(
                0
            );
        } finally {
            await closeElectronApp(app);
        }
    });

    test('switches away from importing Xtream playlists, returns before completion, and avoids redundant reimport after caching', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const localAPath = writeTemporaryM3uFile(dataDir, localAFileName, [
            {
                groupTitle: 'News',
                name: 'Import Switch Local',
                url: 'https://streams.example.test/import-switch-local.m3u8',
            },
        ]);
        const app = await launchElectronApp(dataDir, {
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: dbWorkerBatchDelayMs,
            },
        });

        try {
            await importM3uPlaylistFromNativeDialog(app, localAPath);
            await waitForM3uCatalog(app.mainWindow);

            await addXtreamPortal(app.mainWindow, {
                name: importingXtreamName,
                password: xtreamStressPassword,
                username: xtreamStressUsername,
            });

            const overlay = app.mainWindow.locator('.workspace-loading-overlay');
            await expect(overlay).toBeVisible({ timeout: 15000 });
            await waitForDbOperationEvent(app.mainWindow, {
                operation: 'save-content',
                predicate: (event) =>
                    event.status === 'progress' &&
                    (event.current ?? 0) > 0 &&
                    (event.total ?? 0) > 0,
                timeoutMs: 30000,
            });

            await switchPlaylistFromHeader(app.mainWindow, localADisplayName);
            await waitForM3uCatalog(app.mainWindow);
            await expect(overlay).toHaveCount(0);

            await switchPlaylistFromHeader(app.mainWindow, importingXtreamName);
            await expectPathname(
                app.mainWindow,
                /\/workspace\/xtreams\/[^/]+\/vod$/
            );
            await Promise.race([
                overlay.waitFor({ state: 'visible', timeout: 15000 }),
                waitForXtreamCatalog(app.mainWindow),
            ]);

            await waitForXtreamCatalog(app.mainWindow);

            await switchPlaylistFromHeader(app.mainWindow, localADisplayName);
            await waitForM3uCatalog(app.mainWindow);

            const startedBeforeReturn = await countDbEvents(
                app.mainWindow,
                'save-content',
                'started'
            );

            await switchPlaylistFromHeader(app.mainWindow, importingXtreamName);
            await waitForXtreamCatalog(app.mainWindow);
            await expect(overlay).toHaveCount(0);

            await app.mainWindow.waitForTimeout(1200);

            const startedAfterReturn = await countDbEvents(
                app.mainWindow,
                'save-content',
                'started'
            );
            expect(startedAfterReturn).toBe(startedBeforeReturn);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('keeps cached Xtream content browseable with an unavailable warning after the portal goes offline and after restart', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const offlineLocalPath = writeTemporaryM3uFile(
            dataDir,
            offlineLocalFileName,
            [
                {
                    groupTitle: 'News',
                    name: 'Offline Local Channel',
                    url: 'https://streams.example.test/offline-local.m3u8',
                },
            ]
        );
        let app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await selectSettingsOption(
                app.mainWindow,
                'select-startup-behavior',
                'restore-last-view'
            );
            await saveSettings(app.mainWindow);

            await addXtreamPortal(app.mainWindow, {
                name: offlineXtreamName,
                password: defaultXtreamPassword,
                username: defaultXtreamUsername,
            });
            await openWorkspaceSection(app.mainWindow, 'Movies');
            await waitForXtreamCatalog(app.mainWindow);

            await importM3uPlaylistFromNativeDialog(app, offlineLocalPath);
            await waitForM3uCatalog(app.mainWindow);

            await openSources(app.mainWindow);
            const dialog = await openSourceEditor(
                app.mainWindow,
                offlineXtreamName
            );
            await updateSourceDialog(dialog, {
                serverUrl: xtreamMockServer.replace(/:\d+$/, ':65530'),
            });
            await saveSourceDialog(app.mainWindow, dialog);

            await sourceRowByTitle(app.mainWindow, offlineLocalDisplayName)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);

            await switchPlaylistFromHeader(app.mainWindow, offlineXtreamName);
            await waitForXtreamCatalog(app.mainWindow);
            await expectXtreamUnavailableWarning(app.mainWindow);
            await expect(app.mainWindow.locator('.xtream-content-gate')).toHaveCount(
                0
            );

            app = await restartElectronApp(app, dataDir);

            await waitForXtreamCatalog(app.mainWindow);
            await expectXtreamUnavailableWarning(app.mainWindow);
            await expect(app.mainWindow.locator('.xtream-content-gate')).toHaveCount(
                0
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function openPlaylistSwitcher(page: Page): Promise<void> {
    await page
        .locator('app-playlist-switcher .playlist-switcher-trigger')
        .click();
    await expect(
        page.locator('.cdk-overlay-pane .playlist-item').first()
    ).toBeVisible();
}

async function switchPlaylistFromHeader(
    page: Page,
    title: string
): Promise<void> {
    await openPlaylistSwitcher(page);
    const item = page
        .locator('.cdk-overlay-pane .playlist-item')
        .filter({ hasText: title })
        .first();

    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('.cdk-overlay-pane .playlist-item')).toHaveCount(
        0
    );
}

async function expectPathname(page: Page, pattern: RegExp): Promise<void> {
    await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
        .toMatch(pattern);
}

async function countDbEvents(
    page: Page,
    operation: string,
    status: string
): Promise<number> {
    return page.evaluate(
        ({ operation, status: desiredStatus }) =>
            (window.__dbOperationEvents ?? []).filter(
                (event) =>
                    event.operation === operation &&
                    event.status === desiredStatus
            ).length,
        { operation, status }
    );
}

async function selectSettingsOption(
    page: Page,
    selectTestId: string,
    optionTestId: string
): Promise<void> {
    await page.getByTestId(selectTestId).click();
    await page.getByTestId(optionTestId).click();
}

async function expectXtreamUnavailableWarning(page: Page): Promise<void> {
    await expect(
        page.getByTestId('xtream-offline-warning')
    ).toBeVisible({ timeout: 20000 });
}

async function toggleFavoriteForChannel(page: Page, title: string): Promise<void> {
    const item = channelItemByTitle(page, title).first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
    await expect(item.locator('.favorite-button mat-icon').first()).toHaveText(/star/);
}
