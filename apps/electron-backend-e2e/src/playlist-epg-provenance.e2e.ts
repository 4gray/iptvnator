import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildM3uContent,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSourceEditor,
    openSources,
    restartElectronApp,
    saveSourceDialog,
    refreshSource,
    test,
} from './electron-test-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

test('legacy SQLite EPG sources preserve provenance and removal through rename, restart and refresh', async ({
    dataDir,
}) => {
    const server = await createMutableTextServer(
        '<?xml version="1.0"?><tv></tv>',
        { contentType: 'application/xml', resourcePath: '/legacy-guide.xml' }
    );
    let app = await launchElectronApp(dataDir);
    try {
        const file = join(dataDir, 'synthetic-legacy-guide.m3u');
        const raw = buildM3uContent([
            {
                name: 'Synthetic legacy channel',
                url: 'https://media.example.test/legacy.m3u8',
            },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${server.resourceUrl}"`);
        writeFileSync(file, raw);
        await app.mainWindow.evaluate(
            async ({ guide, file, raw }) => {
                await window.electron.dbUpsertAppPlaylist({
                    _id: 'synthetic-legacy-guide',
                    title: 'Synthetic legacy guide',
                    count: 1,
                    importDate: '2026-11-01T00:00:00Z',
                    lastUsage: '',
                    autoRefresh: false,
                    favorites: [],
                    epgUrls: [guide],
                    filePath: file,
                    sourceRawM3u: raw,
                    playlist: {
                        header: { raw: raw.split('\n')[0], attrs: {} },
                        items: [
                            {
                                name: 'Synthetic legacy channel',
                                url: 'https://media.example.test/legacy.m3u8',
                            },
                        ],
                    },
                });
            },
            { guide: server.resourceUrl, file, raw }
        );
        app = await restartElectronApp(app, dataDir);
        await openSources(app.mainWindow);
        let dialog = await openSourceEditor(
            app.mainWindow,
            'Synthetic legacy guide'
        );
        const savedRow = () =>
            dialog.locator(
                `[data-epg-source-state="enabled"][data-epg-source-url="${server.resourceUrl}"]`
            );
        await expect(savedRow().locator('mat-hint')).toContainText(
            'Saved source'
        );
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveCount(0);
        await dialog
            .locator('[formControlName="title"]')
            .fill('Synthetic renamed legacy guide');
        await saveSourceDialog(app.mainWindow, dialog);
        app = await restartElectronApp(app, dataDir);
        const stored = await app.mainWindow.evaluate(async () => ({
            meta: (await window.electron.dbGetAppPlaylistMetas()).find(
                (row) => row._id === 'synthetic-legacy-guide'
            ),
            full: await window.electron.dbGetAppPlaylist(
                'synthetic-legacy-guide'
            ),
        }));
        for (const row of [stored.meta, stored.full]) {
            expect(row).toMatchObject({
                title: 'Synthetic renamed legacy guide',
                epgUrls: [server.resourceUrl],
                detectedEpgUrls: [],
                manualEpgUrls: [],
            });
        }
        await openSources(app.mainWindow);
        dialog = await openSourceEditor(
            app.mainWindow,
            'Synthetic renamed legacy guide'
        );
        await expect(savedRow().locator('mat-hint')).toContainText(
            'Saved source'
        );
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveCount(0);
        await savedRow()
            .getByRole('button', {
                name: 'Remove from this playlist',
                exact: true,
            })
            .click();
        await expect(savedRow()).toHaveCount(0);
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        await refreshSource(app.mainWindow, 'Synthetic renamed legacy guide');
        dialog = await openSourceEditor(
            app.mainWindow,
            'Synthetic renamed legacy guide'
        );
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveText('From playlist: 0 of 1 enabled.');
        await expect(savedRow()).toHaveCount(0);
        const refreshed = await app.mainWindow.evaluate(() =>
            window.electron.dbGetAppPlaylist('synthetic-legacy-guide')
        );
        expect(refreshed).toMatchObject({
            detectedEpgUrls: [server.resourceUrl],
            disabledEpgUrls: [server.resourceUrl],
            epgUrls: [],
        });
    } finally {
        await closeElectronApp(app);
        await server.close();
    }
});

test('playlist EPG provenance, global scope and detected counts persist in Electron', async ({
    dataDir,
}, testInfo) => {
    const servers = await Promise.all(
        [0, 1, 2].map(() =>
            createMutableTextServer('<?xml version="1.0"?><tv></tv>', {
                contentType: 'application/xml',
                resourcePath: '/guide.xml',
            })
        )
    );
    const [first, second, manual] = servers.map((server) => server.resourceUrl);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        const file = join(dataDir, 'epg-provenance.m3u');
        writeFileSync(
            file,
            buildM3uContent([
                { name: 'UI channel', url: 'https://example.test/stream.m3u8' },
            ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${first},${second}"`)
        );
        await importM3uPlaylistFromNativeDialog(app, file);
        await openSources(page);
        let dialog = await openSourceEditor(page, 'epg-provenance');
        const row = (url: string) =>
            dialog.locator(
                `[data-epg-source-state="enabled"][data-epg-source-url="${url}"]`
            );
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveText('From playlist: 2 of 2 enabled.');
        await row(second)
            .getByRole('button', {
                name: 'Remove from this playlist',
                exact: true,
            })
            .click();
        await dialog.locator('.playlist-epg-source-form input').fill(manual);
        await dialog
            .getByRole('button', { name: 'Save EPG sources', exact: true })
            .click();
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveText('From playlist: 1 of 2 enabled.');
        await expect(row(manual).locator('mat-hint')).toContainText(
            'Added manually'
        );
        await row(first)
            .getByRole('button', {
                name: 'Add to global EPG settings',
                exact: true,
            })
            .click();
        await expect(row(first).getByRole('status')).toHaveText(
            'In global EPG settings'
        );
        await expect(
            row(first).getByRole('button', {
                name: 'Add to global EPG settings',
                exact: true,
            })
        ).toBeDisabled();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await expectTextContrast(row(first).locator('mat-hint'));
            await page.screenshot({
                path: testInfo.outputPath(`epg-provenance-${theme}.png`),
            });
        }
        await dialog
            .getByTestId('playlist-epg-available')
            .locator('summary')
            .click();
        await dialog
            .getByRole('button', {
                name: 'Enable for this playlist',
                exact: true,
            })
            .click();
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveText('From playlist: 2 of 2 enabled.');
        await expect
            .poll(() =>
                page.evaluate(
                    async () =>
                        (await window.electron.dbGetAppPlaylists()).find(
                            (p) => p.title === 'epg-provenance'
                        )?.epgUrls?.length
                )
            )
            .toBe(3);
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        dialog = await openSourceEditor(page, 'epg-provenance');
        await expect(
            dialog.getByTestId('playlist-epg-detected-count')
        ).toHaveText('From playlist: 2 of 2 enabled.');
        await expect(row(first).getByRole('status')).toHaveText(
            'In global EPG settings'
        );
        await expect(row(second).locator('mat-hint')).toContainText(
            'From playlist'
        );
    } finally {
        await closeElectronApp(app);
        await Promise.all(servers.map((server) => server.close()));
    }
});
