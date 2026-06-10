import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

// Custom window controls are only rendered on Windows/Linux; macOS keeps
// the native traffic lights.
//
// Linux CI runs Electron under xvfb, which has no window manager, so
// maximize/minimize never take effect there — those tests are skipped and
// rely on Windows CI plus local Linux/macOS runs for coverage.
const isWindowManagerlessCi =
    process.platform === 'linux' && !!process.env['CI'];

test.describe('Custom window controls', () => {
    test.skip(
        process.platform === 'darwin',
        'macOS uses native traffic lights instead of custom controls'
    );

    test('@electron renders the window control buttons', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await expect(
                app.mainWindow.getByTestId('window-minimize')
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('window-maximize')
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('window-close')
            ).toBeVisible();
            await expect(
                app.mainWindow.getByTestId('window-maximize-glyph')
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron maximize button toggles the native window state', async ({
        dataDir,
    }) => {
        test.skip(
            isWindowManagerlessCi,
            'xvfb on Linux CI has no window manager'
        );
        const app = await launchElectronApp(dataDir);

        try {
            const isMaximized = () =>
                app.electronApp.evaluate(({ BrowserWindow }) => {
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    return mainWindow ? mainWindow.isMaximized() : false;
                });

            await app.mainWindow.getByTestId('window-maximize').click();
            await expect.poll(isMaximized, { timeout: 10_000 }).toBe(true);
            await expect(
                app.mainWindow.getByTestId('window-restore-glyph')
            ).toBeVisible();

            await app.mainWindow.getByTestId('window-maximize').click();
            await expect.poll(isMaximized, { timeout: 10_000 }).toBe(false);
            await expect(
                app.mainWindow.getByTestId('window-maximize-glyph')
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron reflects window state changes triggered from the main process', async ({
        dataDir,
    }) => {
        test.skip(
            isWindowManagerlessCi,
            'xvfb on Linux CI has no window manager'
        );
        const app = await launchElectronApp(dataDir);

        try {
            await app.electronApp.evaluate(({ BrowserWindow }) => {
                BrowserWindow.getAllWindows()[0]?.maximize();
            });
            await expect(
                app.mainWindow.getByTestId('window-restore-glyph')
            ).toBeVisible({ timeout: 10_000 });

            await app.electronApp.evaluate(({ BrowserWindow }) => {
                BrowserWindow.getAllWindows()[0]?.unmaximize();
            });
            await expect(
                app.mainWindow.getByTestId('window-maximize-glyph')
            ).toBeVisible({ timeout: 10_000 });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@electron minimize button minimizes the window', async ({
        dataDir,
    }) => {
        test.skip(
            isWindowManagerlessCi,
            'xvfb on Linux CI has no window manager'
        );
        const app = await launchElectronApp(dataDir);

        try {
            const isMinimized = () =>
                app.electronApp.evaluate(({ BrowserWindow }) => {
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    return mainWindow ? mainWindow.isMinimized() : false;
                });

            await app.mainWindow.getByTestId('window-minimize').click();
            await expect.poll(isMinimized, { timeout: 10_000 }).toBe(true);
        } finally {
            await closeElectronApp(app);
        }
    });
});
