import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    createMutableTextServer,
    deleteSource,
    dragSourceBefore,
    expect,
    expectPlaylistUpdatedToast,
    expectSourceDialogValues,
    getVisibleSourceTitles,
    importM3uPlaylistFromNativeDialog,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openSources,
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

const localSourceFileName = 'alpha-local-source.m3u';
const localSourceDisplayName = 'alpha-local-source';
const urlSourceFileName = 'omega-url-source.m3u';
const xtreamSourceName = 'Charlie Xtream Portal';
const stalkerSourceName = 'Bravo Stalker Portal';
const editableLocalSourceDisplayName = 'editable-local-source';
const deletableLocalSourceDisplayName = 'deletable-local-source';
const refreshLocalSourceDisplayName = 'refresh-local-source';

test.describe('Electron Sources View', () => {
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
            await importM3uPlaylistFromNativeDialog(app, localFilePath);
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                urlServer.resourceUrl
            );
            await addXtreamPortal(app.mainWindow, {
                name: 'Refresh Xtream Source',
            });
            await openSources(app.mainWindow);

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
