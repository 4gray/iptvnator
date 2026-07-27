import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Locator, Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    deleteSource,
    expect,
    launchElectronApp,
    openSettings,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';

/**
 * Full backup round-trip through the real UI, DB worker and IPC stack:
 * hide a category, export the backup, delete the source, import the file
 * back and verify the restored portal hides the same category again after
 * its content is re-imported from the mock server (regression for #1017 —
 * exported hidden categories lost their xtream IDs and the restore either
 * hid everything or nothing).
 */
test.describe('Electron playlist backup round-trip', () => {
    test('exports a backup and re-imports it with hidden categories restored', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const portalName = 'Backup Roundtrip Xtream';
        const exportPath = join(dataDir, 'roundtrip-backup.json');
        const app = await launchElectronApp(dataDir);

        try {
            await addXtreamPortal(app.mainWindow, { name: portalName });
            await waitForXtreamWorkspaceReady(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Live TV');
            await app.mainWindow.waitForURL(
                /\/workspace\/xtreams\/[^/]+\/live/
            );

            const targetCategory = await pickVisibleCategoryWithContent(
                app.mainWindow
            );

            let dialog = await openManageCategoriesDialog(app.mainWindow);
            await setManagedCategoryChecked(dialog, targetCategory.name, false);
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await app.mainWindow.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });
            await expect(
                sidebarCategoryById(app.mainWindow, targetCategory.id)
            ).toHaveCount(0);

            // Export through the real settings flow with the native save
            // dialog stubbed to a fixed path inside the test data dir.
            await app.electronApp.evaluate(({ dialog: nativeDialog }, path) => {
                nativeDialog.showSaveDialog = async () => ({
                    canceled: false,
                    filePath: path,
                });
            }, exportPath);

            await openSettings(app.mainWindow);
            const backupSection = app.mainWindow.locator('#backup');
            await backupSection
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            await expect(
                app.mainWindow.getByText('Playlist backup exported.')
            ).toBeVisible({ timeout: 15000 });

            // The exported manifest must reference hidden categories by
            // numeric xtream ID — the #1017 regression exported anonymous
            // { categoryType } entries.
            const manifest = JSON.parse(readFileSync(exportPath, 'utf-8')) as {
                playlists: Array<{
                    portalType: string;
                    userState?: {
                        hiddenCategories?: Array<{
                            categoryType?: string;
                            xtreamId?: unknown;
                        }>;
                    };
                }>;
            };
            const xtreamEntry = manifest.playlists.find(
                (entry) => entry.portalType === 'xtream'
            );
            const hiddenCategories =
                xtreamEntry?.userState?.hiddenCategories ?? [];
            expect(hiddenCategories.length).toBeGreaterThan(0);
            expect(
                hiddenCategories.every(
                    (hiddenCategory) =>
                        typeof hiddenCategory.xtreamId === 'number'
                )
            ).toBe(true);

            await openSources(app.mainWindow);
            await deleteSource(app.mainWindow, portalName);
            await expect(
                sourceRowByTitle(app.mainWindow, portalName)
            ).toHaveCount(0);

            // Import the exported file back through the settings flow; the
            // renderer opens a browser file chooser for it.
            await openSettings(app.mainWindow);
            const fileChooserPromise =
                app.mainWindow.waitForEvent('filechooser');
            await backupSection
                .getByRole('button', { name: 'Import', exact: true })
                .click();
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(exportPath);
            await expect(
                app.mainWindow.getByText(/Backup import finished: 1 imported/)
            ).toBeVisible({ timeout: 15000 });

            // Restart before opening the restored portal: the root-provided
            // XtreamStore still holds the deleted portal's in-memory state
            // under the same playlist id and would skip content
            // initialization in this session. A restart matches the primary
            // restore workflow (fresh install) and forces a real re-import.
            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            // Opening the restored portal re-imports content from the mock
            // server; the pending restore state must hide the same category
            // again.
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

            // The restored hidden flag must live in the database itself,
            // not only in the rendered sidebar state.
            const restoredPlaylistId =
                app.mainWindow.url().match(/xtreams\/([^/]+)/)?.[1] ?? '';
            expect(restoredPlaylistId).not.toEqual('');
            const restoredDbRows = await app.mainWindow.evaluate(
                (playlistId) =>
                    (
                        window as unknown as {
                            electron: {
                                dbGetAllCategories: (
                                    id: string,
                                    type: string
                                ) => Promise<
                                    Array<{ name: string; hidden: boolean }>
                                >;
                            };
                        }
                    ).electron.dbGetAllCategories(playlistId, 'live'),
                restoredPlaylistId
            );
            expect(restoredDbRows.length).toBeGreaterThan(0);
            expect(
                restoredDbRows
                    .filter((row) => row.hidden)
                    .map((row) => row.name)
            ).toEqual([targetCategory.name]);

            dialog = await openManageCategoriesDialog(app.mainWindow);
            await dialog
                .locator('input[type="search"]')
                .fill(targetCategory.name);
            const restoredRow = dialog.locator('.category-item').first();
            await expect(restoredRow).toBeVisible({ timeout: 15000 });
            await expect(
                restoredRow.locator('mat-checkbox input')
            ).not.toBeChecked();
        } finally {
            await closeElectronApp(app);
        }
    });
});

async function openManageCategoriesDialog(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'Manage categories' }).click();
    const dialog = page.locator('mat-dialog-container').last();

    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.category-item').first()).toBeVisible({
        timeout: 15000,
    });
    return dialog;
}

async function setManagedCategoryChecked(
    dialog: Locator,
    categoryName: string,
    shouldBeChecked: boolean
): Promise<void> {
    await dialog.locator('input[type="search"]').fill(categoryName);
    const row = dialog.locator('.category-item').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const checkbox = row.locator('mat-checkbox input');

    if (shouldBeChecked) {
        await checkbox.check();
        await expect(checkbox).toBeChecked();
    } else {
        await checkbox.uncheck();
        await expect(checkbox).not.toBeChecked();
    }
}

function sidebarCategoryById(page: Page, categoryId: string): Locator {
    return page.locator(
        `app-workspace-context-panel .category-item[data-category-id="${categoryId}"]`
    );
}

async function pickVisibleCategoryWithContent(
    page: Page
): Promise<{ id: string; name: string }> {
    let picked: { id: string; name: string } | null = null;

    await expect
        .poll(
            async () => {
                const categories = page.locator(
                    'app-workspace-context-panel .category-item:visible'
                );
                const count = await categories.count();

                for (let index = 0; index < count; index += 1) {
                    const category = categories.nth(index);
                    const id =
                        (
                            await category.getAttribute('data-category-id')
                        )?.trim() ?? '';
                    const name =
                        (
                            await category
                                .locator('.nav-item-label')
                                .textContent()
                        )?.trim() ?? '';
                    const countText =
                        (
                            await category.locator('.item-count').textContent()
                        )?.trim() ?? '';

                    if (id && name && (Number.parseInt(countText, 10) || 0) > 0) {
                        picked = { id, name };
                        return true;
                    }
                }

                picked = null;
                return false;
            },
            {
                message:
                    'No visible Xtream category with content was found in the sidebar.',
                timeout: 15000,
            }
        )
        .toBe(true);

    return picked!;
}
