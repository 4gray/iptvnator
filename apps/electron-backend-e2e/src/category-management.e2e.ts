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
    restartElectronApp,
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
            // Wait for the route to settle on the live TV section so that
            // the sidebar shows live categories (not VOD/series from a
            // previous section) before we read from it.
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/live/
            );

            const targetCategory = await pickSidebarCategory(app.mainWindow);

            let dialog = await openManageCategoriesDialog(app.mainWindow);

            await dialog
                .getByRole('button', {
                    name: 'Deselect All',
                    exact: true,
                })
                .click();
            await expect(
                dialog.locator('.category-item mat-checkbox input:checked')
            ).toHaveCount(0);

            await dialog
                .getByRole('button', {
                    name: 'Select All',
                    exact: true,
                })
                .click();
            await expect(
                dialog
                    .locator('.category-item mat-checkbox input:checked')
                    .first()
            ).toBeVisible();

            await dialog
                .locator('input[type="search"]')
                .fill(targetCategory.name);
            await toggleManagedCategory(dialog, targetCategory, false);
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect(
                sidebarCategoryById(app.mainWindow, targetCategory.id)
            ).toHaveCount(0);

            await openSources(app.mainWindow);
            await refreshSource(app.mainWindow, portalName, { confirm: true });
            await openSources(app.mainWindow);
            await waitForSourceRowIdle(app.mainWindow, portalName);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalName).first().click();
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/live/
            );
            await expect(
                sidebarCategoryById(app.mainWindow, targetCategory.id)
            ).toHaveCount(0);

            dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog
                .locator('input[type="search"]')
                .fill(targetCategory.name);
            await toggleManagedCategory(dialog, targetCategory, true);
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog
                .locator('input[type="search"]')
                .fill(targetCategory.name);
            const restoredRows = dialog.locator('.category-item');
            await expect(restoredRows).toHaveCount(1, { timeout: 15000 });
            await expect(
                restoredRows.first().locator('mat-checkbox input')
            ).toBeChecked();
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });
        } finally {
            await closeElectronApp(app);
        }
    });

    test('persists hidden selections after refreshing from the workspace header', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const portalName = 'Header Refresh Xtream';
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, {
                name: portalName,
            });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/live/
            );

            const targetCategory = await pickSidebarCategory(app.mainWindow);
            const dialog = await openManageCategoriesDialog(app.mainWindow);

            await dialog
                .getByRole('button', {
                    name: 'Deselect All',
                    exact: true,
                })
                .click();
            await expect(
                dialog.locator('.category-item mat-checkbox input:checked')
            ).toHaveCount(0);

            await dialog
                .locator('input[type="search"]')
                .fill(targetCategory.name);
            await toggleManagedCategory(dialog, targetCategory, true);
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect(
                sidebarCategoryById(app.mainWindow, targetCategory.id)
            ).toBeVisible();

            await refreshFromWorkspaceHeader(app.mainWindow);
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/live/
            );
            await expectVisibleSidebarCategoryNames(app.mainWindow, [
                targetCategory.name,
            ]);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, portalName).first().click();
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/live/
            );
            await expectVisibleSidebarCategoryNames(app.mainWindow, [
                targetCategory.name,
            ]);
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

async function refreshFromWorkspaceHeader(page: Page): Promise<void> {
    await page
        .getByRole('button', { name: 'Refresh playlist', exact: true })
        .click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

function sidebarCategoryById(page: Page, categoryId: string): Locator {
    return page.locator(
        `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]`
    );
}

async function expectVisibleSidebarCategoryIds(
    page: Page,
    expectedIds: string[]
): Promise<void> {
    const categories = page.locator(
        'app-workspace-context-panel .category-item:visible'
    );
    const actualIds: string[] = [];
    const count = await categories.count();

    for (let index = 0; index < count; index += 1) {
        const categoryId = await categories
            .nth(index)
            .getAttribute('data-category-id');

        if (categoryId) {
            actualIds.push(categoryId.trim());
        }
    }

    expect(actualIds).toEqual(expectedIds);
}

async function expectVisibleSidebarCategoryNames(
    page: Page,
    expectedNames: string[]
): Promise<void> {
    await expect
        .poll(async () => {
            const categories = page.locator(
                'app-workspace-context-panel .category-item:visible'
            );
            const actualNames: string[] = [];
            const count = await categories.count();

            for (let index = 0; index < count; index += 1) {
                const categoryName =
                    (
                        await categories
                            .nth(index)
                            .locator('.nav-item-label')
                            .textContent()
                    )?.trim() ?? '';

                if (categoryName) {
                    actualNames.push(categoryName);
                }
            }

            return actualNames;
        })
        .toEqual(expectedNames);
}

async function pickSidebarCategory(
    page: Page
): Promise<{ id: string; itemCount: number; name: string }> {
    let preferredCandidate:
        | { id: string; itemCount: number; name: string }
        | null = null;

    await expect
        .poll(async () => {
            const categories = page.locator(
                'app-workspace-context-panel .category-item:visible'
            );
            const count = await categories.count();
            const candidates: Array<{
                id: string;
                itemCount: number;
                name: string;
            }> = [];

            for (let index = 0; index < count; index += 1) {
                const category = categories.nth(index);
                const id =
                    (await category.getAttribute('data-category-id'))?.trim() ??
                    '';
                const name =
                    (
                        await category.locator('.nav-item-label').textContent()
                    )?.trim() ?? '';
                const countText =
                    (
                        await category.locator('.item-count').textContent()
                    )?.trim() ?? '';
                const itemCount = Number.parseInt(countText, 10) || 0;

                if (id && name && itemCount > 0) {
                    candidates.push({ id, itemCount, name });
                }
            }

            if (candidates.length === 0) {
                preferredCandidate = null;
                return false;
            }

            const nameCounts = new Map<string, number>();
            for (const candidate of candidates) {
                nameCounts.set(
                    candidate.name,
                    (nameCounts.get(candidate.name) ?? 0) + 1
                );
            }

            preferredCandidate =
                candidates.find(
                    (candidate) => nameCounts.get(candidate.name) === 1
                ) ?? candidates[0];

            return preferredCandidate !== null;
        })
        .toBe(true, {
            message: 'No visible Xtream category with content was found.',
            timeout: 15000,
        });

    return preferredCandidate!;
}

async function toggleManagedCategory(
    dialog: Locator,
    targetCategory: {
        id: string;
        itemCount: number;
        name: string;
    },
    shouldBeSelected: boolean
): Promise<void> {
    void targetCategory.id;
    const categoryRows = dialog.locator('.category-item');
    await expect(categoryRows).toHaveCount(1, { timeout: 15000 });
    const categoryRow = categoryRows.first();
    const checkbox = categoryRow.locator('mat-checkbox input');

    await expect(categoryRow).toBeVisible({ timeout: 15000 });
    if (shouldBeSelected) {
        await checkbox.check();
        await expect(checkbox).toBeChecked();
        return;
    }

    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
}
