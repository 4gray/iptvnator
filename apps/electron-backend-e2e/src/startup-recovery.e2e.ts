import type { ElectronApplication } from '@playwright/test';
import {
    test,
    expect,
    launchElectronApp,
    closeElectronApp,
} from './electron-test-fixtures';

async function setSourceReadFailure(app: ElectronApplication, failed: boolean) {
    await app.evaluate(({ ipcMain }, fail) => {
        if (!fail) return;
        ipcMain.removeHandler('DB_GET_APP_PLAYLIST_METAS');
        ipcMain.handle('DB_GET_APP_PLAYLIST_METAS', () => {
            throw new Error('Synthetic source read failure');
        });
        const status = {
            currentVersion: '0.25.0',
            latestVersion: '0.25.0',
            status: 'not-available',
            supportedSelfUpdate: true,
            manualDownloadUrl: 'https://github.com/4gray/iptvnator/releases',
            channel: 'stable',
            installedChannel: 'stable',
        };
        ipcMain.removeHandler('APP_UPDATE:GET_STATUS');
        ipcMain.removeHandler('APP_UPDATE:CHECK');
        ipcMain.handle('APP_UPDATE:GET_STATUS', () => status);
        Reflect.set(globalThis, 'syntheticUpdateCheckCount', 0);
        ipcMain.handle('APP_UPDATE:CHECK', () => {
            Reflect.set(
                globalThis,
                'syntheticUpdateCheckCount',
                Reflect.get(globalThis, 'syntheticUpdateCheckCount') + 1
            );
            return status;
        });
    }, failed);
}

test('recovers settings and updates from a failed source read @electron @settings @persistence', async ({
    dataDir,
}) => {
    const desktop = await launchElectronApp(dataDir);
    try {
        await setSourceReadFailure(desktop.electronApp, true);
        await desktop.electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.reload()
        );
        const page = desktop.mainWindow;
        await expect(
            page.getByRole('heading', {
                name: 'Your sources could not be loaded',
            })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Open settings', exact: true })
        ).toBeVisible();
        await page.getByTestId('startup-open-settings').click();
        await expect(page.getByTestId('settings-container')).toBeVisible();
        await expect(
            page.getByTestId('settings-library-unavailable')
        ).toBeVisible();

        // Native commands must use the same route-safe path as the screen.
        await desktop.electronApp.evaluate(({ Menu }) => {
            const menu = Menu.getApplicationMenu()!;
            menu.getMenuItemById('app-check-for-updates')!.click();
        });
        await expect(page).toHaveURL(/\/workspace\/settings\/about/);
        await expect(page.getByTestId('app-update-status-chip')).toHaveText(
            'Up to date'
        );

        await desktop.electronApp.evaluate(({ Menu }) => {
            Menu.getApplicationMenu()!
                .getMenuItemById('app-check-for-updates')!
                .click();
        });
        await expect
            .poll(() =>
                desktop.electronApp.evaluate(() =>
                    Reflect.get(globalThis, 'syntheticUpdateCheckCount')
                )
            )
            .toBe(2);

        await desktop.electronApp.evaluate(({ Menu }) => {
            Menu.getApplicationMenu()!.getMenuItemById('app-settings')!.click();
        });
        await expect(page).toHaveURL(/\/workspace\/settings\/general/);
        await page.getByRole('radio', { name: 'Dark', exact: true }).click();
        await page.getByTestId('save-settings').click();
        await expect(page.getByTestId('save-settings')).toBeHidden();
        await page.evaluate(() => {
            window.history.pushState({}, '', '/workspace/dashboard');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await expect(page.getByTestId('startup-open-settings')).toBeVisible();
        await expect(page.locator('mat-snack-bar-container')).toBeHidden();
        await page.screenshot({
            path: test.info().outputPath('recovery-dark.png'),
        });
        await expect(
            page.getByRole('button', { name: 'Open settings', exact: true })
        ).toBeVisible();
        await page.getByTestId('startup-open-settings').click();
        await page.getByRole('radio', { name: 'Light', exact: true }).click();
        await page.getByTestId('save-settings').click();
        await expect(page.getByTestId('save-settings')).toBeHidden();
        await page.evaluate(() => {
            window.history.pushState({}, '', '/workspace/dashboard');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await expect(page.getByTestId('startup-check-updates')).toBeVisible();
        await expect(page.locator('mat-snack-bar-container')).toBeHidden();
        await page.screenshot({
            path: test.info().outputPath('recovery-light.png'),
        });
        await page.getByTestId('startup-check-updates').click();
        await expect(page.getByTestId('app-update-status-chip')).toHaveText(
            'Up to date'
        );
    } finally {
        await closeElectronApp(desktop);
    }
});
