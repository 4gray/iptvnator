import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

test('TLS recovery stays in the import focus scope and retries only after approval', async ({
    dataDir,
}, testInfo) => {
    const launched = await launchElectronApp(dataDir);
    const { mainWindow: page, electronApp } = launched;
    try {
        // Synthetic certificate failure crosses real IPC. Approval must reach
        // the next fetch as persisted host-scoped trust, never a global bypass.
        await electronApp.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('fetch-playlist-by-url');
            ipcMain.handle(
                'fetch-playlist-by-url',
                (_event, url, _title, options) => {
                    if (
                        !options?.trustedInsecureTlsHosts?.includes(
                            'fixture.invalid'
                        )
                    ) {
                        throw new Error(
                            'IPTVNATOR_SECURITY_ERROR:' +
                                JSON.stringify({
                                    code: 'invalid-tls-certificate',
                                    host: 'fixture.invalid',
                                    message: 'Synthetic certificate failure',
                                })
                        );
                    }
                    return {
                        _id: 'tls-recovery-fixture',
                        title: 'list.m3u',
                        filename: 'list.m3u',
                        url,
                        playlist: { items: [], header: {} },
                        count: 0,
                        importDate: new Date().toISOString(),
                        lastUsage: new Date().toISOString(),
                        autoRefresh: false,
                    };
                }
            );
        });
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.getByRole('dialog').filter({
            has: page.getByRole('textbox', { name: /Playlist URL/ }),
        });
        await dialog
            .getByRole('textbox', { name: /Playlist URL/ })
            .fill('https://fixture.invalid/list.m3u');
        await dialog
            .getByRole('textbox', { name: 'Playlist title' })
            .fill('Trusted draft');
        await dialog
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        await expect(dialog.getByRole('alert')).toContainText('Certificate');
        await expect(page.locator('mat-snack-bar-container')).toHaveCount(0);
        const trust = dialog.getByRole('button', {
            name: 'Trust host',
            exact: true,
        });
        await expect(trust).toBeVisible();
        // Start inside the form, then reach the action through the real trap.
        await dialog.getByRole('textbox', { name: /Playlist URL/ }).focus();
        for (
            let index = 0;
            index < 15 &&
            !(await trust.evaluate((el) => el === document.activeElement));
            index++
        ) {
            await page.keyboard.press('Tab');
        }
        await expect(trust).toBeFocused();
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('tls-recovery-light.png'),
        });
        await page.evaluate(() => document.body.classList.add('dark-theme'));
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('tls-recovery-dark.png'),
        });
        await page.evaluate(() => document.body.classList.remove('dark-theme'));
        await page.keyboard.press('Enter');
        const confirmation = page.getByRole('dialog').filter({
            has: page.getByRole('heading', {
                name: 'Trust invalid certificate?',
                exact: true,
            }),
        });
        await expect(confirmation).toContainText('Trust');
        await confirmation
            .getByRole('button', { name: 'Cancel', exact: true })
            .press('Enter');
        await expect(dialog).toBeVisible();
        await expect(
            dialog.getByRole('textbox', { name: 'Playlist title' })
        ).toHaveValue('Trusted draft');
        await expect(trust).toBeFocused();
        await page.keyboard.press('Enter');
        await confirmation
            .getByRole('button', { name: 'Trust host', exact: true })
            .press('Enter');
        await expect(dialog).toBeHidden();
        await page.getByRole('link', { name: 'Sources', exact: true }).click();
        await expect(page.locator('app-source-row')).toHaveCount(1);
        await expect(page.locator('app-source-row')).toContainText(
            'Trusted draft'
        );
    } finally {
        await closeElectronApp(launched);
    }
});
