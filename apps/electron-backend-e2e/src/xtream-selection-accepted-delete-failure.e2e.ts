import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    saveSourceDialog,
    sourceRowByTitle,
    test,
    waitForSourceRowIdle,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

test('accepted connection changes cannot reuse retained catalogs when deletion fails before the worker', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const previous = await recordCatalogRequests();
    const current = await recordCatalogRequests();
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Synthetic accepted deletion failure';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: previous.url,
            username: 'performance',
            password: 'performance',
            contentTypes: ['movie'],
        });
        const id = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!._id,
            title
        );
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) =>
                            window.electron.dbGetAppState(
                                `xtream-import-status:${id}:movie`
                            ),
                        id
                    ),
                { timeout: 60000 }
            )
            .toBe('completed');
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        const retained = await page.evaluate(async (id) => {
            const [row] = await window.electron.dbGetContent(id, 'movie');
            if (!row) throw new Error('Missing synthetic retained Movie');
            await window.electron.dbAddRecentItem(row.id, id);
            return { xtreamId: row.xtream_id, contentId: row.id };
        }, id);
        let editor = await openSourceEditor(page, title);
        await editor
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        await saveSourceDialog(page, editor);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        editor = await openSourceEditor(page, title);
        await editor.locator('[formcontrolname="serverUrl"]').fill(current.url);
        await editor
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();

        await page.evaluate(() => {
            const state = globalThis as typeof globalThis & {
                preWorkerDeleteEvents: number;
            };
            state.preWorkerDeleteEvents = 0;
            const subscribe = window.electron.onDbOperationEvent;
            if (!subscribe)
                throw new Error(
                    'Native operation events are required for this regression'
                );
            subscribe((event) => {
                if (event.operation === 'delete-xtream-content')
                    state.preWorkerDeleteEvents++;
            });
        });
        await app.electronApp.evaluate(({ ipcMain }, id) => {
            type Handler = (...args: unknown[]) => Promise<unknown>;
            const handlers = (
                ipcMain as typeof ipcMain & {
                    _invokeHandlers: Map<string, Handler>;
                }
            )._invokeHandlers;
            const original = handlers.get('DB_DELETE_XTREAM_CONTENT')!;
            const state = globalThis as typeof globalThis & {
                preWorkerFlushRejected?: boolean;
            };
            ipcMain.removeHandler('DB_DELETE_XTREAM_CONTENT');
            ipcMain.handle(
                'DB_DELETE_XTREAM_CONTENT',
                async (event, playlistId, ...args) => {
                    if (playlistId !== id || state.preWorkerFlushRejected)
                        return original(event, playlistId, ...args);
                    const session = event.sender.session;
                    const flush = session.flushStorageData;
                    session.flushStorageData = () => {
                        state.preWorkerFlushRejected = true;
                        throw new Error(
                            'Synthetic pre-worker storage flush failure'
                        );
                    };
                    try {
                        // Call the real handler: its first flush fails before it can
                        // enqueue any delete or reset an import status in SQLite.
                        return await original(event, playlistId, ...args);
                    } finally {
                        session.flushStorageData = flush;
                    }
                }
            );
        }, id);
        const releaseScan = current.hold('get_vod_streams');
        await editor
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        try {
            await expect
                .poll(() => current.actions.includes('get_vod_streams'), {
                    timeout: 60000,
                })
                .toBe(true);
            await expect(
                editor.locator('.workspace-loading-overlay')
            ).toBeVisible();
        } finally {
            releaseScan();
        }
        await expect(
            editor.locator('.workspace-loading-overlay')
        ).not.toBeVisible({ timeout: 60000 });
        await expect(
            editor.getByRole('button', { name: 'Close', exact: true })
        ).toBeEnabled();
        expect(
            await app.electronApp.evaluate(
                () =>
                    (
                        globalThis as typeof globalThis & {
                            preWorkerFlushRejected?: boolean;
                        }
                    ).preWorkerFlushRejected
            )
        ).toBe(true);
        expect(
            await page.evaluate(
                () =>
                    (
                        globalThis as typeof globalThis & {
                            preWorkerDeleteEvents: number;
                        }
                    ).preWorkerDeleteEvents
            )
        ).toBe(0);
        const failed = await page.evaluate(
            async ({ id, xtreamId, currentUrl }) => {
                const metadata = await window.electron.dbGetAppPlaylist(id);
                return {
                    acceptedConnection: metadata?.serverUrl === currentUrl,
                    selected: metadata?.xtreamContentTypes,
                    status: await window.electron.dbGetAppState(
                        `xtream-import-status:${id}:movie`
                    ),
                    retainedRow:
                        (
                            await window.electron.dbGetContentByXtreamId(
                                xtreamId,
                                id,
                                'movie'
                            )
                        )?.id ?? null,
                    pending: !!localStorage.getItem(`xtream-restore-${id}`),
                    journal: !!(await window.electron.dbGetAppState(
                        `xtream-history-recovery:${id}`
                    )),
                };
            },
            { id, xtreamId: retained.xtreamId, currentUrl: current.url }
        );
        expect(failed.acceptedConnection).toBe(true);
        expect(failed.selected).toContain('movie');
        expect(failed.status).not.toBe('completed');
        expect(failed.retainedRow).toBeNull();
        expect(failed.pending).toBe(true);
        expect(failed.journal).toBe(true);
        await editor
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        await page.waitForSelector('mat-dialog-container', {
            state: 'detached',
        });
        const beforeRetry = current.actions.filter(
            (action) => action === 'get_vod_streams'
        ).length;
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) =>
                            window.electron.dbGetAppState(
                                `xtream-import-status:${id}:movie`
                            ),
                        id
                    ),
                { timeout: 60000 }
            )
            .toBe('completed');
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) => localStorage.getItem(`xtream-restore-${id}`),
                        id
                    ),
                { timeout: 60000 }
            )
            .toBeNull();
        expect(
            current.actions.filter((action) => action === 'get_vod_streams')
                .length
        ).toBeGreaterThan(beforeRetry);
        const restored = await page.evaluate(
            async ({ id, xtreamId }) => ({
                contentId: (
                    await window.electron.dbGetContentByXtreamId(
                        xtreamId,
                        id,
                        'movie'
                    )
                )?.id,
                watched: (
                    await window.electron.dbGetRecentItems(id, { all: true })
                ).some(
                    (row) => row.type === 'movie' && row.xtream_id === xtreamId
                ),
            }),
            { id, xtreamId: retained.xtreamId }
        );
        expect(restored.contentId).not.toBe(retained.contentId);
        expect(restored.watched).toBe(true);
    } finally {
        await closeElectronApp(app);
        await previous.close();
        await current.close();
    }
});
