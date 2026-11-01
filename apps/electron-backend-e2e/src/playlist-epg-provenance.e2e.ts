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
    test,
} from './electron-test-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

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
