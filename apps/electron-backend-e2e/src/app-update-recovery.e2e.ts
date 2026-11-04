import {
    test,
    expect,
    launchElectronApp,
    closeElectronApp,
    openSettings,
    openSettingsSection,
    type LaunchedElectronApp,
} from './electron-test-fixtures';

async function installUpdateFixture(
    app: LaunchedElectronApp,
    status: 'available' | 'downloaded'
) {
    await app.electronApp.evaluate(({ ipcMain, BrowserWindow }, status) => {
        const current = {
            currentVersion: '0.25.0',
            latestVersion: '0.25.1',
            status,
            supportedSelfUpdate: true,
            channel: 'stable',
            installedChannel: 'stable',
            manualDownloadUrl: 'https://updates.example.test/audit',
        };
        Reflect.set(globalThis, 'auditUpdate', current);
        Reflect.set(globalThis, 'auditInstallCount', 0);
        for (const name of ['GET_STATUS', 'DOWNLOAD', 'CHECK', 'INSTALL'])
            ipcMain.removeHandler('APP_UPDATE:' + name);
        ipcMain.handle('APP_UPDATE:GET_STATUS', () =>
            Reflect.get(globalThis, 'auditUpdate')
        );
        const push = (status: string, error?: string) => {
            const next = { ...current, status, error };
            Reflect.set(globalThis, 'auditUpdate', next);
            BrowserWindow.getAllWindows()[0].webContents.send(
                'APP_UPDATE:STATUS_CHANGED',
                next
            );
            return next;
        };
        ipcMain.handle('APP_UPDATE:DOWNLOAD', () =>
            push('error', 'Synthetic update download failed')
        );
        let checks = 0;
        ipcMain.handle('APP_UPDATE:CHECK', () => {
            push('checking');
            return ++checks === 1
                ? push('error', 'Synthetic update check failed')
                : push('available');
        });
        ipcMain.handle('APP_UPDATE:INSTALL', () => {
            Reflect.set(
                globalThis,
                'auditInstallCount',
                Reflect.get(globalThis, 'auditInstallCount') + 1
            );
            return current;
        });
        push(status);
    }, status);
}

test('keeps an update error visible and retries from the notification @electron @settings', async ({
    dataDir,
}, info) => {
    const app = await launchElectronApp(dataDir);
    try {
        await installUpdateFixture(app, 'available');
        const page = app.mainWindow;
        await page.getByTestId('app-update-notification-download').click();
        await expect(
            page.getByTestId('app-update-notification').getByRole('alert')
        ).toContainText('Synthetic update download failed');
        await page.screenshot({
            path: info.outputPath('update-error-light.png'),
        });
        await page.getByTestId('app-update-notification-download').click();
        await expect(
            page.getByTestId('app-update-notification').getByRole('alert')
        ).toContainText('Synthetic update check failed');
        await page.getByTestId('app-update-notification-download').click();
        await expect(page.getByTestId('app-update-notification')).toContainText(
            'Version 0.25.1 is available'
        );
    } finally {
        await closeElectronApp(app);
    }
});

for (const entry of ['panel', 'about'] as const) {
    test(`confirms unsaved settings before an update from ${entry} @electron @settings @persistence`, async ({
        dataDir,
    }, info) => {
        let app = await launchElectronApp(dataDir);
        try {
            const page = app.mainWindow;
            await openSettings(page);
            await page
                .getByRole('radio', { name: 'Dark', exact: true })
                .click();
            await expect(page.getByTestId('save-settings')).toBeVisible();
            await installUpdateFixture(app, 'downloaded');
            if (entry === 'about') await openSettingsSection(page, 'about');
            const install = page.getByTestId(
                entry === 'panel'
                    ? 'app-update-notification-install'
                    : 'app-update-install'
            );
            const calls = () =>
                app.electronApp.evaluate(
                    () => Reflect.get(globalThis, 'auditInstallCount') as number
                );

            await install.click();
            await expect(page.getByTestId('unsaved-dialog-stay')).toBeVisible();
            expect(await calls()).toBe(0);
            await page.screenshot({
                path: info.outputPath(`update-${entry}-unsaved-dark.png`),
            });
            await page.getByTestId('unsaved-dialog-stay').click();
            await expect(page.getByTestId('unsaved-dialog-stay')).toHaveCount(0);
            await expect(page.getByTestId('save-settings')).toBeVisible();
            expect(await calls()).toBe(0);

            await install.click();
            await page.getByTestId('unsaved-dialog-save').click();
            await expect.poll(calls).toBe(1);
            await expect(page.getByTestId('save-settings')).toBeHidden();

            // The fixture never installs or quits; a real restart verifies the promised save.
            await closeElectronApp(app);
            app = await launchElectronApp(dataDir);
            await openSettings(app.mainWindow);
            await expect(
                app.mainWindow.getByRole('radio', { name: 'Dark', exact: true })
            ).toBeChecked();
        } finally {
            await closeElectronApp(app);
        }
    });
}
