import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildM3uContent,
    closeElectronApp,
    createMutableTextServer,
    expect,
    launchElectronApp,
    openAddPlaylistDialog,
    openSources,
    refreshSource,
    restartElectronApp,
    stubNativePlaylistFileDialog,
    test,
} from './electron-test-fixtures';

test('native M3U opt-out survives SQLite metadata reads, restart and a changed EPG header', async ({
    dataDir,
}) => {
    const guides = await Promise.all(
        [0, 1].map(() =>
            createMutableTextServer('<tv></tv>', {
                contentType: 'application/xml',
                resourcePath: '/guide.xml',
            })
        )
    );
    let app = await launchElectronApp(dataDir);
    const file = join(dataDir, 'epg-choice.m3u');
    const contents = (guide: string) =>
        buildM3uContent([
            { name: 'Channel', url: 'https://media.example.test/live' },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${guide}"`);
    try {
        writeFileSync(file, contents(guides[0].resourceUrl));
        await openAddPlaylistDialog(app.mainWindow);
        const dialog = app.mainWindow.getByRole('dialog');
        await expect(
            dialog.getByTestId('m3u-import-epg').getByRole('checkbox')
        ).toBeChecked();
        await dialog
            .getByRole('radio', { name: 'M3U file', exact: true })
            .click();
        await dialog
            .getByTestId('m3u-import-epg')
            .getByRole('checkbox')
            .uncheck();
        await stubNativePlaylistFileDialog(app.electronApp, file);
        await dialog.locator('.file-drop').click();
        await expect(dialog).toBeHidden();
        const metadata = () =>
            app.mainWindow.evaluate(async () =>
                (await window.electron.dbGetAppPlaylistMetas()).find(
                    (p) => p.title === 'epg-choice'
                )
            );
        await expect
            .poll(async () => (await metadata())?.autoImportEpg)
            .toBe(false);
        expect((await metadata())?.detectedEpgUrls).toEqual([
            guides[0].resourceUrl,
        ]);
        expect((await metadata())?.epgUrls).toEqual([]);

        app = await restartElectronApp(app, dataDir);
        expect((await metadata())?.autoImportEpg).toBe(false);
        writeFileSync(file, contents(guides[1].resourceUrl));
        await openSources(app.mainWindow);
        await refreshSource(app.mainWindow, 'epg-choice');
        await expect
            .poll(async () => (await metadata())?.detectedEpgUrls)
            .toEqual([guides[1].resourceUrl]);
        expect((await metadata())?.epgUrls).toEqual([]);
        expect((await metadata())?.autoImportEpg).toBe(false);
        const full = await app.mainWindow.evaluate(async () =>
            (await window.electron.dbGetAppPlaylists()).find(
                (p) => p.title === 'epg-choice'
            )
        );
        expect(full?.autoImportEpg).toBe(false);
        expect(full?.epgUrls).toEqual([]);
    } finally {
        await closeElectronApp(app);
        await Promise.all(guides.map((guide) => guide.close()));
    }
});
