import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    sourceRowByTitle,
    test,
    xtreamMockServer,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';
import { terminateElectronProcess } from './electron-process-termination';

test('process exit during selective catalog save retries every committed chunk and keeps history', async ({
    dataDir,
    request,
}) => {
    const response = await request.get(
        `${xtreamMockServer}/player_api.php?username=performance&password=performance&action=get_vod_streams`
    );
    const streams = (await response.json()) as { stream_id: number }[];
    expect(streams.length).toBeGreaterThan(5000);
    const target = Number(streams.at(-1)!.stream_id);
    const recorder = await recordCatalogRequests();
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    const title = 'Process exit recovery';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            username: 'performance',
            password: 'performance',
            contentTypes: [],
        });
        const id = await page.evaluate(
            async ({ title, target }) => {
                const source = (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!;
                localStorage.setItem(
                    `xtream-catalog-restore-${source._id}`,
                    JSON.stringify({
                        version: 1,
                        favorites: [],
                        playbackPositions: [],
                        hiddenCategories: [],
                        recentlyViewed: [
                            {
                                contentType: 'movie',
                                xtreamId: target,
                                viewedAt: '2026-01-01T00:00:00.000Z',
                            },
                        ],
                    })
                );
                return source._id;
            },
            { title, target }
        );
        // Commit a real first native batch, then hold the IPC reply so renderer
        // catch/finally cleanup cannot run before the process is killed.
        await app.electronApp.evaluate(({ ipcMain }, id) => {
            type Handler = (
                event: Electron.IpcMainInvokeEvent,
                playlistId: string,
                rows: Record<string, unknown>[],
                type: string,
                operationId?: string
            ) => Promise<unknown>;
            const handlers = (
                ipcMain as typeof ipcMain & {
                    _invokeHandlers: Map<string, Handler>;
                }
            )._invokeHandlers;
            const original = handlers.get('DB_SAVE_CONTENT');
            if (!original) throw new Error('Missing content save handler');
            ipcMain.removeHandler('DB_SAVE_CONTENT');
            ipcMain.handle(
                'DB_SAVE_CONTENT',
                async (event, playlistId, rows, type, operationId) => {
                    if (playlistId !== id || type !== 'movie')
                        return original(
                            event,
                            playlistId,
                            rows,
                            type,
                            operationId
                        );
                    await original(
                        event,
                        playlistId,
                        rows.slice(0, 5000),
                        type,
                        operationId
                    );
                    return new Promise(() => undefined);
                }
            );
        }, id);
        await openSources(page);
        const dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await dialog
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => window.electron.dbHasContent(id, 'movie'),
                    id
                )
            )
            .toBe(true);
        expect(
            await page.evaluate(
                async (id) =>
                    (await window.electron.dbGetContent(id, 'movie')).length,
                id
            )
        ).toBe(5000);
        expect(
            await page.evaluate(
                async ({ id, target }) => {
                    const journal = JSON.parse(
                        (await window.electron.dbGetAppState(
                            `xtream-history-recovery:${id}`
                        ))!
                    );
                    return journal.recentlyViewed.some(
                        (row: { xtreamId: number }) => row.xtreamId === target
                    );
                },
                { id, target }
            )
        ).toBe(true);
        expect(
            await page.evaluate(
                (id) => !!localStorage.getItem(`xtream-restore-${id}`),
                id
            )
        ).toBe(true);
        const child = app.electronApp.process();
        const exited = new Promise<void>((resolve) =>
            child.once('exit', () => resolve())
        );
        terminateElectronProcess(child, 'SIGKILL');
        await exited;
        await closeElectronApp(app);
        app = await launchElectronApp(dataDir);
        page = app.mainWindow;
        expect(
            await page.evaluate(
                (id) => !!localStorage.getItem(`xtream-restore-${id}`),
                id
            )
        ).toBe(true);
        await openSources(page);
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
        expect(
            await page.evaluate(
                async (id) =>
                    (await window.electron.dbGetContent(id, 'movie')).length,
                id
            )
        ).toBe(streams.length);
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    id
                )
            )
            .toBeNull();
        const history = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id),
            id
        );
        expect(history.some((row) => row.xtream_id === target)).toBe(true);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
