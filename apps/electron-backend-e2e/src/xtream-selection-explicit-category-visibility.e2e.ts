import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    openSourceEditor,
    saveSourceDialog,
    test,
    xtreamMockServer,
} from './electron-test-fixtures';
import { terminateElectronProcess } from './electron-process-termination';

for (const scenario of ['edit', 'crash', 'archive'] as const)
    test(`explicit visibility of an idle disabled retained category survives export and re-enable (scenario=${scenario})`, async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120000);
        const crash = scenario === 'crash';
        const response = await request.get(
            `${xtreamMockServer}/player_api.php?username=performance&password=performance&action=get_vod_categories`
        );
        const categories = (await response.json()) as { category_id: string }[];
        const [retained, absent] = categories
            .slice(0, 2)
            .map((row) => Number(row.category_id));
        if (!retained || !absent || retained === absent)
            throw new Error(
                'Synthetic fixture needs distinct category identities'
            );
        let app = await launchElectronApp(dataDir);
        let page = app.mainWindow;
        const title = 'Synthetic explicit category visibility';
        try {
            await addXtreamPortal(page, {
                name: title,
                username: 'performance',
                password: 'performance',
                contentTypes: [],
            });
            await openSources(page);
            const id = await page.evaluate(
                async ({ title, retained, absent }) => {
                    const source = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title)!;
                    await window.electron.dbSaveCategories(
                        source._id,
                        [
                            {
                                category_id: String(retained),
                                category_name:
                                    'Synthetic retained visibility category',
                                parent_id: 0,
                            },
                        ],
                        'movies'
                    );
                    const [row] = await window.electron.dbGetAllCategories(
                        source._id,
                        'movies'
                    );
                    await window.electron.dbUpdateCategoryVisibility(
                        [row.id],
                        true,
                        true
                    );
                    await window.electron.dbSetAppState(
                        `xtream-import-status:${source._id}:movie`,
                        'idle'
                    );
                    localStorage.setItem(
                        `xtream-catalog-restore-${source._id}`,
                        JSON.stringify({
                            version: 1,
                            favorites: [],
                            playbackPositions: [],
                            recentlyViewed: [],
                            hiddenCategories: [retained, absent].map(
                                (xtreamId) => ({
                                    categoryType: 'movies',
                                    xtreamId,
                                })
                            ),
                        })
                    );
                    return source._id;
                },
                { title, retained, absent }
            );
            if (scenario === 'archive') {
                const entry: XtreamPlaylistBackupEntry = {
                    portalType: 'xtream',
                    exportedId: id,
                    title,
                    autoRefresh: false,
                    connection: {
                        serverUrl: xtreamMockServer,
                        username: 'performance',
                        password: 'performance',
                    },
                    xtreamContentTypes: [],
                    userState: {
                        favorites: [],
                        hiddenCategories: [],
                        recentlyViewed: [],
                        playbackPositions: [],
                    },
                };
                const archive: PlaylistBackupManifestV1 = {
                    kind: 'iptvnator-playlist-backup',
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    includeSecrets: true,
                    playlists: [entry],
                };
                const input = join(
                    dataDir,
                    'synthetic-empty-visibility-backup.json'
                );
                writeFileSync(input, JSON.stringify(archive));
                await openSettings(page);
                await openSettingsSection(page, 'backup');
                const chooser = page.waitForEvent('filechooser');
                await page
                    .locator('#backup')
                    .getByRole('button', { name: 'Import', exact: true })
                    .click();
                await (await chooser).setFiles(input);
                await expect(
                    page.getByText(/Backup import finished:/)
                ).toBeVisible();
            } else {
                await page.evaluate((id) => {
                    const root = location.pathname.split('/workspace')[0];
                    history.pushState(
                        {},
                        '',
                        `${root}/workspace/xtreams/${id}/vod`
                    );
                    dispatchEvent(new PopStateEvent('popstate'));
                }, id);
                const manage = page.getByRole('button', {
                    name: 'Manage categories',
                    exact: true,
                });
                await expect(manage).toBeEnabled();
                await manage.click();
                const dialog = page.locator('mat-dialog-container').last();
                const category = dialog.locator(
                    `.category-item[data-category-id="${retained}"]`
                );
                await expect(category).toBeVisible();
                await category.getByRole('checkbox').check();
                if (crash) {
                    await app.electronApp.evaluate(
                        ({ BrowserWindow, ipcMain }) => {
                            BrowserWindow.getAllWindows()[0].webContents.session.flushStorageData();
                            type Handler = (
                                ...args: unknown[]
                            ) => Promise<unknown>;
                            const handlers = (
                                ipcMain as typeof ipcMain & {
                                    _invokeHandlers: Map<string, Handler>;
                                }
                            )._invokeHandlers;
                            const original = handlers.get(
                                'DB_UPDATE_CATEGORY_VISIBILITY'
                            )!;
                            ipcMain.removeHandler(
                                'DB_UPDATE_CATEGORY_VISIBILITY'
                            );
                            ipcMain.handle(
                                'DB_UPDATE_CATEGORY_VISIBILITY',
                                async (event, ids, hidden, ...args) => {
                                    const result = await original(
                                        event,
                                        ids,
                                        hidden,
                                        ...args
                                    );
                                    if (hidden === false) {
                                        (
                                            globalThis as typeof globalThis & {
                                                visibilityCommitted?: boolean;
                                            }
                                        ).visibilityCommitted = true;
                                        // Hold the reply AFTER the real SQL transaction. No
                                        // renderer-side follow-up can become the durability proof.
                                        await new Promise<void>(
                                            () => undefined
                                        );
                                    }
                                    return result;
                                }
                            );
                        }
                    );
                }
                await dialog
                    .locator('mat-dialog-actions')
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                if (crash) {
                    await expect
                        .poll(() =>
                            app.electronApp.evaluate(
                                () =>
                                    !!(
                                        globalThis as typeof globalThis & {
                                            visibilityCommitted?: boolean;
                                        }
                                    ).visibilityCommitted
                            )
                        )
                        .toBe(true);
                    const child = app.electronApp.process();
                    const exited = new Promise<void>((resolve) =>
                        child.once('exit', () => resolve())
                    );
                    terminateElectronProcess(child, 'SIGKILL');
                    await exited;
                    await closeElectronApp(app);
                    app = await launchElectronApp(dataDir);
                    page = app.mainWindow;
                } else await expect(dialog).not.toBeVisible();
            }
            expect(
                (
                    await page.evaluate(
                        (id) =>
                            window.electron.dbGetAllCategories(id, 'movies'),
                        id
                    )
                )[0].hidden
            ).toBe(false);

            const output = join(
                dataDir,
                'synthetic-explicit-visibility-export.json'
            );
            await app.electronApp.evaluate(({ dialog }, filePath) => {
                dialog.showSaveDialog = async () => ({
                    canceled: false,
                    filePath,
                });
            }, output);
            await openSettings(page);
            await openSettingsSection(page, 'backup');
            await page
                .locator('#backup')
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            await expect(
                page.getByText('Playlist backup exported.')
            ).toBeVisible();
            const exported = (
                JSON.parse(
                    readFileSync(output, 'utf8')
                ) as PlaylistBackupManifestV1
            ).playlists.find(
                (entry) => entry.exportedId === id
            ) as XtreamPlaylistBackupEntry;
            expect(exported.userState.hiddenCategories).toEqual(
                scenario === 'archive'
                    ? []
                    : [{ categoryType: 'movies', xtreamId: absent }]
            );
            expect(exported.xtreamContentTypes).toEqual([]);

            await openSources(page);
            const editor = await openSourceEditor(page, title);
            await editor
                .getByTestId('xtream-load-movie')
                .getByRole('checkbox')
                .check();
            await saveSourceDialog(page, editor);
            const restored = await page.evaluate(
                (id) => window.electron.dbGetAllCategories(id, 'movies'),
                id
            );
            expect(
                restored.find((row) => row.xtream_id === retained)?.hidden
            ).toBe(false);
            expect(
                restored.find((row) => row.xtream_id === absent)?.hidden
            ).toBe(scenario !== 'archive');
        } finally {
            await closeElectronApp(app);
        }
    });
