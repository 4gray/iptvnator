import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
    addXtreamPortal,
    closeElectronApp,
    createMutableTextServer,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { startDownload } from './downloads.e2e-support';

test('@downloads @persistence @electron keeps finished downloads when every playlist is deleted', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fileServer = await createMutableTextServer('kept download payload', {
        contentType: 'video/mp4',
        resourcePath: '/media/kept-movie.mp4',
    });
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await addXtreamPortal(page, {
            name: 'Delete-all Portal',
            username: 'user1',
            password: 'pass1',
        });
        await waitForXtreamWorkspaceReady(page);
        const playlistId = await page.evaluate(
            async () =>
                (await window.electron?.dbGetAppPlaylistMetas?.())?.find(
                    (entry) => entry.title === 'Delete-all Portal'
                )?._id ?? ''
        );
        expect(playlistId).not.toBe('');

        await page.getByRole('button', { name: 'Open downloads' }).click();
        await page.waitForURL(/\/workspace\/downloads(?:\?.*)?$/);
        const downloadsDir = join(dataDir, 'e2e-downloads');
        mkdirSync(downloadsDir, { recursive: true });
        await app.electronApp.evaluate(({ dialog }, folder) => {
            dialog.showOpenDialog = async () =>
                ({
                    canceled: false,
                    filePaths: [folder],
                }) as Awaited<ReturnType<typeof dialog.showOpenDialog>>;
        }, downloadsDir);
        await page.getByRole('button', { name: 'Change Folder' }).click();
        await expect(page.getByTestId('downloads-folder')).toContainText(
            'e2e-downloads'
        );
        const id = await startDownload(page, {
            playlistId,
            xtreamId: 5151,
            contentType: 'vod',
            title: 'Kept Movie',
            url: fileServer.resourceUrl,
            downloadFolder: downloadsDir,
        });
        const card = page.getByTestId(`download-library-movie-${id}`);
        await expect(card).toBeVisible({ timeout: 20000 });
        await expect(
            page.getByRole('heading', { name: 'Ready to watch' })
        ).toBeVisible();

        await openSettings(page);
        await openSettingsSection(page, 'backup');
        await page
            .getByRole('button', { name: 'Delete all', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Delete everything', exact: true })
            .click();
        await expect(
            page.getByText('All playlists and playlist data were removed.')
        ).toBeVisible();
        expect(
            await page.evaluate(
                async () =>
                    (await window.electron?.dbGetAppPlaylistMetas?.())
                        ?.length ?? -1
            )
        ).toBe(0);

        // The global library still lists the file, which is still on disk.
        await page.getByRole('button', { name: 'Open downloads' }).click();
        await page.waitForURL(/\/workspace\/downloads(?:\?.*)?$/);
        await expect(
            page.getByTestId(`download-library-movie-${id}`)
        ).toBeVisible();
        const finalPath = join(downloadsDir, 'Kept Movie.mp4');
        expect(existsSync(finalPath)).toBe(true);
        expect(readFileSync(finalPath, 'utf8')).toBe('kept download payload');
    } finally {
        await closeElectronApp(app);
        await fileServer.close();
    }
});
