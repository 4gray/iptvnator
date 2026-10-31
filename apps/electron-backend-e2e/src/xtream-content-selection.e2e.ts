import {
    recordCatalogRequests,
    catalogActions,
} from './xtream-selection.e2e-support';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    sourceRowByTitle,
    openSourceEditor,
    saveSourceDialog,
    refreshSource,
    test,
    restartElectronApp,
} from './electron-test-fixtures';

test('desktop shows scanning for newly enabled Movies and Series and preserves an all-disabled source', async ({
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

        await expect(page).toHaveURL(/\/live(?:\?.*)?$/);
        await openSources(page);
        await sourceRowByTitle(page, 'Selective Xtream')
            .locator('.source-row__name')
            .click();
        await expect(page).toHaveURL(/\/live(?:\?.*)?$/);
        await openSources(page);
        let dialog = await openSourceEditor(page, 'Selective Xtream');
        await expect(
            dialog.locator('app-xtream-content-selection mat-checkbox')
        ).toHaveText(['Movies', 'Live TV', 'Series']);
        await expect(
            dialog.getByTestId('xtream-load-live').getByRole('checkbox')
        ).toBeChecked();
        await expect(
            dialog.getByTestId('xtream-load-movie').getByRole('checkbox')
        ).not.toBeChecked();
        await dialog
            .locator('[formcontrolname="userAgent"]')
            .fill('CatalogReview/1.0');
        for (const next of [
            {
                type: 'movie',
                label: 'Movies',
                categories: 'get_vod_categories',
                streams: 'get_vod_streams',
            },
            {
                type: 'series',
                label: 'Series',
                categories: 'get_series_categories',
                streams: 'get_series',
            },
        ]) {
            recorder.actions.length = 0;
            const release = recorder.hold(next.streams);
            await dialog
                .getByTestId(`xtream-load-${next.type}`)
                .getByRole('checkbox')
                .check();
            const saving = saveSourceDialog(page, dialog);
            try {
                const scanning = dialog.locator('.workspace-loading-overlay');
                await expect
                    .poll(() => recorder.actions.includes(next.streams))
                    .toBeTruthy();
                await expect(scanning).toBeVisible();
                await expect(page).toHaveURL(/\/workspace\/sources$/);
                await expect(
                    dialog.getByRole('heading', {
                        name: 'Syncing playlist',
                        exact: true,
                    })
                ).toBeVisible();
                await expect(
                    scanning.locator(
                        '.workspace-loading-overlay__badge--remote'
                    )
                ).toBeVisible();
                await expect(
                    scanning.locator(
                        '.workspace-loading-overlay__progress-copy'
                    )
                ).toContainText(next.label);
                await expect(
                    scanning.locator('mat-progress-bar')
                ).toHaveAttribute('mode', 'indeterminate');
            } finally {
                release();
                await saving;
            }
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            expect(catalogActions(recorder.actions)).toEqual([
                next.categories,
                next.streams,
            ]);
            expect(recorder.userAgents.get(next.categories)).toBe(
                'CatalogReview/1.0'
            );
            expect(recorder.userAgents.get(next.streams)).toBe(
                'CatalogReview/1.0'
            );
            await expect(page).toHaveURL(
                next.type === 'movie' ? /\/vod(?:\?.*)?$/ : /\/series(?:\?.*)?$/
            );
            await openSources(page);
            if (next.type === 'movie')
                dialog = await openSourceEditor(page, 'Selective Xtream');
        }

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
        await dialog
            .getByTestId('xtream-load-series')
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

        // Click Live before Movies to prove display priority, not click order,
        // chooses the section when several catalogs are newly enabled together.
        await dialog
            .getByTestId('xtream-load-live')
            .getByRole('checkbox')
            .check();
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        recorder.actions.length = 0;
        await saveSourceDialog(page, dialog);
        await expect(page).toHaveURL(/\/vod(?:\?.*)?$/);
        expect(catalogActions(recorder.actions)).toEqual([
            'get_vod_categories',
            'get_vod_streams',
            'get_live_categories',
            'get_live_streams',
        ]);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
