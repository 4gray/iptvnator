import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    defaultStalkerPortalName,
    defaultXtreamPortalName,
    expect,
    expectPortalDebugSuccess,
    goToDashboard,
    launchElectronApp,
    resetMockServers,
    stalkerMockServer,
    test,
    waitForStalkerCatalog,
    waitForXtreamCatalog,
} from './electron-test-fixtures';

test.describe('Electron Provider Smoke Tests', () => {
    test('loads Xtream content through the Electron IPC path', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);

        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow);
            await waitForXtreamCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'xtream');

            await goToDashboard(app.mainWindow);
            await expect(
                app.mainWindow.getByRole('link', {
                    name: new RegExp(defaultXtreamPortalName, 'i'),
                })
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('loads Stalker content through the Electron IPC path', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['stalker']);

        const app = await launchElectronApp(dataDir);

        try {
            await addStalkerPortal(app.mainWindow, {
                portalUrl: `${stalkerMockServer}/portal.php`,
            });
            await waitForStalkerCatalog(app.mainWindow);
            await expectPortalDebugSuccess(app.mainWindow, 'stalker');

            await goToDashboard(app.mainWindow);
            await expect(
                app.mainWindow.getByRole('link', {
                    name: new RegExp(defaultStalkerPortalName, 'i'),
                })
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });
});
