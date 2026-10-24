import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    openSourceEditor,
    restartElectronApp,
    saveSourceDialog,
    sourceRowByTitle,
    test,
} from './electron-test-fixtures';
import {
    fetchXtreamLiveFixture,
    fetchXtreamSeriesFixture,
    fetchXtreamVodFixture,
} from './portal-mock-fixtures';
import {
    catalogActions,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

test('fresh selective backup restore retains dormant history and hidden categories until each type is enabled', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    const [live, movie, series] = await Promise.all([
        fetchXtreamLiveFixture(request),
        fetchXtreamVodFixture(request),
        fetchXtreamSeriesFixture(request),
    ]);
    const history = [
        {
            contentType: 'live' as const,
            xtreamId: Number(live.items[0].stream_id),
            viewedAt: '2026-01-01T00:00:00.000Z',
        },
        {
            contentType: 'movie' as const,
            xtreamId: Number(movie.items[0].stream_id),
            viewedAt: '2026-01-02T00:00:00.000Z',
        },
        {
            contentType: 'series' as const,
            xtreamId: Number(series.items[0].series_id),
            viewedAt: '2026-01-03T00:00:00.000Z',
        },
    ];
    const hidden = [
        { categoryType: 'movies' as const, xtreamId: Number(movie.categoryId) },
        {
            categoryType: 'series' as const,
            xtreamId: Number(series.categoryId),
        },
    ];
    const title = 'Fresh selective backup';
    const entry: XtreamPlaylistBackupEntry = {
        portalType: 'xtream',
        exportedId: 'fresh-selective',
        title,
        autoRefresh: false,
        connection: {
            serverUrl: recorder.url,
            username: 'minimal',
            password: 'minimal',
        },
        xtreamContentTypes: ['live'],
        userState: {
            favorites: [],
            recentlyViewed: history,
            hiddenCategories: hidden,
            playbackPositions: [
                {
                    contentType: 'vod',
                    contentXtreamId: history[1].xtreamId,
                    positionSeconds: 9,
                    durationSeconds: 120,
                },
            ],
        },
    };
    const archive: PlaylistBackupManifestV1 = {
        kind: 'iptvnator-playlist-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        includeSecrets: true,
        playlists: [entry],
    };
    const input = join(dataDir, 'selective-input.json');
    const output = join(dataDir, 'selective-reexport.json');
    writeFileSync(input, JSON.stringify(archive));
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    try {
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        const chooser = page.waitForEvent('filechooser');
        await page
            .locator('#backup')
            .getByRole('button', { name: 'Import', exact: true })
            .click();
        await (await chooser).setFiles(input);
        await expect(
            page.getByText(/Backup import finished: 1 imported/)
        ).toBeVisible();
        const playlistId = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )?._id,
            title
        );
        if (!playlistId) throw new Error('Backup source missing');
        expect(
            await page.evaluate(
                (id) => window.electron.dbHasContent(id, 'movie'),
                playlistId
            )
        ).toBe(false);
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-import-status:${id}:live`
                        ),
                    playlistId
                )
            )
            .toBe('completed');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    playlistId
                )
            )
            .toBeNull();
        expect(catalogActions(recorder.actions)).toEqual([
            'get_live_categories',
            'get_live_streams',
        ]);

        // A normal startup must not consume the only copy of disabled types' data.
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await app.electronApp.evaluate(({ dialog }, path) => {
            dialog.showSaveDialog = async () => ({
                canceled: false,
                filePath: path,
            });
        }, output);
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        await page
            .locator('#backup')
            .getByRole('button', { name: 'Export', exact: true })
            .click();
        await expect(page.getByText('Playlist backup exported.')).toBeVisible();
        const exported = (
            JSON.parse(readFileSync(output, 'utf8')) as PlaylistBackupManifestV1
        ).playlists.find(
            (row) => row.portalType === 'xtream'
        ) as XtreamPlaylistBackupEntry;
        expect(exported.userState.recentlyViewed).toEqual(
            expect.arrayContaining(history)
        );
        expect(exported.userState.hiddenCategories).toEqual(
            expect.arrayContaining(hidden)
        );

        // Later replay must not reset user progress to the original archive's 9 seconds.
        await page.evaluate(
            ({ id, xtreamId }) =>
                window.electron.dbSavePlaybackPosition(id, {
                    contentType: 'vod',
                    contentXtreamId: xtreamId,
                    positionSeconds: 22,
                    durationSeconds: 120,
                }),
            { id: playlistId, xtreamId: history[1].xtreamId }
        );
        for (const next of [
            {
                type: 'movie',
                category: 'movies',
                count: 2,
                actions: ['get_vod_categories', 'get_vod_streams'],
            },
            {
                type: 'series',
                category: 'series',
                count: 3,
                actions: ['get_series_categories', 'get_series'],
            },
        ]) {
            await openSources(page);
            const dialog = await openSourceEditor(page, title);
            await dialog
                .getByTestId(`xtream-load-${next.type}`)
                .getByRole('checkbox')
                .check();
            recorder.actions.length = 0;
            await saveSourceDialog(page, dialog);
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            expect(catalogActions(recorder.actions)).toEqual(next.actions);
            const state = await page.evaluate(
                async ({ id, type, xtreamId }) => ({
                    history: (await window.electron.dbGetRecentItems(id)).map(
                        (row) => ({
                            contentType: row.type,
                            xtreamId: row.xtream_id,
                        })
                    ),
                    categories: await window.electron.dbGetAllCategories(
                        id,
                        type
                    ),
                    position: await window.electron.dbGetPlaybackPosition(
                        id,
                        xtreamId,
                        'vod'
                    ),
                }),
                {
                    id: playlistId,
                    type: next.category as 'movies' | 'series',
                    xtreamId: history[1].xtreamId,
                }
            );
            expect(state.history).toHaveLength(next.count);
            expect(state.history).toEqual(
                expect.arrayContaining(
                    history
                        .slice(0, next.count)
                        .map(({ contentType, xtreamId }) => ({
                            contentType,
                            xtreamId,
                        }))
                )
            );
            expect(state.categories).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        xtream_id:
                            next.type === 'movie'
                                ? hidden[0].xtreamId
                                : hidden[1].xtreamId,
                        hidden: expect.anything(),
                    }),
                ])
            );
            expect(
                state.categories.find(
                    (row) =>
                        row.xtream_id ===
                        (next.type === 'movie'
                            ? hidden[0].xtreamId
                            : hidden[1].xtreamId)
                )?.hidden
            ).toBeTruthy();
            expect(state.position?.positionSeconds).toBe(22);
        }
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
