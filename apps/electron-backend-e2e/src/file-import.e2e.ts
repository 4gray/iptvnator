import {
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    m3uFixturePath,
    test,
} from './electron-test-fixtures';

test.describe('Electron Native Playlist Import', () => {
    test('imports an M3U playlist via the native file picker path', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);

            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/);
            await expect(
                app.mainWindow.getByTestId('channel-item')
            ).toHaveCount(4);
        } finally {
            await closeElectronApp(app);
        }
    });
});
