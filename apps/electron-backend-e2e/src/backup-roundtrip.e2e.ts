import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Locator, Page } from '@playwright/test';
import type { PlaylistBackupManifestV1 } from '@iptvnator/shared/interfaces';
import {
    addXtreamPortal,
    closeElectronApp,
    deleteSource,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { readVisibleSidebarCategories } from './sidebar-categories.e2e-support';

/**
 * Full backup round-trip through the real UI, DB worker and IPC stack:
 * Preserve hidden categories, collections, positions and source pins through
 * an immediate re-export while catalog restoration is still pending, then
 * verify the restored database after reopening the portal. The category UI
 * assertions also guard #1017's missing provider category IDs.
 */
test.describe('Electron playlist backup round-trip', () => {
    test('preserves pending backup state on re-export and restores it after restart', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const portalName = 'Backup Roundtrip Xtream';
        const exportPath = join(dataDir, 'roundtrip-backup.json');
        const pendingExportPath = join(dataDir, 'pending-backup.json');
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

            const playlistId =
                app.mainWindow.url().match(/xtreams\/([^/]+)/)?.[1] ?? '';
            expect(playlistId).not.toEqual('');
            // Seed realistic resume/collection state through the same IPC used
            // by playback. No player runs here to overwrite the saved position.
            const movieXtreamId = await app.mainWindow.evaluate(async (id) => {
                const [movie] = await window.electron.dbGetContent(id, 'movie');
                if (!movie) throw new Error('Mock catalog has no movie.');
                const results = await Promise.all([
                    window.electron.dbAddFavorite(movie.id, id),
                    window.electron.dbAddRecentItem(movie.id, id),
                    window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: movie.xtream_id,
                        contentType: 'vod',
                        positionSeconds: 123,
                        durationSeconds: 7200,
                    }),
                    window.electron.dbSetVodSourcePin({
                        matchKey: 'title:backup-roundtrip',
                        playlistId: id,
                        contentId: movie.xtream_id,
                        portalType: 'xtream',
                    }),
                ]);
                if (results.some((result) => !result.success)) {
                    throw new Error('Seeding backup state through IPC failed.');
                }
                return movie.xtream_id;
            }, playlistId);

            // Export through the real settings flow with the native save
            // dialog stubbed to a fixed path inside the test data dir.
            await app.electronApp.evaluate(({ dialog: nativeDialog }, path) => {
                nativeDialog.showSaveDialog = async () => ({
                    canceled: false,
                    filePath: path,
                });
            }, exportPath);

            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'backup');
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
            const manifest = JSON.parse(
                readFileSync(exportPath, 'utf-8')
            ) as PlaylistBackupManifestV1;
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

            expect(xtreamEntry?.userState.favorites).toHaveLength(1);
            expect(xtreamEntry?.userState.recentlyViewed).toHaveLength(1);
            expect(xtreamEntry?.userState.sourcePins).toHaveLength(1);
            expect(xtreamEntry?.userState.playbackPositions).toEqual([
                expect.objectContaining({
                    contentXtreamId: movieXtreamId,
                    contentType: 'vod',
                    positionSeconds: 123,
                    durationSeconds: 7200,
                }),
            ]);

            await openSources(app.mainWindow);
            await deleteSource(app.mainWindow, portalName);
            await expect(
                sourceRowByTitle(app.mainWindow, portalName)
            ).toHaveCount(0);

            // Import the exported file back through the settings flow; the
            // renderer opens a browser file chooser for it.
            await openSettings(app.mainWindow);
            await openSettingsSection(app.mainWindow, 'backup');
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

            // No catalog has been opened since import. Verify this is a
            // genuinely pending restore, then export it again through the UI.
            const pendingBeforeExport = await app.mainWindow.evaluate(
                async (id) => ({
                    pending: localStorage.getItem(`xtream-restore-${id}`),
                    hasMovies: await window.electron.dbHasContent(id, 'movie'),
                    positions:
                        await window.electron.dbGetAllPlaybackPositions(id),
                }),
                playlistId
            );
            expect(pendingBeforeExport.pending).not.toBeNull();
            expect(pendingBeforeExport.hasMovies).toBe(false);
            expect(pendingBeforeExport.positions).toEqual([]);
            await app.electronApp.evaluate(({ dialog: nativeDialog }, path) => {
                nativeDialog.showSaveDialog = async () => ({
                    canceled: false,
                    filePath: path,
                });
            }, pendingExportPath);
            await backupSection
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            await expect(
                app.mainWindow.getByText('Playlist backup exported.')
            ).toBeVisible({ timeout: 15000 });
            const pendingManifest = JSON.parse(
                readFileSync(pendingExportPath, 'utf-8')
            ) as PlaylistBackupManifestV1;
            const pendingEntry = pendingManifest.playlists.find(
                (entry) => entry.portalType === 'xtream'
            );
            expect(pendingEntry?.userState).toEqual(xtreamEntry?.userState);
            expect(
                await app.mainWindow.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    playlistId
                )
            ).toEqual(pendingBeforeExport.pending);

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

            const restoredState = await app.mainWindow.evaluate(
                async (id) => ({
                    positions:
                        await window.electron.dbGetAllPlaybackPositions(id),
                    favorites: await window.electron.dbGetFavorites(id),
                    recent: await window.electron.dbGetRecentItems(id),
                    pins: await window.electron.dbListVodSourcePins(id),
                    pending: localStorage.getItem(`xtream-restore-${id}`),
                }),
                restoredPlaylistId
            );
            expect(restoredState.positions).toEqual([
                expect.objectContaining({
                    contentXtreamId: movieXtreamId,
                    contentType: 'vod',
                    positionSeconds: 123,
                    durationSeconds: 7200,
                }),
            ]);
            expect(
                restoredState.favorites.map((item) => item.xtream_id)
            ).toEqual([movieXtreamId]);
            expect(restoredState.recent.map((item) => item.xtream_id)).toEqual([
                movieXtreamId,
            ]);
            expect(restoredState.pins).toEqual([
                expect.objectContaining({
                    matchKey: 'title:backup-roundtrip',
                    playlistId: restoredPlaylistId,
                    contentId: movieXtreamId,
                }),
            ]);
            expect(restoredState.pending).toBeNull();

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
                const category = (
                    await readVisibleSidebarCategories(page)
                ).find(
                    (candidate) =>
                        candidate.id &&
                        candidate.name &&
                        candidate.itemCount > 0
                );

                if (category) {
                    picked = { id: category.id, name: category.name };
                    return true;
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
