import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
} from './electron-test-fixtures';

for (const theme of ['Light', 'Dark'] as const) {
    test(`@settings @electron ${theme} desktop settings actions use shared kit roles`, async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await page.getByRole('radio', { name: theme, exact: true }).click();
            await saveSettings(page);
            await openSettingsSection(page, 'about');
            const check = page.getByTestId('app-update-check');
            await expect(check).toHaveCSS('border-top-left-radius', '10px');
            await expect(check).toHaveCSS('border-top-style', 'none');
            await expect(page.getByTestId('app-update-open-release')).toHaveCSS(
                'height',
                '40px'
            );

            await openSettingsSection(page, 'epg');
            const add = page.getByRole('button', {
                name: 'Add EPG source',
                exact: true,
            });
            await expect(add).toHaveCSS('border-top-left-radius', '10px');
            await add.click();
            await expect(add).toHaveCSS('border-top-style', 'none');
            const browse = page.getByRole('button', {
                name: 'Choose a local XMLTV file…',
                exact: true,
            });
            await expect(browse).toHaveCSS('height', '32px');
            await expect(browse).toHaveCSS('border-top-left-radius', '8px');
            await expect(
                page.getByRole('button', { name: 'Refresh EPG', exact: true })
            ).toBeDisabled();
        } finally {
            await closeElectronApp(app);
        }
    });
}
