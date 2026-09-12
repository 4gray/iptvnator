import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    createMutableTextServer,
    deleteSource,
    dropM3uPlaylistOntoWorkspace,
    dragSourceBefore,
    expect,
    expectPlaylistUpdatedToast,
    expectSourceDialogValues,
    getVisibleSourceTitles,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openSources,
    openAddPlaylistDialog,
    openSourceEditor,
    refreshSource,
    resetMockServers,
    restartElectronApp,
    saveSourceDialog,
    selectSourceSort,
    selectSourceTypeFilter,
    sourceRowByTitle,
    test,
    updateSourceDialog,
    waitForM3uCatalog,
    waitForPortalDebugEvent,
    waitForXtreamCatalog,
    waitForSourceRowIdle,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

import {
    configureLiveFormat,
    expectLiveFormatPlaying,
    liveChannels,
    liveFormatMock,
} from './xtream-live-format.fixture';

const localSourceFileName = 'alpha-local-source.m3u';
const localSourceDisplayName = 'alpha-local-source';
const urlSourceFileName = 'omega-url-source.m3u';
const xtreamSourceName = 'Charlie Xtream Portal';
const stalkerSourceName = 'Bravo Stalker Portal';
const editableLocalSourceDisplayName = 'editable-local-source';
const deletableLocalSourceDisplayName = 'deletable-local-source';
const refreshLocalSourceDisplayName = 'refresh-local-source';

