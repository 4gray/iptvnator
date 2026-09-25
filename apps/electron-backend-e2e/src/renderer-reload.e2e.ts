import {
    closeElectronApp,
    expect,
    expectPathname,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    test,
} from './electron-test-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
    reloadFromRenderer,
} from './renderer-reload.support';

/**
 * The packaged renderer is index.html over file:// with path routing, so
 * once the user is on a section the document URL names a path with no file
 * behind it. A main-process reload of that URL used to fail with
 * ERR_FILE_NOT_FOUND and leave the window on Chromium's error page until the
 * app restarted, and a renderer-initiated reload was cancelled by the
 * navigation guard and silently did nothing. Both now boot the app straight
 * back into the route it was on.
 */
test.describe('Renderer reload on an in-app route', () => {
    test('@electron @window a main-process reload keeps the app on the Sources page', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSources(app.mainWindow);

            await reloadFromMainProcess(app);

            await expectRendererReloadedOnRoute(
                app.mainWindow,
                /\/workspace\/sources$/
            );
            // A fresh data dir has no sources: the page shows its empty state.
            await expect(
                app.mainWindow.getByRole('heading', {
                    name: 'Add your first playlist',
                })
            ).toBeVisible();
            // The page is alive, not a leftover paint: navigation still works.
            await app.mainWindow
                .getByRole('link', { name: 'Dashboard', exact: true })
                .click();
            await expectPathname(app.mainWindow, /\/workspace\/dashboard$/);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron @window a renderer-initiated reload keeps the app on its settings section', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'playback');

            await reloadFromRenderer(app);

            await expectRendererReloadedOnRoute(
                app.mainWindow,
                /\/workspace\/settings\/playback$/
            );
            await expect(
                app.mainWindow.getByTestId('settings-container')
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('settings-section-playback')
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });
});
