import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

test.describe('Electron App Smoke Test', () => {
    test('@critical @electron app should start and display the dashboard', async ({ dataDir }) => {
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

    test('@critical @electron app should expose the expected main window properties', async ({
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

    test('@critical @electron expands and collapses the labelled navigation rail', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);

        try {
            const rail = app.mainWindow.locator('.app-rail');
            const toggle = app.mainWindow.getByRole('button', {
                name: 'Expand navigation',
            });

            await expect(
                app.mainWindow.getByRole('link', {
                    name: 'Dashboard',
                    exact: true,
                })
            ).toHaveCount(1);
            await expect(rail.locator('.rail-toggle-icon')).toHaveText(
                'arrow_drop_down'
            );
            await expect(rail.locator('.rail-brand')).toHaveCount(0);

            await toggle.click();

            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Collapse navigation',
                })
            ).toBeVisible();
            await expect(rail.locator('.rail-toggle-icon')).toHaveText(
                'arrow_right'
            );
            await expect(rail.locator('.rail-brand-name')).toHaveText(
                'IPTVnator'
            );
            await expect(
                rail.locator('.portal-rail-link-label', {
                    hasText: 'Dashboard',
                })
            ).toBeVisible();
            expect(
                await app.mainWindow
                    .getByRole('link', {
                        name: 'Dashboard',
                        exact: true,
                    })
                    .evaluate((link) => getComputedStyle(link, '::after').right)
            ).toBe('3px');

            const collapseToggle = app.mainWindow.getByRole('button', {
                name: 'Collapse navigation',
            });
            const toggleBackground = await collapseToggle.evaluate(
                (button) => getComputedStyle(button).backgroundColor
            );
            await collapseToggle.hover();
            await expect(collapseToggle.locator('.rail-toggle-icon')).toHaveCSS(
                'transform',
                'none'
            );
            await expect(collapseToggle).toHaveCSS(
                'background-color',
                toggleBackground
            );

            const sourcesLink = app.mainWindow.getByRole('link', {
                name: 'Sources',
                exact: true,
            });
            const selectionBackground = await sourcesLink.evaluate(() => {
                const probe = document.createElement('div');
                probe.style.background = 'var(--app-selection-surface)';
                document.body.append(probe);
                const background = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return background;
            });
            await sourcesLink.hover();
            await expect(sourcesLink).toHaveCSS(
                'background-color',
                selectionBackground
            );
            await expect
                .poll(() =>
                    sourcesLink.locator('mat-icon').evaluate((icon) => {
                        const transform = getComputedStyle(icon).transform;
                        return transform === 'none'
                            ? 1
                            : new DOMMatrixReadOnly(transform).a;
                    })
                )
                .toBeCloseTo(2.1, 2);
            await expect
                .poll(() =>
                    sourcesLink
                        .locator('mat-icon')
                        .boundingBox()
                        .then((box) => box?.width ?? Number.POSITIVE_INFINITY)
                )
                .toBeLessThanOrEqual(44);
            await expect(
                app.mainWindow
                    .getByRole('link', {
                        name: 'Dashboard',
                        exact: true,
                    })
                    .locator('mat-icon')
            ).toHaveCSS('transform', 'none');
            await expect
                .poll(() =>
                    sourcesLink
                        .locator('.portal-rail-link-label')
                        .evaluate((label) => {
                            const transform = getComputedStyle(label).transform;
                            return transform === 'none'
                                ? 1
                                : new DOMMatrixReadOnly(transform).a;
                        })
                )
                .toBe(1);

            const [magnifiedIconBox, sourcesLabelBox] = await Promise.all([
                sourcesLink.locator('mat-icon').boundingBox(),
                sourcesLink
                    .locator('.portal-rail-link-label')
                    .boundingBox(),
            ]);
            expect(magnifiedIconBox).not.toBeNull();
            expect(sourcesLabelBox).not.toBeNull();
            expect(
                (magnifiedIconBox?.x ?? 0) +
                    (magnifiedIconBox?.width ?? 0)
            ).toBeLessThanOrEqual(sourcesLabelBox?.x ?? 0);

            await app.mainWindow.emulateMedia({
                reducedMotion: 'reduce',
            });
            await expect(sourcesLink.locator('mat-icon')).toHaveCSS(
                'transform',
                'none'
            );
            await app.mainWindow.emulateMedia({
                reducedMotion: 'no-preference',
            });

            await app.mainWindow
                .getByRole('button', { name: 'Collapse navigation' })
                .click();

            await expect(rail.locator('.rail-toggle-icon')).toHaveText(
                'arrow_drop_down'
            );
            await expect(rail.locator('.rail-brand')).toHaveCount(0);
            await sourcesLink.hover();
            await expect
                .poll(() =>
                    sourcesLink.locator('mat-icon').evaluate((icon) => {
                        const transform = getComputedStyle(icon).transform;
                        return transform === 'none'
                            ? 1
                            : new DOMMatrixReadOnly(transform).a;
                    })
                )
                .toBeCloseTo(2.1, 2);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@critical @electron app should render workspace content', async ({ dataDir }) => {
        const app = await launchElectronApp(dataDir);

        try {
            await expect(
                app.mainWindow.getByRole('button', { name: 'Add playlist' })
            ).toBeVisible();

            const modifier =
                process.platform === 'darwin' ? 'Meta' : 'Control';
            await app.mainWindow.locator('body').focus();
            await app.mainWindow.keyboard.press(`${modifier}+K`);
            await expect(
                app.mainWindow.locator(
                    'mat-dialog-container app-workspace-command-palette'
                )
            ).toBeVisible();
        } finally {
            await closeElectronApp(app);
        }
    });
});
