import { Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    refreshSource,
    resetMockServers,
    test,
    waitForXtreamCatalog,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

test.describe('Electron Xtream Category Management', () => {
    test('hides and restores categories, supports search and bulk actions, and persists hidden selections after refresh', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const portalName = 'Category Managed Xtream';
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: portalName,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);

            const categoryNames = await app.mainWindow
                .locator('app-workspace-context-panel .category-item .nav-item-label')
                .allInnerTexts();
            const targetCategory = categoryNames[0]?.trim();

            expect(targetCategory).toBeTruthy();

            let dialog = await openManageCategoriesDialog(app.mainWindow);

            await dialog.getByRole('button', { name: 'Deselect All' }).click();
            await expect(dialog.locator('.category-item mat-checkbox input:checked')).toHaveCount(
                0
            );

            await dialog.getByRole('button', { name: 'Select All' }).click();
            await expect(
                dialog.locator('.category-item mat-checkbox input:checked').first()
            ).toBeVisible();

            await dialog.locator('.search-field input').fill(targetCategory!);
            await expect(dialog.locator('.category-item')).toHaveCount(1);
            await dialog.locator('.category-item').first().click();
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect(
                app.mainWindow
                    .locator('app-workspace-context-panel .category-item')
                    .filter({ hasText: targetCategory! })
            ).toHaveCount(0);

            await openSources(app.mainWindow);
            await refreshSource(app.mainWindow, portalName, { confirm: true });
            await waitForXtreamCatalog(app.mainWindow);
            await expect(
                app.mainWindow
                    .locator('app-workspace-context-panel .category-item')
                    .filter({ hasText: targetCategory! })
            ).toHaveCount(0);

            dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog.locator('.search-field input').fill(targetCategory!);
            await expect(dialog.locator('.category-item')).toHaveCount(1);
            await dialog.locator('.category-item').first().click();
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect(
                app.mainWindow
                    .locator('app-workspace-context-panel .category-item')
                    .filter({ hasText: targetCategory! })
                    .first()
            ).toBeVisible();
            await clickCategoryByNameExact(app.mainWindow, targetCategory!);
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function openManageCategoriesDialog(page: Page) {
    await page.getByRole('button', { name: 'Manage categories' }).click();
    const dialog = page.locator('mat-dialog-container');

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Select All')).toBeVisible();
    return dialog;
}
