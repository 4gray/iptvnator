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

    test('@electron controls reappear after leaving HTML element fullscreen', async ({
        dataDir,
    }) => {
        test.skip(
            isWindowManagerlessCi,
            'xvfb on Linux CI has no window manager'
        );
        const app = await launchElectronApp(dataDir);

        try {
            const controls = app.mainWindow.locator('app-window-controls');
            await expect(controls).not.toHaveClass(/is-hidden/);

            // The video players fullscreen their player root through the
            // HTML element-fullscreen API. That API needs transient user
            // activation, so trigger it from a real click on a temporary
            // overlay instead of calling it directly from evaluate().
            await app.mainWindow.evaluate(() => {
                const overlay = document.createElement('div');
                overlay.id = 'e2e-fullscreen-trigger';
                overlay.style.cssText =
                    'position: fixed; inset: 0; z-index: 2147483647;';
                overlay.addEventListener('click', () => {
                    overlay.remove();
                    void document.documentElement.requestFullscreen();
                });
                document.body.append(overlay);
            });
            await app.mainWindow.locator('#e2e-fullscreen-trigger').click();

            const isHtmlFullScreen = () =>
                app.mainWindow.evaluate(
                    () => document.fullscreenElement !== null
                );

            await expect.poll(isHtmlFullScreen, { timeout: 10_000 }).toBe(
                true
            );
            await expect(controls).toHaveClass(/is-hidden/, {
                timeout: 10_000,
            });

            await app.mainWindow.evaluate(() => document.exitFullscreen());
            await expect.poll(isHtmlFullScreen, { timeout: 10_000 }).toBe(
                false
            );

            // Regression: the exit push must not carry a stale
            // isFullScreen=true read mid-transition — the controls have to
            // come back once fullscreen is left.
            await expect(controls).not.toHaveClass(/is-hidden/, {
                timeout: 10_000,
            });
            await expect(
                app.mainWindow.getByTestId('window-minimize')
            ).toBeVisible();
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

test.describe('macOS traffic lights', () => {
    test.skip(
        process.platform !== 'darwin',
        'Only macOS draws the native traffic lights over the rail'
    );

    test('@electron the first rail link starts with the content area, clear of the lights', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            await expect(page.locator('.app-rail')).toHaveClass(/is-macos/);
            const firstLink = page.locator('.app-rail a').first();
            await expect(firstLink).toBeVisible();

            const [linkBox, contentBox] = await Promise.all([
                firstLink.boundingBox(),
                page.locator('.workspace-content').boundingBox(),
            ]);
            // Aligned with the content area, where the dashboard hero starts.
            expect(
                Math.abs((linkBox?.y ?? 0) - (contentBox?.y ?? -100))
            ).toBeLessThanOrEqual(1);

            const lights = await app.electronApp.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition()
            );
            expect(lights, 'native window button position').toBeTruthy();
            const lightsY = lights?.y ?? Number.NaN;
            // The buttons are about 14pt tall; keep a visible gap below them,
            // measured in window pixels (CSS pixels times the zoom factor).
            const linkTopInWindowPixels = async (): Promise<number> => {
                const [box, zoom] = await Promise.all([
                    firstLink.boundingBox(),
                    page.evaluate(() => window.outerWidth / window.innerWidth),
                ]);
                return (box?.y ?? Number.NaN) * zoom;
            };
            expect(await linkTopInWindowPixels()).toBeGreaterThanOrEqual(
                lightsY + 14 + 16
            );

            // App zoom scales CSS pixels but not the native buttons: at the
            // smallest zoom the inset must still clear them.
            for (let step = 0; step < 8; step++) {
                await page.evaluate(() =>
                    window.electron.adjustZoomLevel('out')
                );
            }
            await expect
                .poll(() =>
                    page.evaluate(() => window.outerWidth / window.innerWidth)
                )
                .toBeLessThan(0.6);
            await expect
                .poll(linkTopInWindowPixels)
                .toBeGreaterThanOrEqual(lightsY + 14 + 8);
            await page.evaluate(() => window.electron.adjustZoomLevel('reset'));
        } finally {
            await closeElectronApp(app);
        }
    });
});
