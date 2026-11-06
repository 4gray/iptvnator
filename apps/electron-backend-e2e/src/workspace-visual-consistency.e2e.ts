import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    applyTheme,
    expectTextContrast,
    measureBackdropTextContrast,
} from './theme-contrast';

test('keeps compact navigation and source/category text legible in both themes', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120_000);
    await resetMockServers(request, ['xtream']);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await page.setViewportSize({ width: 1280, height: 900 });
        await addXtreamPortal(page);
        await waitForXtreamWorkspaceReady(page);
        const categories = page.locator('.category-item');
        await categories.first().click();
        const selected = page.locator(
            '.category-item.selected .nav-item-label'
        );
        await expect(selected).toBeVisible();

        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            // Raster measurement includes the real selected gradient/tint.
            await expect
                .poll(() => measureBackdropTextContrast(page, selected))
                .toBeGreaterThanOrEqual(4.5);
            const activeLink = page
                .locator('.portal-rail-link.is-active')
                .first();
            await expect(activeLink).toBeVisible();
            await expect(activeLink).toHaveAttribute('aria-label', /\S/);
            expect(
                await activeLink.evaluate(
                    (element) => getComputedStyle(element, '::after').content
                )
            ).toBe('none');
            await expect(
                page.locator('.rail-link-label, .rail-shortcut-label')
            ).toHaveCount(0);
        }

        await page.getByRole('link', { name: 'Sources', exact: true }).click();
        const url = page.locator('.source-row__part--url').first();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await expectTextContrast(url);
        }

        for (const width of [768, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await expect(
                page.getByRole('link', { name: 'Sources', exact: true })
            ).toBeVisible();
            await expect
                .poll(() =>
                    page.evaluate(
                        () => document.documentElement.scrollWidth <= innerWidth
                    )
                )
                .toBe(true);
        }
    } finally {
        await closeElectronApp(app);
    }
});
