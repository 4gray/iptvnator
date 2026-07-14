import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    test,
} from './electron-test-fixtures';

test.describe('Electron Settings Layout', () => {
    test('@settings @electron keeps the save action in a compact floating chip', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await openSettings(app.mainWindow);

            const layout = app.mainWindow.locator('.settings-layout');
            const actionBar = app.mainWindow.getByTestId('settings-action-bar');
            await expect(layout).toBeVisible();
            await expect(actionBar).toBeVisible();

            const [layoutBox, actionBarBox] = await Promise.all([
                layout.evaluate((element) => {
                    const { width, x } = element.getBoundingClientRect();
                    return { width, x };
                }),
                actionBar.evaluate((element) => {
                    const { width, x } = element.getBoundingClientRect();
                    return { width, x };
                }),
            ]);

            expect(actionBarBox.width).toBeLessThan(layoutBox.width / 2);
            expect(
                Math.abs(
                    layoutBox.x +
                        layoutBox.width -
                        (actionBarBox.x + actionBarBox.width)
                )
            ).toBeLessThanOrEqual(2);
        } finally {
            await closeElectronApp(app);
        }
    });
});
