import { Locator, Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryById,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    refreshSource,
    resetMockServers,
    sourceRowByTitle,
    test,
    waitForSourceRowIdle,
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
            await openWorkspaceSection(app.mainWindow, 'Live TV');

            const targetCategory = await pickSidebarCategory(app.mainWindow);

            let dialog = await openManageCategoriesDialog(app.mainWindow);

            await dialog
                .getByRole('button', {
                    name: 'Deselect All',
                    exact: true,
                })
                .click();
            await expect(dialog.locator('.category-item mat-checkbox input:checked')).toHaveCount(
                0
            );

            await dialog
                .getByRole('button', {
                    name: 'Select All',
                    exact: true,
                })
                .click();
            await expect(
                dialog.locator('.category-item mat-checkbox input:checked').first()
            ).toBeVisible();

            await dialog.locator('.search-field input').fill(targetCategory.name);
            await toggleManagedCategory(dialog, targetCategory);
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect(sidebarCategoryById(app.mainWindow, targetCategory.id)).toHaveCount(
                0
            );

            await openSources(app.mainWindow);
            await refreshSource(app.mainWindow, portalName, { confirm: true });
            await openSources(app.mainWindow);
            await waitForSourceRowIdle(app.mainWindow, portalName);
            await sourceRowByTitle(app.mainWindow, portalName).first().click();
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await expect(sidebarCategoryById(app.mainWindow, targetCategory.id)).toHaveCount(
                0
            );

            dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog.locator('.search-field input').fill(targetCategory.name);
            await toggleManagedCategory(dialog, targetCategory);
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect(sidebarCategoryById(app.mainWindow, targetCategory.id)).toHaveCount(
                1
            );
            await clickCategoryById(app.mainWindow, targetCategory.id);
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function openManageCategoriesDialog(page: Page) {
    await page.getByRole('button', { name: 'Manage categories' }).click();
    const dialog = page.locator('mat-dialog-container').last();

    await expect(dialog).toBeVisible();
    await expect(
        dialog.getByRole('button', { name: 'Select All', exact: true })
    ).toBeVisible();
    // Wait for the category list to render — Angular needs a CD cycle after
    // isLoading() flips to false before the @for items are painted.
    await expect(dialog.locator('.category-item').first()).toBeVisible({
        timeout: 15000,
    });
    return dialog;
}

function sidebarCategoryById(page: Page, categoryId: string): Locator {
    return page.locator(
        `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]`
    );
}

async function pickSidebarCategory(
    page: Page
): Promise<{ id: string; itemCount: number; name: string }> {
    const categories = page.locator(
        'app-workspace-context-panel .category-item:visible'
    );
    const count = await categories.count();
    const candidates: Array<{ id: string; itemCount: number; name: string }> = [];

    for (let index = 0; index < count; index += 1) {
        const category = categories.nth(index);
        const id = (await category.getAttribute('data-category-id'))?.trim() ?? '';
        const name =
            (await category.locator('.nav-item-label').textContent())?.trim() ?? '';
        const countText =
            (await category.locator('.item-count').textContent())?.trim() ?? '';
        const itemCount = Number.parseInt(countText, 10) || 0;

        if (id && name && itemCount > 0) {
            candidates.push({ id, itemCount, name });
        }
    }

    const nameCounts = new Map<string, number>();
    for (const candidate of candidates) {
        nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
    }

    const preferredCandidate =
        candidates.find((candidate) => nameCounts.get(candidate.name) === 1) ??
        candidates[0];

    if (!preferredCandidate) {
        throw new Error('No visible Xtream category with content was found.');
    }

    return preferredCandidate;
}

async function toggleManagedCategory(
    dialog: Locator,
    targetCategory: {
        itemCount: number;
        name: string;
    }
): Promise<void> {
    // Use hasText on the whole row so Playwright's retry loop waits for Angular
    // to re-render filteredCategories() after the search field is populated.
    // Avoid nesting dialog.locator() inside filter({ has: }) — Playwright
    // cannot scope an absolute locator to each candidate element.
    const categoryRow = dialog
        .locator('.category-item')
        .filter({ hasText: targetCategory.name })
        .first();

    await expect(categoryRow).toBeVisible({ timeout: 15000 });
    await categoryRow.click();
}
