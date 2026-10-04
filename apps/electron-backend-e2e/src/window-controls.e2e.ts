import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    LaunchedElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
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

// The native buttons are 14pt circles. At 100 % zoom the first header
// control starts 60pt right of their origin, where macOS 26 ends them
// (earlier releases end them at 52pt).
const lightsHeight = 14;
const headerControlOffset = 60;

/** Where macOS drew the native window buttons, in window points. */
async function trafficLights(
    app: LaunchedElectronApp
): Promise<{ x: number; y: number }> {
    const lights = await app.electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition()
    );
    expect(lights, 'native window button position').toBeTruthy();
    return lights ?? { x: Number.NaN, y: Number.NaN };
}

/** Window pixels per CSS pixel. */
function zoomFactor(page: Page): Promise<number> {
    return page.evaluate(() => window.outerWidth / window.innerWidth);
}

/**
 * Steps the app zoom to its minimum (−4, ≈48 %). App zoom scales CSS pixels
 * but not the native buttons.
 */
async function zoomOutFully(page: Page): Promise<void> {
    for (let step = 0; step < 8; step++) {
        await page.evaluate(() => window.electron.adjustZoomLevel('out'));
    }
    await expect.poll(() => zoomFactor(page)).toBeLessThan(0.6);
}

async function resetZoom(page: Page): Promise<void> {
    await page.evaluate(() => window.electron.adjustZoomLevel('reset'));
    await expect.poll(() => zoomFactor(page)).toBeCloseTo(1, 2);
}

/**
 * The header's first rendered control and the top of the content area, in
 * window pixels (CSS pixels times the zoom factor).
 */
function headerLayout(
    page: Page
): Promise<{ control?: string; left: number; contentTop: number }> {
    return page.locator('.workspace-header').evaluate((header) => {
        const zoom = window.outerWidth / window.innerWidth;
        const first = [...header.children].find(
            (child) => child.getBoundingClientRect().width > 0
        );
        const body = document.querySelector('.workspace-body');
        return {
            control:
                first?.getAttribute('data-test-id') ??
                first?.tagName.toLowerCase(),
            left: (first?.getBoundingClientRect().left ?? 0) * zoom,
            contentTop: (body?.getBoundingClientRect().top ?? 0) * zoom,
        };
    });
}

/**
 * The first header control starts right of the lights and the content area
 * below them. Polled: the layout follows a zoom change after its resize.
 */
async function expectHeaderClearOfLights(
    page: Page,
    lights: { x: number; y: number },
    control: string,
    label: string
): Promise<void> {
    const layout = () => headerLayout(page);
    await expect
        .poll(async () => (await layout()).control, { message: label })
        .toBe(control);
    await expect
        .poll(async () => (await layout()).left, {
            message: `${label}: first control`,
        })
        .toBeGreaterThanOrEqual(lights.x + headerControlOffset);
    await expect
        .poll(async () => (await layout()).contentTop, {
            message: `${label}: content top`,
        })
        .toBeGreaterThanOrEqual(lights.y + lightsHeight);
}

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

            // Aligned with the content area, where the dashboard hero starts.
            const linkOffsetFromContent = async (): Promise<number> => {
                const [linkBox, contentBox] = await Promise.all([
                    firstLink.boundingBox(),
                    page.locator('.workspace-content').boundingBox(),
                ]);
                return Math.abs(
                    (linkBox?.y ?? 0) - (contentBox?.y ?? Number.NaN)
                );
            };
            expect(await linkOffsetFromContent()).toBeLessThanOrEqual(1);

            const lights = await trafficLights(app);
            // Keep a visible gap below the buttons, measured in window pixels
            // (CSS pixels times the zoom factor).
            const linkTopInWindowPixels = async (): Promise<number> => {
                const [box, zoom] = await Promise.all([
                    firstLink.boundingBox(),
                    zoomFactor(page),
                ]);
                return (box?.y ?? Number.NaN) * zoom;
            };
            expect(await linkTopInWindowPixels()).toBeGreaterThanOrEqual(
                lights.y + lightsHeight + 16
            );

            // At the smallest zoom the inset must still clear the buttons,
            // and the link still starts with the content area.
            await zoomOutFully(page);
            await expect
                .poll(linkTopInWindowPixels)
                .toBeGreaterThanOrEqual(lights.y + lightsHeight + 8);
            await expect.poll(linkOffsetFromContent).toBeLessThanOrEqual(1);
            await resetZoom(page);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron the first header control clears the lights at default and minimum zoom', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            const lights = await trafficLights(app);
            const switcher = 'app-playlist-switcher';
            const back = 'workspace-header-back';

            await expectHeaderClearOfLights(page, lights, switcher, '100 %');
            await zoomOutFully(page);
            await expectHeaderClearOfLights(page, lights, switcher, 'min zoom');

            // A detail page puts its Back first, pulled 8px toward the edge.
            await page
                .getByRole('link', { name: 'Series', exact: true })
                .click();
            await clickFirstGridListCard(page);
            await expect(page.getByTestId(back)).toBeVisible({
                timeout: 20_000,
            });
            await expectHeaderClearOfLights(
                page,
                lights,
                back,
                'detail at min zoom'
            );
            await resetZoom(page);
            await expectHeaderClearOfLights(
                page,
                lights,
                back,
                'detail at 100 %'
            );
        } finally {
            await closeElectronApp(app);
        }
    });
});
