import { Locator, Page } from '@playwright/test';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { ok as assert } from 'node:assert';
import {
    addXtreamPortal,
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
import { applyTheme } from './theme-contrast';

test.describe('Electron Xtream Category Management', () => {
    test('keeps the selected category in view with 800 categories, 600 hidden and A-Z sorting', async ({
        dataDir,
        request,
    }) => {
        test.slow();
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        try {
            await addXtreamPortal(app.mainWindow, {
                username: 'category-scroll',
                password: 'category-scroll',
            });
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await waitForXtreamWorkspaceReady(app.mainWindow);
            const panel = app.mainWindow.locator('app-workspace-context-panel');
            const rows = panel.locator('.category-item');
            await expect(rows).toHaveCount(800);
            const dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog
                .getByRole('button', { name: 'Deselect All', exact: true })
                .click();
            await dialog.locator('input[type="search"]').fill('Visible');
            await dialog
                .getByRole('button', { name: 'Select Filtered', exact: true })
                .click();
            await expect(dialog.locator('.selection-info')).toHaveText(
                'Total selected: 200 / 800'
            );
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await expect(dialog).toBeHidden();
            await expect(rows).toHaveCount(200);
            await panel
                .getByRole('button', { name: 'Sort categories', exact: true })
                .click();
            await app.mainWindow
                .getByRole('menuitem', { name: 'Name A-Z' })
                .click();

            const categories = await app.mainWindow.evaluate(async () => {
                const playlistId = location.pathname.match(
                    /\/workspace\/xtreams\/([^/]+)/
                )?.[1];
                if (!playlistId)
                    throw new Error('Xtream playlist route is missing');
                const api = (
                    window as unknown as { electron: ElectronBridgeApi }
                ).electron;
                return api.dbGetCategories(playlistId, 'live');
            });
            categories.sort((left, right) =>
                left.name.localeCompare(right.name)
            );
            await expect(rows.locator('.nav-item-label')).toHaveText(
                categories.map((category) => category.name)
            );

            // Exercise collisions above and below the clicked row. Reading the
            // imported IDs avoids relying on SQLite allocation/import order.
            for (const [theme, direction] of [
                ['dark', -1],
                ['light', 1],
            ] as const) {
                await applyTheme(app.mainWindow, theme);
                const category = categories.find((candidate, index) => {
                    const wrongIndex = categories.findIndex(
                        (other) => other.xtream_id === candidate.id
                    );
                    return (
                        wrongIndex >= 0 && (wrongIndex - index) * direction > 15
                    );
                });
                assert(
                    category,
                    `Missing fixture collision in direction ${direction}`
                );
                const row = rows.filter({ hasText: category.name });
                await row.click();
                await expect(row).toHaveAttribute('aria-current', 'true');
                await expectCategoryCentered(row);
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    for (const section of ['Live TV', 'Movies', 'Series']) {
        test(`bulk edits only filtered ${section} categories and saves or discards the draft`, async ({
            dataDir,
            request,
        }) => {
            await resetMockServers(request, ['xtream']);
            const app = await launchElectronApp(dataDir);
            try {
                await addXtreamPortal(app.mainWindow, {
                    name: `Filtered ${section}`,
                });
                await waitForXtreamWorkspaceReady(app.mainWindow);
                await openWorkspaceSection(app.mainWindow, section);
                let dialog = await openManageCategoriesDialog(app.mainWindow);
                const rows = dialog.locator('.category-item');
                const names = (
                    await rows.locator('.category-name').allTextContents()
                ).map((name) => name.trim());
                // The default mock catalog has several matches and nonmatches in every type.
                const matched = names.filter((name) =>
                    name.toLowerCase().includes('a')
                );
                const outside = names.filter(
                    (name) => !name.toLowerCase().includes('a')
                );
                expect(matched.length).toBeGreaterThan(1);
                expect(outside.length).toBeGreaterThan(1);
                const checkbox = (name: string) =>
                    dialog.getByRole('checkbox', { name, exact: true });
                await checkbox(outside[0]).uncheck();
                await checkbox(matched[0]).uncheck();
                const search = () => dialog.locator('input[type="search"]');
                await search().fill('a');
                const select = () =>
                    dialog.getByRole('button', {
                        name: 'Select Filtered',
                        exact: true,
                    });
                const deselect = () =>
                    dialog.getByRole('button', {
                        name: 'Deselect Filtered',
                        exact: true,
                    });
                await expect(rows).toHaveCount(matched.length);
                await expect(select()).toBeEnabled();
                await expect(deselect()).toBeEnabled();
                await select().click();
                await expect(select()).toBeDisabled();
                await expect(dialog.locator('.selection-info')).toHaveText(
                    `Total selected: ${names.length - 1} / ${names.length}`
                );
                await deselect().click();
                await expect(deselect()).toBeDisabled();
                await expect(dialog.locator('.selection-info')).toHaveText(
                    `Total selected: ${outside.length - 1} / ${names.length}`
                );
                await search().fill('no matching mock category');
                await expect(select()).toBeDisabled();
                await expect(deselect()).toBeDisabled();
                await expect(dialog.locator('.empty-message')).toHaveText(
                    'No matching categories found'
                );
                await search().fill('');
                await expect(checkbox(outside[0])).not.toBeChecked();
                await expect(checkbox(outside[1])).toBeChecked();
                for (const name of matched)
                    await expect(checkbox(name)).not.toBeChecked();
                await dialog
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                await expect(dialog).not.toBeVisible();
                dialog = await openManageCategoriesDialog(app.mainWindow);
                await expect(checkbox(outside[0])).not.toBeChecked();
                await expect(checkbox(outside[1])).toBeChecked();
                for (const name of matched)
                    await expect(checkbox(name)).not.toBeChecked();
                await search().fill('A');
                await select().click();
                await dialog
                    .getByRole('button', { name: 'Close', exact: true })
                    .click();
                await expect(dialog).not.toBeVisible();
                dialog = await openManageCategoriesDialog(app.mainWindow);
                for (const name of matched)
                    await expect(checkbox(name)).not.toBeChecked();
                await search().fill('a');
                await select().click();
                await dialog
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                await expect(dialog).not.toBeVisible();
                dialog = await openManageCategoriesDialog(app.mainWindow);
                for (const name of matched)
                    await expect(checkbox(name)).toBeChecked();
                await expect(checkbox(outside[0])).not.toBeChecked();
                await expect(checkbox(outside[1])).toBeChecked();
                await dialog
                    .getByRole('button', { name: 'Close', exact: true })
                    .click();
            } finally {
                await closeElectronApp(app);
            }
        });
    }

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

    test('allows restoring live categories after every category is hidden', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const portalName = 'All Hidden Categories Xtream';
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

            await expect
                .poll(() => readVisibleSidebarCategoryNames(app.mainWindow), {
                    timeout: 15000,
                })
                .not.toEqual([]);
            const initialCategoryNames = await readVisibleSidebarCategoryNames(
                app.mainWindow
            );

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
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expect
                .poll(() => readVisibleSidebarCategoryNames(app.mainWindow), {
                    timeout: 15000,
                })
                .toEqual([]);

            await expect(
                app.mainWindow.getByRole('button', {
                    name: 'Manage categories',
                    exact: true,
                })
            ).toBeEnabled();

            dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog
                .getByRole('button', { name: 'Select All', exact: true })
                .click();
            await expect(
                dialog.locator('.category-item mat-checkbox input:checked')
            ).toHaveCount(initialCategoryNames.length);
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });

            await expectVisibleSidebarCategoryNames(
                app.mainWindow,
                initialCategoryNames
            );
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

/** Wait for the real smooth scroll to finish with the selected row centered. */
async function expectCategoryCentered(row: Locator): Promise<void> {
    let previousTop = -1;
    let stableSamples = 0;
    await expect
        .poll(
            async () => {
                const position = await row.evaluate((element) => {
                    const container = element.closest(
                        'app-workspace-context-category-view'
                    ) as HTMLElement;
                    const bounds = container.getBoundingClientRect();
                    const rowBounds = element.getBoundingClientRect();
                    const target =
                        container.scrollTop +
                        rowBounds.top -
                        bounds.top -
                        container.clientHeight / 2 +
                        rowBounds.height / 2;
                    const clamped = Math.min(
                        container.scrollHeight - container.clientHeight,
                        Math.max(0, target)
                    );
                    return {
                        top: container.scrollTop,
                        centered: Math.abs(container.scrollTop - clamped) < 2,
                    };
                });
                stableSamples =
                    position.top === previousTop ? stableSamples + 1 : 0;
                previousTop = position.top;
                return position.centered && stableSamples >= 3;
            },
            { intervals: [100] }
        )
        .toBe(true);
}

async function refreshFromWorkspaceHeader(page: Page): Promise<void> {
    await page
        .getByRole('button', { name: 'Refresh playlist', exact: true })
        .click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();

    const refreshOverlay = page.locator('app-workspace-shell-import-overlay');
    await expect(refreshOverlay).toBeVisible({ timeout: 5000 });
    await expect(
        refreshOverlay.getByRole('heading', {
            name: 'Refreshing playlist',
            exact: true,
        })
    ).toBeVisible();
    await expect(refreshOverlay).toContainText(/Local library/);
    await expect(refreshOverlay).toContainText(
        /Preserving your library data|Removing cached streams|Removing cached categories/
    );

    await page.waitForSelector('mat-dialog-container', { state: 'detached' });
}

function sidebarCategoryById(page: Page, categoryId: string): Locator {
    return page.locator(
        `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]`
    );
}

async function expectVisibleSidebarCategoryNames(
    page: Page,
    expectedNames: string[]
): Promise<void> {
    try {
        await expect
            .poll(() => readVisibleSidebarCategoryNames(page), {
                timeout: 30000,
            })
            .toEqual(expectedNames);
    } catch (error) {
        const actualNames = await readVisibleSidebarCategoryNames(page);
        if (stringArraysEqual(actualNames, expectedNames)) {
            return;
        }

        throw new Error(
            `Expected visible sidebar categories ${JSON.stringify(
                expectedNames
            )}, received ${JSON.stringify(actualNames)}`,
            { cause: error }
        );
    }
}

async function readVisibleSidebarCategoryNames(page: Page): Promise<string[]> {
    const categories = page.locator(
        'app-workspace-context-panel .category-item'
    );
    const actualNames: string[] = [];
    const count = await categories.count();

    for (let index = 0; index < count; index += 1) {
        const category = categories.nth(index);
        if (!(await category.isVisible())) {
            continue;
        }

        const categoryName =
            (await category.locator('.nav-item-label').textContent())?.trim() ??
            '';

        if (categoryName) {
            actualNames.push(categoryName);
        }
    }

    return actualNames;
}

function stringArraysEqual(left: string[], right: string[]): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}

async function pickSidebarCategory(
    page: Page
): Promise<{ id: string; itemCount: number; name: string }> {
    let preferredCandidate: {
        id: string;
        itemCount: number;
        name: string;
    } | null = null;

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
