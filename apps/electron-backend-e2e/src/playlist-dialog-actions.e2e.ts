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
import { applyTheme } from './theme-contrast';

test('@electron @epg playlist EPG saving names its independent scope', async ({
    dataDir,
}) => {
    const server = await createMutableTextServer(
        '<?xml version="1.0"?><tv></tv>',
        {
            contentType: 'application/xml',
            resourcePath: '/guide.xml',
        }
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        const file = join(dataDir, 'epg-actions.m3u');
        writeFileSync(
            file,
            buildM3uContent([
                {
                    name: 'UI channel',
                    url: 'https://example.test/channel.m3u8',
                },
            ])
        );
        await importM3uPlaylistFromNativeDialog(app, file);
        await openSources(page);
        let dialog = await openSourceEditor(page, 'epg-actions');
        await dialog.locator('[formControlName="title"]').fill('Unsaved title');
        const epg = dialog.locator('[data-test-id="playlist-epg-sources"]');
        await epg
            .locator('.playlist-epg-source-form input')
            .first()
            .fill(server.resourceUrl);
        const save = epg.getByRole('button', {
            name: 'Save EPG sources',
            exact: true,
        });
        await expect(save).toHaveText(/Save EPG sources/);
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await expect(save).toHaveCSS('height', '40px');
            await expect(save).toHaveCSS('border-top-left-radius', '10px');
            await expect(save).toHaveCSS('border-top-style', 'none');
        }
        await save.click();
        await expect(epg.locator('input[readonly]')).toHaveValue(
            server.resourceUrl
        );
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        dialog = await openSourceEditor(page, 'epg-actions');
        await expect(dialog.locator('[formControlName="title"]')).toHaveValue(
            'epg-actions'
        );
        await expect(
            dialog.locator('.playlist-epg-sources input[readonly]')
        ).toHaveValue(server.resourceUrl);
    } finally {
        await closeElectronApp(app);
        await server.close();
    }
});
