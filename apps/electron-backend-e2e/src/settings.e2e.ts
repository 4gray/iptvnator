import {
    closeElectronApp,
    enableRemoteControl,
    expect,
    launchElectronApp,
    openSettings,
    saveSettings,
    test,
} from './electron-test-fixtures';

test.describe('Electron Settings', () => {
    test('persists remote control settings across app restart', async ({
        dataDir,
    }) => {
        const firstLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(firstLaunch.mainWindow);
            await enableRemoteControl(firstLaunch.mainWindow, 8877);
            await saveSettings(firstLaunch.mainWindow);
        } finally {
            await closeElectronApp(firstLaunch);
        }

        const secondLaunch = await launchElectronApp(dataDir);

        try {
            await openSettings(secondLaunch.mainWindow);

            const remoteControlCheckbox = secondLaunch.mainWindow.locator(
                'mat-checkbox[formcontrolname="remoteControl"] input[type="checkbox"]'
            );

            await expect(remoteControlCheckbox).toBeChecked();
            await expect(
                secondLaunch.mainWindow.locator('#remoteControlPort')
            ).toHaveValue('8877');
        } finally {
            await closeElectronApp(secondLaunch);
        }
    });
});