test.describe('Electron Sources View', () => {
    test('detects HTTP on Test connection and persists it for refresh, EPG and playback', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(150_000);
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir, {
            args: ['--autoplay-policy=no-user-gesture-required'],
        });
        const title = 'HTTP protocol discovery';
        const httpsUrl = liveFormatMock.replace('http:', 'https:');
        try {
            let page = app.mainWindow;
            await configureLiveFormat(page, 'html5', 'ts');
            await openAddPlaylistDialog(page);
            let dialog = page.getByRole('dialog');
            await dialog
                .getByRole('radio', { name: /Xtream credentials/i })
                .click();
            await dialog.locator('#title').fill(title);
            await dialog.locator('#serverUrl').fill(httpsUrl);
            await dialog.locator('#username').fill('live-fallback');
            await dialog.locator('#password').fill('live-fallback');
            await dialog
                .getByRole('button', {
                    name: 'Test HTTPS and HTTP',
                    exact: true,
                })
                .click();
            await expect(dialog.getByRole('status')).toContainText(
                'Connected using HTTP'
            );
            await expect(dialog.locator('#serverUrl')).toHaveValue(
                liveFormatMock
            );
            await dialog.screenshot({
                path: test.info().outputPath('http-connection-add.png'),
            });
            await dialog
                .getByRole('button', { name: 'Add', exact: true })
                .click();
            await page.waitForURL(/xtreams.*vod/);
            await openSources(page);
            dialog = await openSourceEditor(page, title);
            await dialog.locator('[formControlName="password"]').fill('');
            await dialog
                .getByRole('button', {
                    name: 'Test HTTPS and HTTP',
                    exact: true,
                })
                .click();
            await expect(dialog.getByRole('status')).toContainText(
                'Enter a username and password'
            );
            await dialog
                .locator('[formControlName="password"]')
                .fill('live-fallback');
            // Closing a tested edit must not persist unrelated changes.
            await updateSourceDialog(dialog, {
                title: 'Discard this edit',
                serverUrl: httpsUrl,
            });
            await dialog
                .getByRole('button', {
                    name: 'Test HTTPS and HTTP',
                    exact: true,
                })
                .click();
            await expect(dialog.getByRole('status')).toContainText(
                'Connected using HTTP'
            );
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await dialog.waitFor({ state: 'detached' });
            dialog = await openSourceEditor(page, title);
            await expectSourceDialogValues(dialog, {
                title,
                serverUrl: liveFormatMock,
            });
            // Persist a broken HTTPS source, then repair it through Edit.
            await updateSourceDialog(dialog, { serverUrl: httpsUrl });
            await saveSourceDialog(page, dialog);
            dialog = await openSourceEditor(page, title);
            await expectSourceDialogValues(dialog, { serverUrl: httpsUrl });
            await dialog
                .getByRole('button', {
                    name: 'Test HTTPS and HTTP',
                    exact: true,
                })
                .click();
            await expect(dialog.getByRole('status')).toContainText(
                'Connected using HTTP'
            );
            await dialog.screenshot({
                path: test.info().outputPath('http-connection-edit.png'),
            });
            await saveSourceDialog(page, dialog);
            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;
            page = app.mainWindow;
            await openSources(page);
            dialog = await openSourceEditor(page, title);
            await expectSourceDialogValues(dialog, {
                serverUrl: liveFormatMock,
            });
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await dialog.waitFor({ state: 'detached' });
            const saved = await page.evaluate(
                async (title) =>
                    (await window.electron.dbGetAppPlaylistMetas()).find(
                        (p) => p.title === title
                    ),
                title
            );
            expect(saved?.serverUrl).toBe(liveFormatMock);
            await refreshSource(page, title, { confirm: true });
            await waitForSourceRowIdle(page, title);
            const refreshed = await waitForPortalDebugEvent(page, {
                provider: 'xtream',
                operation: 'get_live_streams',
            });
            expect(refreshed.request).toMatchObject({
                url: expect.stringMatching(/^http:/),
            });
            await openSources(page);
            await sourceRowByTitle(page, title).first().click();
            await page
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await page.locator('.context-panel .category-item').first().click();
            const media = page.waitForResponse(
                (r) =>
                    r.url().startsWith(liveFormatMock + '/live/') &&
                    r.url().endsWith('.ts')
            );
            await liveChannels(page).first().click();
            expect((await media).status()).toBe(200);
            await expectLiveFormatPlaying(page, 'html5');
            const epg = await waitForPortalDebugEvent(page, {
                provider: 'xtream',
                operation: 'get_short_epg',
            });
            expect(epg.request).toMatchObject({
                url: expect.stringMatching(/^http:/),
            });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('filters and sorts sources, including persisted custom order', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream', 'stalker']);
        const localFilePath = writeTemporaryM3uFile(
            dataDir,
            localSourceFileName,
            [
                {
                    groupTitle: 'News',
                    name: 'Alpha Local News',
                    url: 'https://streams.example.test/local-alpha.m3u8',
                },
            ]
        );
        const urlServer = await createMutableTextServer(
            `#EXTM3U
#EXTINF:-1 group-title="Sports",Omega URL Sports
https://streams.example.test/url-omega.m3u8
`,
            {
                contentType: 'application/vnd.apple.mpegurl',
                resourcePath: `/${urlSourceFileName}`,
            }
        );

        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, localFilePath);
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                urlServer.resourceUrl
            );
            await addXtreamPortal(app.mainWindow, {
                name: xtreamSourceName,
            });
            await addStalkerPortal(app.mainWindow, {
                name: stalkerSourceName,
            });
            await openSources(app.mainWindow);

            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toHaveLength(4);

            await selectSourceTypeFilter(app.mainWindow, 'M3U');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([urlSourceFileName, localSourceDisplayName]);

            await selectSourceTypeFilter(app.mainWindow, 'Xtream');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([xtreamSourceName]);

            await selectSourceTypeFilter(app.mainWindow, 'Stalker');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([stalkerSourceName]);

            await selectSourceTypeFilter(app.mainWindow, 'All');

            await selectSourceSort(app.mainWindow, 'Date added (Oldest first)');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    localSourceDisplayName,
                    urlSourceFileName,
                    xtreamSourceName,
                    stalkerSourceName,
                ]);

            await selectSourceSort(app.mainWindow, 'Name (A-Z)');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    localSourceDisplayName,
                    stalkerSourceName,
                    xtreamSourceName,
                    urlSourceFileName,
                ]);

            await selectSourceSort(app.mainWindow, 'Name (Z-A)');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    urlSourceFileName,
                    xtreamSourceName,
                    stalkerSourceName,
                    localSourceDisplayName,
                ]);

            await selectSourceSort(app.mainWindow, 'Date added (Newest first)');
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    stalkerSourceName,
                    xtreamSourceName,
                    urlSourceFileName,
                    localSourceDisplayName,
                ]);

            await selectSourceSort(app.mainWindow, 'Custom order');
            await dragSourceBefore(
                app.mainWindow,
                xtreamSourceName,
                localSourceDisplayName
            );
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    xtreamSourceName,
                    localSourceDisplayName,
                    urlSourceFileName,
                    stalkerSourceName,
                ]);

            await app.mainWindow
                .getByRole('link', { name: 'Dashboard', exact: true })
                .click();
            await openSources(app.mainWindow);
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    xtreamSourceName,
                    localSourceDisplayName,
                    urlSourceFileName,
                    stalkerSourceName,
                ]);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await expect
                .poll(() => getVisibleSourceTitles(app.mainWindow))
                .toEqual([
                    xtreamSourceName,
                    localSourceDisplayName,
                    urlSourceFileName,
                    stalkerSourceName,
                ]);
        } finally {
            await closeElectronApp(app);
            await urlServer.close();
        }
    });

    test('edits M3U, Xtream, and Stalker source details and keeps them after restart', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream', 'stalker']);
        const localFilePath = writeTemporaryM3uFile(
            dataDir,
            'editable-local-source.m3u',
            [
                {
                    groupTitle: 'Movies',
                    name: 'Editable Local Channel',
                    url: 'https://streams.example.test/editable-local.m3u8',
                },
            ]
        );
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, localFilePath);
            await addXtreamPortal(app.mainWindow, {
                name: 'Editable Xtream Source',
            });
            await addStalkerPortal(app.mainWindow, {
                name: 'Editable Stalker Source',
            });
            await openSources(app.mainWindow);

            let dialog = await openSourceEditor(
                app.mainWindow,
                editableLocalSourceDisplayName
            );
            await updateSourceDialog(dialog, {
                autoRefresh: true,
                title: 'Edited Local Source',
                userAgent: 'Electron E2E Local/1.0',
            });
            await saveSourceDialog(app.mainWindow, dialog);

            dialog = await openSourceEditor(
                app.mainWindow,
                'Editable Xtream Source'
            );
            await updateSourceDialog(dialog, {
                password: 'pass1',
                serverUrl: 'http://127.0.0.1:3211',
                title: 'Edited Xtream Source',
                username: 'user1',
            });
            await saveSourceDialog(app.mainWindow, dialog);

            dialog = await openSourceEditor(
                app.mainWindow,
                'Editable Stalker Source'
            );
            await updateSourceDialog(dialog, {
                macAddress: '00:1A:79:00:00:99',
                portalUrl: 'http://127.0.0.1:3210/portal.php',
                title: 'Edited Stalker Source',
            });
            await saveSourceDialog(app.mainWindow, dialog);

            dialog = await openSourceEditor(
                app.mainWindow,
                'Edited Local Source'
            );
            await expectSourceDialogValues(dialog, {
                autoRefresh: true,
                title: 'Edited Local Source',
                userAgent: 'Electron E2E Local/1.0',
            });
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();

            dialog = await openSourceEditor(
                app.mainWindow,
                'Edited Xtream Source'
            );
            await expectSourceDialogValues(dialog, {
                password: 'pass1',
                serverUrl: 'http://127.0.0.1:3211',
                title: 'Edited Xtream Source',
                username: 'user1',
            });
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();

            dialog = await openSourceEditor(
                app.mainWindow,
                'Edited Stalker Source'
            );
            await expectSourceDialogValues(dialog, {
                macAddress: '00:1A:79:00:00:99',
                portalUrl: 'http://127.0.0.1:3210/portal.php',
                title: 'Edited Stalker Source',
            });
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);

            dialog = await openSourceEditor(
                app.mainWindow,
                'Edited Local Source'
            );
            await expectSourceDialogValues(dialog, {
                autoRefresh: true,
                title: 'Edited Local Source',
                userAgent: 'Electron E2E Local/1.0',
            });
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();

            dialog = await openSourceEditor(
                app.mainWindow,
                'Edited Xtream Source'
            );
            await expectSourceDialogValues(dialog, {
                password: 'pass1',
                serverUrl: 'http://127.0.0.1:3211',
                title: 'Edited Xtream Source',
                username: 'user1',
            });
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();

            dialog = await openSourceEditor(
                app.mainWindow,
                'Edited Stalker Source'
            );
            await expectSourceDialogValues(dialog, {
                macAddress: '00:1A:79:00:00:99',
                portalUrl: 'http://127.0.0.1:3210/portal.php',
                title: 'Edited Stalker Source',
            });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('deletes M3U, Stalker, and Xtream sources from the sources view', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream', 'stalker']);
        const localFilePath = writeTemporaryM3uFile(
            dataDir,
            'deletable-local-source.m3u',
            [
                {
                    groupTitle: 'Live',
                    name: 'Delete Me Local',
                    url: 'https://streams.example.test/delete-local.m3u8',
                },
            ]
        );
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, localFilePath);
            await addXtreamPortal(app.mainWindow, {
                name: 'Delete Me Xtream',
            });
            await addStalkerPortal(app.mainWindow, {
                name: 'Delete Me Stalker',
            });
            await openSources(app.mainWindow);

            await expect(
                sourceRowByTitle(app.mainWindow, 'Delete Me Stalker').locator(
                    'app-source-health-indicator [data-state]'
                )
            ).toHaveAttribute('data-state', 'active', { timeout: 20000 });
            await expect(
                sourceRowByTitle(app.mainWindow, 'Delete Me Xtream').locator(
                    'app-source-health-indicator [data-state]'
                )
            ).toHaveAttribute('data-state', 'active', { timeout: 20000 });

            await deleteSource(app.mainWindow, deletableLocalSourceDisplayName);
            await expect(
                sourceRowByTitle(
                    app.mainWindow,
                    deletableLocalSourceDisplayName
                )
            ).toHaveCount(0, {
                timeout: 20000,
            });

            await deleteSource(app.mainWindow, 'Delete Me Stalker');
            await expect(
                sourceRowByTitle(app.mainWindow, 'Delete Me Stalker')
            ).toHaveCount(0, {
                timeout: 20000,
            });

            await deleteSource(app.mainWindow, 'Delete Me Xtream');
            await expect(
                sourceRowByTitle(app.mainWindow, 'Delete Me Xtream')
            ).toHaveCount(0, {
                timeout: 60000,
            });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('refreshes local-file M3U, URL M3U, and Xtream sources from the sources view', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const localFilePath = writeTemporaryM3uFile(
            dataDir,
            'refresh-local-source.m3u',
            [
                {
                    groupTitle: 'News',
                    name: 'Original Local Channel',
                    url: 'https://streams.example.test/original-local.m3u8',
                },
            ]
        );
        const urlServer = await createMutableTextServer(
            `#EXTM3U
#EXTINF:-1 group-title="News",Original URL Channel
https://streams.example.test/original-url.m3u8
`,
            {
                contentType: 'application/vnd.apple.mpegurl',
                resourcePath: '/refresh-url-source.m3u',
            }
        );
        const app = await launchElectronApp(dataDir);

        try {
            await dropM3uPlaylistOntoWorkspace(app.mainWindow, localFilePath);
            await waitForM3uCatalog(app.mainWindow);
            await expect(
                app.mainWindow.locator(
                    'app-playlist-switcher .trigger-refresh-button'
                )
            ).toBeVisible();

            await goToDashboard(app.mainWindow);
            const sourceCard = app.mainWindow
                .getByTestId('dashboard-recent-sources-rail-card')
                .filter({
                    hasText: refreshLocalSourceDisplayName,
                })
                .first();
            await expect(sourceCard).toBeVisible({ timeout: 20000 });
            await sourceCard.hover();
            await sourceCard
                .getByTestId('dashboard-recent-sources-rail-card-actions')
                .click();
            await expect(
                app.mainWindow.getByRole('menuitem', {
                    name: 'Refresh playlist',
                    exact: true,
                })
            ).toBeVisible();
            await app.mainWindow.keyboard.press('Escape');

            await importM3uPlaylistFromUrl(
                app.mainWindow,
                urlServer.resourceUrl
            );
            await addXtreamPortal(app.mainWindow, {
                name: 'Refresh Xtream Source',
            });
            await openSources(app.mainWindow);
            await expect(
                sourceRowByTitle(app.mainWindow, refreshLocalSourceDisplayName)
                    .first()
                    .locator('.refresh-btn')
            ).toBeVisible();

            writeTemporaryM3uFile(dataDir, 'refresh-local-source.m3u', [
                {
                    groupTitle: 'News',
                    name: 'Refreshed Local Channel',
                    url: 'https://streams.example.test/refreshed-local.m3u8',
                },
            ]);
            await refreshSource(app.mainWindow, refreshLocalSourceDisplayName);
            await expectPlaylistUpdatedToast(app.mainWindow);
            await sourceRowByTitle(
                app.mainWindow,
                refreshLocalSourceDisplayName
            )
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('channel-item').filter({
                    hasText: 'Refreshed Local Channel',
                })
            ).toHaveCount(1);
            await openSources(app.mainWindow);

            urlServer.setBody(
                `#EXTM3U
#EXTINF:-1 group-title="News",Refreshed URL Channel
https://streams.example.test/refreshed-url.m3u8
`
            );
            await refreshSource(app.mainWindow, 'refresh-url-source.m3u');
            await expectPlaylistUpdatedToast(app.mainWindow);
            await waitForSourceRowIdle(
                app.mainWindow,
                'refresh-url-source.m3u'
            );
            await sourceRowByTitle(app.mainWindow, 'refresh-url-source.m3u')
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('channel-item').filter({
                    hasText: 'Refreshed URL Channel',
                })
            ).toHaveCount(1);
            await openSources(app.mainWindow);

            await refreshSource(app.mainWindow, 'Refresh Xtream Source', {
                confirm: true,
            });
            await waitForXtreamCatalog(app.mainWindow);
            await waitForPortalDebugEvent(app.mainWindow, {
                operation: 'get_live_categories',
                provider: 'xtream',
                timeoutMs: 30000,
            });
            await openSources(app.mainWindow);
            await waitForSourceRowIdle(app.mainWindow, 'Refresh Xtream Source');
            await expect(
                sourceRowByTitle(app.mainWindow, 'Refresh Xtream Source')
                    .first()
                    .locator('.meta')
            ).toContainText('Updated:');
        } finally {
            await closeElectronApp(app);
            await urlServer.close();
        }
    });
});
