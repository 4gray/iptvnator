import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

test.describe('Electron App Smoke Test', () => {
    test('app should start and display the dashboard', async ({ dataDir }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await expect
                .poll(async () => app.mainWindow.title())
                .toContain('IPTVnator');
            await expect(
                app.mainWindow.getByRole('link', {
                    name: 'Dashboard',
                    exact: true,
                })
            ).toBeVisible();
            await expect(
                app.mainWindow.getByRole('link', { name: 'Open settings' })
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('app should expose the expected main window properties', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            const isVisible = await app.electronApp.evaluate(
                async ({ BrowserWindow }) => {
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    return mainWindow ? mainWindow.isVisible() : false;
                }
            );

            expect(isVisible).toBe(true);

            const bounds = await app.electronApp.evaluate(
                async ({ BrowserWindow }) => {
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    return mainWindow ? mainWindow.getBounds() : null;
                }
            );

            expect(bounds).not.toBeNull();
            expect(bounds?.width).toBeGreaterThan(800);
            expect(bounds?.height).toBeGreaterThan(600);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('app should render workspace content', async ({ dataDir }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Open command palette',
                })
            ).toBeVisible();
            await expect(
                app.mainWindow.getByRole('button', { name: 'Add playlist' })
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });
});
