import { pathToFileURL } from 'node:url';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    packagedRendererIndexPath,
    sourceRowByTitle,
    test,
    xtreamMockServer,
} from './electron-test-fixtures';
import { terminateElectronProcess } from './electron-process-termination';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

test('crash after recovery acknowledgment cannot resurrect removed dormant history', async ({
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
    const title = 'Crash after recovery acknowledgment';
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
        await openSources(page);
        const seeded = await page.evaluate(
            async ({ title, seriesId }) => {
                const source = (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!;
                const [live] = await window.electron.dbGetContent(
                    source._id,
                    'live'
                );
                if (!live) throw new Error('Fixture needs retained Live');
                await window.electron.dbAddRecentItem(live.id, source._id);
                const recentlyViewed = [
                    {
                        contentType: 'live',
                        xtreamId: live.xtream_id,
                        viewedAt: '2026-01-01T00:00:00.000Z',
                    },
                    {
                        contentType: 'series',
                        xtreamId: seriesId,
                        viewedAt: '2026-01-01T00:00:00.000Z',
                    },
                ];
                const state = {
                    favorites: [],
                    playbackPositions: [],
                    hiddenCategories: [],
                    recentlyViewed,
                };
                const key = `xtream-catalog-restore-${source._id}`;
                const generation = 'ack-crash-owned-archive';
                localStorage.setItem(
                    key,
                    JSON.stringify({ version: 1, generation, ...state })
                );
                localStorage.setItem(
                    `xtream-restore-${source._id}`,
                    JSON.stringify({
                        ...state,
                        recentlyViewed: [],
                        preservePlaybackPositions: true,
                        catalogSnapshot: { key, generation },
                    })
                );
                await window.electron.dbSetAppState(
                    `xtream-history-recovery:${source._id}`,
                    JSON.stringify({
                        version: 1,
                        contentTypes: ['live', 'movie', 'series'],
                        recentlyViewed,
                    })
                );
                await window.electron.dbRemoveRecentItem(live.id, source._id);
                return { id: source._id, liveId: live.xtream_id, seriesId };
            },
            { title, seriesId: Number(series.series_id) }
        );
        // Establish the old archive on disk. The upcoming retry must persist
        // its resolved state before native tombstones are acknowledged.
        await app.electronApp.evaluate(({ BrowserWindow, ipcMain }, id) => {
            BrowserWindow.getAllWindows()[0].webContents.session.flushStorageData();
            type Handler = (
                event: Electron.IpcMainInvokeEvent,
                key: string,
                value: string,
                ...rest: unknown[]
            ) => Promise<unknown>;
            const handlers = (
                ipcMain as typeof ipcMain & {
                    _invokeHandlers: Map<string, Handler>;
                }
            )._invokeHandlers;
            const original = handlers.get('DB_SET_APP_STATE');
            if (!original) throw new Error('Missing app-state handler');
            ipcMain.removeHandler('DB_SET_APP_STATE');
            ipcMain.handle(
                'DB_SET_APP_STATE',
                async (event, key, value, ...rest) => {
                    const result = await original(event, key, value, ...rest);
                    if (
                        key === `xtream-history-recovery:${id}` &&
                        value === ''
                    ) {
                        (
                            globalThis as typeof globalThis & {
                                recoveryAcknowledged?: boolean;
                            }
                        ).recoveryAcknowledged = true;
                        // Keep the caller from consuming pending JSON before SIGKILL.
                        return new Promise(() => undefined);
                    }
                    return result;
                }
            );
        }, seeded.id);
        await page.goto(pathToFileURL(packagedRendererIndexPath).href);
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(() =>
                app.electronApp.evaluate(
                    () =>
                        (
                            globalThis as typeof globalThis & {
                                recoveryAcknowledged?: boolean;
                            }
                        ).recoveryAcknowledged
                )
            )
            .toBe(true);
        const current = await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem(`xtream-catalog-restore-${id}`)!
                ),
            seeded.id
        );
        expect(
            current.recentlyViewed.map(
                (row: { contentType: string }) => row.contentType
            )
        ).toEqual(['series']);
        const child = app.electronApp.process();
        const exited = new Promise<void>((resolve) =>
            child.once('exit', () => resolve())
        );
        terminateElectronProcess(child, 'SIGKILL');
        await exited;
        await closeElectronApp(app);
        app = await launchElectronApp(dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    seeded.id
                )
            )
            .toBeNull();
        const history = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id),
            seeded.id
        );
        expect(history.some((row) => row.xtream_id === seeded.liveId)).toBe(
            false
        );
        const dormant = await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem(`xtream-catalog-restore-${id}`)!
                ),
            seeded.id
        );
        expect(dormant.recentlyViewed).toEqual([
            expect.objectContaining({
                contentType: 'series',
                xtreamId: seeded.seriesId,
            }),
        ]);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
