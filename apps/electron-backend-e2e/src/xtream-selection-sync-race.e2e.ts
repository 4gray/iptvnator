import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    playlistSwitcherTitle,
    test,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    catalogActions,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

test('connected active-source sync waits for an edit-time catalog save before bootstrap', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const server = await startSourceSyncServer();
    const recorder = await recordCatalogRequests();
    const instance = await (await fetch(`${server.apiUrl}/v1/instance`)).json();
    writeFileSync(
        join(dataDir, 'source-server.json'),
        JSON.stringify({
            apiUrl: server.apiUrl,
            instanceId: instance.instanceId,
        })
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Active connected catalog';
    const renamed = 'Renamed active connected catalog';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            username: 'performance',
            password: 'performance',
            contentTypes: ['live'],
        });
        const id = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!._id,
            title
        );
        // Initial synthetic catalog import uses the shared 60-second setup
        // budget even when other native test workers share the host.
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) =>
                            window.electron.dbGetAppState(
                                `xtream-import-status:${id}:live`
                            ),
                        id
                    ),
                { timeout: 60000 }
            )
            .toBe('completed');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await expect(playlistSwitcherTitle(page)).toHaveText(title);
        // Hold the first real category write after it commits. A second importer
        // must not mistake its importing marker for an abandoned process.
        await app.electronApp.evaluate(({ ipcMain }, id) => {
            type Handler = (...args: unknown[]) => Promise<unknown>;
            const handlers = (
                ipcMain as typeof ipcMain & {
                    _invokeHandlers: Map<string, Handler>;
                }
            )._invokeHandlers;
            const originalSave = handlers.get('DB_SAVE_CATEGORIES')!;
            const originalDelete = handlers.get('DB_DELETE_XTREAM_CONTENT')!;
            const state = globalThis as typeof globalThis & {
                catalogDeletes: number;
                releaseCatalogSave?: () => void;
            };
            state.catalogDeletes = 0;
            ipcMain.removeHandler('DB_DELETE_XTREAM_CONTENT');
            ipcMain.handle(
                'DB_DELETE_XTREAM_CONTENT',
                async (event, playlistId, ...args) => {
                    if (playlistId === id) state.catalogDeletes++;
                    return originalDelete(event, playlistId, ...args);
                }
            );
            ipcMain.removeHandler('DB_SAVE_CATEGORIES');
            ipcMain.handle(
                'DB_SAVE_CATEGORIES',
                async (event, playlistId, rows, type, ...args) => {
                    const result = await originalSave(
                        event,
                        playlistId,
                        rows,
                        type,
                        ...args
                    );
                    if (
                        playlistId === id &&
                        type === 'movies' &&
                        !state.releaseCatalogSave
                    ) {
                        await new Promise<void>((resolve) => {
                            state.releaseCatalogSave = resolve;
                        });
                    }
                    return result;
                }
            );
        }, id);
        await page.locator('body').focus();
        await page.keyboard.press(
            `${process.platform === 'darwin' ? 'Meta' : 'Control'}+K`
        );
        const commands = page.locator('app-workspace-command-palette');
        await commands.locator('input[type="search"]').fill('Playlist details');
        await commands
            .getByRole('button', { name: /Playlist details/ })
            .click();
        const dialog = page.locator('mat-dialog-container').last();
        await dialog.locator('input[formcontrolname="title"]').fill(renamed);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        recorder.actions.length = 0;
        await dialog
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect
            .poll(() =>
                app.electronApp.evaluate(
                    () =>
                        !!(
                            globalThis as typeof globalThis & {
                                releaseCatalogSave?: () => void;
                            }
                        ).releaseCatalogSave
                )
            )
            .toBe(true);
        // The accepted title update queues the real server refresh and playlist
        // projection while the native category-save reply is still withheld.
        await expect(playlistSwitcherTitle(page)).toHaveText(renamed);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect
            .poll(() =>
                page.evaluate(
                    async (id) =>
                        (await window.electron.dbGetCategories(id, 'movies'))
                            .length,
                    id
                )
            )
            .toBeGreaterThan(0);
        await app.electronApp.evaluate(() =>
            (
                globalThis as typeof globalThis & {
                    releaseCatalogSave?: () => void;
                }
            ).releaseCatalogSave!()
        );
        await expect(dialog).not.toBeVisible();
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    async (id) =>
                        (await window.electron.dbGetContent(id, 'movie'))
                            .length,
                    id
                )
            )
            .toBe(20000);
        expect(
            await app.electronApp.evaluate(
                () =>
                    (
                        globalThis as typeof globalThis & {
                            catalogDeletes: number;
                        }
                    ).catalogDeletes
            )
        ).toBe(1);
        expect(catalogActions(recorder.actions)).toEqual([
            'get_vod_categories',
            'get_vod_streams',
        ]);
        await expect(playlistSwitcherTitle(page)).toHaveText(renamed);
        expect(new URL(page.url()).pathname).toMatch(/\/vod(?:\/|$)/);
    } finally {
        await app.electronApp
            .evaluate(() =>
                (
                    globalThis as typeof globalThis & {
                        releaseCatalogSave?: () => void;
                    }
                ).releaseCatalogSave?.()
            )
            .catch(() => undefined);
        await closeElectronApp(app);
        await recorder.close();
        await server.close();
    }
});
