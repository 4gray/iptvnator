import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    saveSourceDialog,
    test,
    xtreamMockServer,
    waitForSourceRowIdle,
} from './electron-test-fixtures';
import { terminateElectronProcess } from './electron-process-termination';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

for (const scope of ['source', 'global'] as const)
    test(`${scope} history clear survives a crash with dormant Series and no active journal`, async ({
        dataDir,
        request,
    }) => {
        const response = await request.get(
            `${xtreamMockServer}/player_api.php?username=user1&password=pass1&action=get_series`
        );
        const [series] = (await response.json()) as { series_id: number }[];
        if (!series) throw new Error('Fixture needs dormant Series');
        const recorder = await recordCatalogRequests();
        let app = await launchElectronApp(dataDir);
        let page = app.mainWindow;
        const title = `Crash after ${scope} history clear`;
        try {
            await addXtreamPortal(page, {
                name: title,
                serverUrl: recorder.url,
                contentTypes: ['live'],
            });
            await expect
                .poll(() =>
                    page.evaluate(async (title) => {
                        const source = (
                            await window.electron.dbGetAppPlaylists()
                        ).find((row) => row.title === title);
                        return source
                            ? window.electron.dbGetAppState(
                                  `xtream-import-status:${source._id}:live`
                              )
                            : null;
                    }, title)
                )
                .toBe('completed');
            const id = await page.evaluate(
                async ({ title, seriesId }) => {
                    const source = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title)!;
                    const [live] = await window.electron.dbGetContent(
                        source._id,
                        'live'
                    );
                    if (!live) throw new Error('Fixture needs retained Live');
                    await window.electron.dbAddRecentItem(live.id, source._id);
                    localStorage.setItem(
                        `xtream-catalog-restore-${source._id}`,
                        JSON.stringify({
                            version: 1,
                            generation: 'settled-selective-backup',
                            favorites: [],
                            playbackPositions: [],
                            hiddenCategories: [
                                { categoryType: 'series', xtreamId: 99 },
                            ],
                            recentlyViewed: [
                                {
                                    contentType: 'series',
                                    xtreamId: seriesId,
                                    viewedAt: '2026-01-01T00:00:00.000Z',
                                },
                            ],
                        })
                    );
                    return source._id;
                },
                { title, seriesId: Number(series.series_id) }
            );
            expect(
                await page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-history-recovery:${id}`
                        ),
                    id
                )
            ).toBeNull();
            expect(
                await page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    id
                )
            ).toBeNull();
            // Persist the settled archive first, then stop immediately after
            // the user's native clear commits, before its UI reply is delivered.
            await app.electronApp.evaluate(
                ({ BrowserWindow, ipcMain }, scope) => {
                    BrowserWindow.getAllWindows()[0].webContents.session.flushStorageData();
                    const channel =
                        scope === 'source'
                            ? 'DB_CLEAR_PLAYLIST_RECENT_ITEMS'
                            : 'DB_CLEAR_RECENTLY_VIEWED';
                    type Handler = (
                        event: Electron.IpcMainInvokeEvent,
                        ...args: unknown[]
                    ) => Promise<unknown>;
                    const handlers = (
                        ipcMain as typeof ipcMain & {
                            _invokeHandlers: Map<string, Handler>;
                        }
                    )._invokeHandlers;
                    const original = handlers.get(channel);
                    if (!original)
                        throw new Error('Missing history clear handler');
                    ipcMain.removeHandler(channel);
                    ipcMain.handle(channel, async (event, ...args) => {
                        await original(event, ...args);
                        (
                            globalThis as typeof globalThis & {
                                historyClearCommitted?: boolean;
                            }
                        ).historyClearCommitted = true;
                        return new Promise(() => undefined);
                    });
                },
                scope
            );
            // DatabaseService's source/global clear updates dormant history
            // before invoking this bridge (covered by its service units).
            // Exercise that native durability boundary without an active journal.
            await page.evaluate(
                ({ id, scope }) => {
                    const key = `xtream-catalog-restore-${id}`;
                    const state = JSON.parse(localStorage.getItem(key)!);
                    localStorage.setItem(
                        key,
                        JSON.stringify({ ...state, recentlyViewed: [] })
                    );
                    const clear =
                        scope === 'source'
                            ? window.electron.dbClearPlaylistRecentItems(id)
                            : window.electron.dbClearRecentlyViewed();
                    void clear.catch(() => undefined);
                },
                { id, scope }
            );
            await expect
                .poll(() =>
                    app.electronApp.evaluate(
                        () =>
                            (
                                globalThis as typeof globalThis & {
                                    historyClearCommitted?: boolean;
                                }
                            ).historyClearCommitted
                    )
                )
                .toBe(true);
            const current = await page.evaluate(
                (id) =>
                    JSON.parse(
                        localStorage.getItem(`xtream-catalog-restore-${id}`)!
                    ),
                id
            );
            expect(current.recentlyViewed).toEqual([]);
            const child = app.electronApp.process();
            const exited = new Promise<void>((resolve) =>
                child.once('exit', () => resolve())
            );
            terminateElectronProcess(child, 'SIGKILL');
            await exited;
            await closeElectronApp(app);
            app = await launchElectronApp(dataDir);
            page = app.mainWindow;
            const dormant = await page.evaluate(
                (id) =>
                    JSON.parse(
                        localStorage.getItem(`xtream-catalog-restore-${id}`)!
                    ),
                id
            );
            expect(dormant.recentlyViewed).toEqual([]);
            expect(dormant.hiddenCategories).toEqual([
                { categoryType: 'series', xtreamId: 99 },
            ]);
            await openSources(page);
            await waitForSourceRowIdle(page, title);
            const editor = await openSourceEditor(page, title);
            await editor
                .getByTestId('xtream-load-series')
                .getByRole('checkbox')
                .check();
            await saveSourceDialog(page, editor);
            const history = await page.evaluate(
                (id) => window.electron.dbGetRecentItems(id, { all: true }),
                id
            );
            expect(history).toEqual([]);
        } finally {
            await closeElectronApp(app);
            await recorder.close();
        }
    });
