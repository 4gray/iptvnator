import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchCompetingElectronInstance,
    launchElectronApp,
    m3uFixturePath,
    openSources,
    test,
} from './electron-test-fixtures';

test.describe('Electron Native Playlist Import', () => {
    test('@m3u @electron imports an M3U playlist via the native file picker path', async ({
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

    test('@m3u @electron opens a playlist passed on the command line', async ({
        dataDir,
    }) => {
        // Mirrors a file-association double-click on Windows/Linux: the path
        // is the app's own argv, resolved and queued in the main process
        // before the renderer exists.
        const app = await launchElectronApp(dataDir, {
            appArgs: [m3uFixturePath],
        });

        try {
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/, {
                timeout: 30000,
            });
            await expect(
                app.mainWindow.getByTestId('channel-item')
            ).toHaveCount(4);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@m3u @electron opens every playlist of a multi-file selection', async ({
        dataDir,
    }) => {
        // Selecting several playlists in a file manager is a single launch
        // with one argument per file, because the generated desktop entry
        // ends in `%U`. Stopping at the first would drop the rest.
        const secondPlaylist = join(dataDir, 'second-selection.m3u');
        copyFileSync(m3uFixturePath, secondPlaylist);

        const app = await launchElectronApp(dataDir, {
            appArgs: [m3uFixturePath, secondPlaylist],
        });

        try {
            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/, {
                timeout: 30000,
            });
            await openSources(app.mainWindow);
            await expect(
                app.mainWindow.locator('app-playlist-item')
            ).toHaveCount(2, { timeout: 30000 });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@m3u @electron opens a playlist handed over by a second launch', async ({
        dataDir,
    }) => {
        // The second process never gets a window: the single-instance guard
        // makes it quit and forwards its argv to the running app.
        const app = await launchElectronApp(dataDir);

        try {
            const competing = await launchCompetingElectronInstance(dataDir, {
                appArgs: [m3uFixturePath],
            });

            expect(
                competing.timedOut,
                `Competing instance did not exit. stderr: ${competing.stderr}`
            ).toBe(false);

            await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/, {
                timeout: 30000,
            });
            await expect(
                app.mainWindow.getByTestId('channel-item')
            ).toHaveCount(4);
        } finally {
            await closeElectronApp(app);
        }
    });
});
