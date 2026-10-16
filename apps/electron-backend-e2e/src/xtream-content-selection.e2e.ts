import { createServer } from 'node:http';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    saveSourceDialog,
    refreshSource,
    test,
    xtreamMockServer,
    restartElectronApp,
} from './electron-test-fixtures';

/** Observe real main-process API requests without recording credentials. */
async function recordCatalogRequests() {
    const actions: string[] = [];
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? '/', xtreamMockServer);
            const action = url.searchParams.get('action');
            if (action) actions.push(action);
            const upstream = await fetch(url);
            response.writeHead(upstream.status, {
                'Content-Type': 'application/json',
            });
            response.end(await upstream.text());
        } catch {
            response.writeHead(502).end();
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('No local mock port');
    return {
        actions,
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            ),
    };
}

const catalogActions = (actions: string[]) =>
    actions.filter((action) =>
        /^(get_(live|vod|series)_categories|get_live_streams|get_vod_streams|get_series)$/.test(
            action
        )
    );

test('desktop imports Live only, immediately enables Movies, and preserves an all-disabled source', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    try {
        await addXtreamPortal(page, {
            name: 'Selective Xtream',
            serverUrl: recorder.url,
            contentTypes: ['live'],
        });
        await expect
            .poll(() => recorder.actions.includes('get_live_streams'))
            .toBeTruthy();
        await expect
            .poll(() =>
                page.evaluate(async () => {
                    const playlist = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((item) => item.title === 'Selective Xtream');
                    return playlist
                        ? window.electron.dbGetAppState(
                              `xtream-import-status:${playlist._id}:live`
                          )
                        : null;
                })
            )
            .toBe('completed');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        expect([...new Set(catalogActions(recorder.actions))].sort()).toEqual([
            'get_live_categories',
            'get_live_streams',
        ]);

        await openSources(page);
        let dialog = await openSourceEditor(page, 'Selective Xtream');
        await expect(
            dialog.getByTestId('xtream-load-live').getByRole('checkbox')
        ).toBeChecked();
        await expect(
            dialog.getByTestId('xtream-load-movie').getByRole('checkbox')
        ).not.toBeChecked();
        recorder.actions.length = 0;
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await saveSourceDialog(page, dialog);
        expect(catalogActions(recorder.actions)).toEqual([
            'get_vod_categories',
            'get_vod_streams',
        ]);

        const savedMovie = await page.evaluate(async () => {
            const playlist = (await window.electron.dbGetAppPlaylists()).find(
                (item) => item.title === 'Selective Xtream'
            );
            if (!playlist) throw new Error('Source missing');
            const movie = (
                await window.electron.dbGetContent(playlist._id, 'movie')
            )[0];
            if (!movie) throw new Error('Movie import missing');
            await window.electron.dbAddFavorite(movie.id, playlist._id);
            await window.electron.dbAddRecentItem(movie.id, playlist._id);
            return { playlistId: playlist._id, xtreamId: movie.xtream_id };
        });
        dialog = await openSourceEditor(page, 'Selective Xtream');
        await dialog
            .getByTestId('xtream-load-live')
            .getByRole('checkbox')
            .uncheck();
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        recorder.actions.length = 0;
        await saveSourceDialog(page, dialog);
        expect(catalogActions(recorder.actions)).toEqual([]);
        const stored = await page.evaluate(async () =>
            (await window.electron.dbGetAppPlaylists()).find(
                (playlist) => playlist.title === 'Selective Xtream'
            )
        );
        expect(stored?.xtreamContentTypes).toEqual([]);

        await refreshSource(page, 'Selective Xtream', { confirm: true });
        await page.waitForURL(/\/workspace\/xtreams\//);
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        expect(catalogActions(recorder.actions)).toEqual([]);
        expect(
            await page.evaluate(
                async ({ playlistId, xtreamId }) => ({
                    favorite: (
                        await window.electron.dbGetFavorites(playlistId)
                    ).some((row) => row.xtream_id === xtreamId),
                    recent: (
                        await window.electron.dbGetRecentItems(playlistId)
                    ).some((row) => row.xtream_id === xtreamId),
                    resolvable: Boolean(
                        await window.electron.dbGetContentByXtreamId(
                            xtreamId,
                            playlistId,
                            'movie'
                        )
                    ),
                }),
                savedMovie
            )
        ).toEqual({ favorite: true, recent: true, resolvable: true });
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await openSources(page);
        dialog = await openSourceEditor(page, 'Selective Xtream');
        for (const type of ['live', 'movie', 'series']) {
            await expect(
                dialog.getByTestId(`xtream-load-${type}`).getByRole('checkbox')
            ).not.toBeChecked();
        }
        expect(catalogActions(recorder.actions)).toEqual([]);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
