import type { Locator, Page } from '@playwright/test';
import {
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openSourceEditor,
    openSources,
    restartElectronApp,
    refreshSource,
    saveSourceDialog,
    sourceRowByTitle,
    test,
    updateSourceDialog,
    waitForM3uCatalog,
} from './electron-test-fixtures';

const autoRefreshSourceName = 'auto-refresh-source.m3u';

function buildAutoRefreshM3u(channelName: string): string {
    return `#EXTM3U
#EXTINF:-1 group-title="News",${channelName}
https://streams.example.test/${channelName.toLowerCase().replace(/\s+/g, '-')}.m3u8
`;
}

function snackBarLabel(page: Page, text: string): Locator {
    return page
        .locator('.mat-mdc-snack-bar-label')
        .filter({ hasText: text })
        .last();
}

async function openAutoRefreshPlaylistCatalog(page: Page): Promise<void> {
    await openSources(page);
    await sourceRowByTitle(page, autoRefreshSourceName).first().click();
    await waitForM3uCatalog(page);
}

test.describe('Electron startup playlist auto-refresh', () => {
    test('imports a protected URL with User-Agent and reuses it for manual and startup refresh', async ({
        dataDir,
    }) => {
        const userAgent = 'IPTVnator-Test/1.0';
        const urlServer = await createMutableTextServer(
            buildAutoRefreshM3u('Original UA Channel'),
            {
                resourcePath: `/${autoRefreshSourceName}`,
                requiredUserAgent: userAgent,
            }
        );
        const app = await launchElectronApp(dataDir);
        try {
            expect((await fetch(urlServer.resourceUrl)).status).toBe(403);
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                urlServer.resourceUrl,
                `  ${userAgent}  `
            );
            await openSources(app.mainWindow);
            const dialog = await openSourceEditor(
                app.mainWindow,
                autoRefreshSourceName
            );
            await expect(
                dialog.getByRole('textbox', { name: 'User agent', exact: true })
            ).toHaveValue(userAgent);
            await updateSourceDialog(dialog, { autoRefresh: true });
            await saveSourceDialog(app.mainWindow, dialog);

            urlServer.setBody(buildAutoRefreshM3u('Manual UA Channel'));
            await refreshSource(app.mainWindow, autoRefreshSourceName);
            await openAutoRefreshPlaylistCatalog(app.mainWindow);
            await expect(
                app.mainWindow
                    .getByTestId('channel-item')
                    .filter({ hasText: 'Manual UA Channel' })
            ).toHaveCount(1);

            // A refresh result must keep the in-memory default as well as SQLite metadata.
            await openSources(app.mainWindow);
            urlServer.setBody(buildAutoRefreshM3u('Second UA Channel'));
            await refreshSource(app.mainWindow, autoRefreshSourceName);
            await openAutoRefreshPlaylistCatalog(app.mainWindow);
            await expect(
                app.mainWindow
                    .getByTestId('channel-item')
                    .filter({ hasText: 'Second UA Channel' })
            ).toHaveCount(1);

            urlServer.setBody(buildAutoRefreshM3u('Startup UA Channel'));
            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;
            await openAutoRefreshPlaylistCatalog(app.mainWindow);
            await expect(
                app.mainWindow
                    .getByTestId('channel-item')
                    .filter({ hasText: 'Startup UA Channel' })
            ).toHaveCount(1);
            await openSources(app.mainWindow);
            const savedDialog = await openSourceEditor(
                app.mainWindow,
                autoRefreshSourceName
            );
            await expect(
                savedDialog.getByRole('textbox', {
                    name: 'User agent',
                    exact: true,
                })
            ).toHaveValue(userAgent);
        } finally {
            await closeElectronApp(app);
            await urlServer.close();
        }
    });

    test('reports failed playlists instead of an unconditional success toast', async ({
        dataDir,
    }) => {
        const urlServer = await createMutableTextServer(
            buildAutoRefreshM3u('Original Auto Channel'),
            {
                contentType: 'application/vnd.apple.mpegurl',
                resourcePath: `/${autoRefreshSourceName}`,
            }
        );
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromUrl(
                app.mainWindow,
                urlServer.resourceUrl
            );
            await openSources(app.mainWindow);
            const dialog = await openSourceEditor(
                app.mainWindow,
                autoRefreshSourceName
            );
            await updateSourceDialog(dialog, { autoRefresh: true });
            await saveSourceDialog(app.mainWindow, dialog);

            // Reachable source: the startup run really refreshes the playlist.
            // Asserted through the persisted catalog rather than the 2s success
            // toast, which is too short-lived to poll for reliably.
            urlServer.setBody(buildAutoRefreshM3u('Refreshed Auto Channel'));
            const successfulRestart = await restartElectronApp(app, dataDir);
            app.electronApp = successfulRestart.electronApp;
            app.mainWindow = successfulRestart.mainWindow;

            await openAutoRefreshPlaylistCatalog(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('channel-item').filter({
                    hasText: 'Refreshed Auto Channel',
                })
            ).toHaveCount(1);

            // Unreachable source: the backend drops the playlist from its
            // result, so the startup toast must say so instead of claiming
            // everything was updated.
            await urlServer.close();

            const failedRestart = await restartElectronApp(app, dataDir);
            app.electronApp = failedRestart.electronApp;
            app.mainWindow = failedRestart.mainWindow;

            await expect(
                snackBarLabel(app.mainWindow, 'Playlist auto-refresh failed')
            ).toBeVisible({ timeout: 30000 });
            await expect(
                app.mainWindow.locator('.mat-mdc-snack-bar-label').filter({
                    hasText: 'The playlists were successfully updated',
                })
            ).toHaveCount(0);

            // A failed refresh must not wipe the previously imported channels.
            await openAutoRefreshPlaylistCatalog(app.mainWindow);
            await expect(
                app.mainWindow.getByTestId('channel-item').filter({
                    hasText: 'Refreshed Auto Channel',
                })
            ).toHaveCount(1);
        } finally {
            await closeElectronApp(app);
            // The test closes the server mid-run to make the source
            // unreachable; a second close rejects with ERR_SERVER_NOT_RUNNING.
            await urlServer.close().catch(() => undefined);
        }
    });
});
