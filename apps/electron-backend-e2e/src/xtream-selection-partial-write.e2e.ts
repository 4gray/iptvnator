import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    restartElectronApp,
    sourceRowByTitle,
    test,
    xtreamMockServer,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    catalogActions,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

async function faultAndCount(
    app: LaunchedElectronApp,
    dataDir: string,
    id: string,
    enabled: boolean,
    failCleanup = false,
    failCompletion = false,
    resetHistory = true
) {
    return app.electronApp.evaluate(
        (
            _electron,
            {
                dependency,
                file,
                id,
                enabled,
                failCleanup,
                failCompletion,
                resetHistory,
            }
        ) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.exec('DROP TRIGGER IF EXISTS test_fail_movie_second_batch');
                db.exec('DROP TRIGGER IF EXISTS test_fail_movie_cleanup');
                db.exec('DROP TRIGGER IF EXISTS test_fail_movie_completion');
                if (enabled) {
                    if (resetHistory)
                        db.prepare(
                            'UPDATE recently_viewed SET viewed_at = ? WHERE playlist_id = ?'
                        ).run('2026-01-01 00:00:00', id);
                    const literal = id.replaceAll("'", "''");
                    if (failCompletion)
                        db.exec(`CREATE TRIGGER test_fail_movie_completion BEFORE INSERT ON app_state
                        WHEN NEW.key = 'xtream-import-status:${literal}:movie' AND NEW.value IN ('completed', 'failed')
                        BEGIN SELECT RAISE(ABORT, 'simulated completion status failure'); END`);
                    else
                        db.exec(`CREATE TRIGGER test_fail_movie_second_batch BEFORE INSERT ON content
                    WHEN (SELECT playlist_id FROM categories WHERE id = NEW.category_id) = '${literal}' AND NEW.type = 'movie'
                    AND (SELECT count(*) FROM content c JOIN categories g ON c.category_id = g.id WHERE g.playlist_id = '${literal}' AND c.type = 'movie') >= 5000
                    BEGIN SELECT RAISE(ABORT, 'simulated second transaction failure'); END`);
                    if (failCleanup)
                        db.exec(`CREATE TRIGGER test_fail_movie_cleanup BEFORE DELETE ON content
                        WHEN (SELECT playlist_id FROM categories WHERE id = OLD.category_id) = '${literal}' AND OLD.type = 'movie'
                        BEGIN SELECT RAISE(ABORT, 'simulated cleanup failure'); END`);
                }
                return db
                    .prepare(
                        "SELECT count(*) AS n FROM content c JOIN categories g ON c.category_id = g.id WHERE g.playlist_id = ? AND c.type = 'movie'"
                    )
                    .get(id).n as number;
            } finally {
                db.close();
            }
        },
        {
            dependency: join(__dirname, '../../../node_modules/better-sqlite3'),
            file: join(dataDir, 'databases/iptvnator.db'),
            id,
            enabled,
            failCleanup,
            failCompletion,
            resetHistory,
        }
    );
}

for (const { failCleanup, legacy, failCompletion } of [
    { failCleanup: false, legacy: false, failCompletion: false },
    { failCleanup: true, legacy: false, failCompletion: false },
    { failCleanup: false, legacy: true, failCompletion: false },
    { failCleanup: false, legacy: false, failCompletion: true },
])
    test(`interrupted catalog writes restore the full catalog and history (cleanup=${failCleanup}, legacy=${legacy}, completion=${failCompletion})`, async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120000);
        const response = await request.get(
            `${xtreamMockServer}/player_api.php?username=performance&password=performance&action=get_vod_streams`
        );
        const streams = (await response.json()) as {
            stream_id: number;
            category_id: string;
        }[];
        expect(streams.length).toBeGreaterThan(5000);
        const early = new Set(
            streams.slice(0, 5000).map((row) => Number(row.stream_id))
        );
        const target = streams
            .slice(5000)
            .find((row) => !early.has(Number(row.stream_id)));
        if (!target)
            throw new Error('Fixture needs a movie beyond the first batch');
        const recorder = await recordCatalogRequests();
        let app = await launchElectronApp(dataDir);
        let page = app.mainWindow;
        const title = 'Interrupted selective write';
        try {
            await addXtreamPortal(page, {
                name: title,
                serverUrl: recorder.url,
                username: 'performance',
                password: 'performance',
                contentTypes: [],
            });
            await openSources(page);
            const id = await page.evaluate(
                async (title) =>
                    (await window.electron.dbGetAppPlaylists()).find(
                        (row) => row.title === title
                    )!._id,
                title
            );
            const retained = await page.evaluate(async (id) => {
                await window.electron.dbSaveCategories(
                    id,
                    [
                        {
                            category_id: '900001',
                            category_name: 'Retained Live',
                            parent_id: 0,
                        },
                    ],
                    'live'
                );
                await window.electron.dbSaveContent(
                    id,
                    [881001, 881002, 881003, 881004].map((stream_id) => ({
                        stream_id,
                        name: `Retained ${stream_id}`,
                        category_id: '900001',
                        stream_type: 'live',
                    })),
                    'live'
                );
                await window.electron.dbSetAppState(
                    `xtream-import-status:${id}:live`,
                    'completed'
                );
                const rows = [];
                for (const xtreamId of [881001, 881002, 881003, 881004]) {
                    const row = await window.electron.dbGetContentByXtreamId(
                        xtreamId,
                        id,
                        'live'
                    );
                    if (!row) throw new Error('Missing retained content');
                    rows.push(row.id);
                }
                for (const contentId of rows.slice(0, 3))
                    await window.electron.dbAddRecentItem(contentId, id);
                return rows;
            }, id);
            if (legacy) {
                await page.evaluate(
                    async ({ id, categoryId }) => {
                        await window.electron.dbSaveCategories(
                            id,
                            [
                                {
                                    category_id: categoryId,
                                    category_name: 'Unfinished cached Movies',
                                    parent_id: 0,
                                },
                            ],
                            'movies'
                        );
                        await window.electron.dbSetAppState(
                            `xtream-import-status:${id}:movie`,
                            'failed'
                        );
                    },
                    { id, categoryId: String(target.category_id) }
                );
            }
            await page.evaluate(
                ({ id, xtreamId, hiddenCategories }) =>
                    localStorage.setItem(
                        `xtream-catalog-restore-${id}`,
                        JSON.stringify({
                            version: 1,
                            favorites: [],
                            playbackPositions: [],
                            hiddenCategories,
                            recentlyViewed: [
                                {
                                    contentType: 'movie',
                                    xtreamId,
                                    viewedAt: '2026-01-01T00:00:00.000Z',
                                },
                            ],
                        })
                    ),
                {
                    id,
                    xtreamId: Number(target.stream_id),
                    hiddenCategories: legacy
                        ? [
                              {
                                  categoryType: 'movies',
                                  xtreamId: Number(target.category_id),
                              },
                          ]
                        : [],
                }
            );
            await page.evaluate(
                async ({ id, xtreamId }) => {
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: xtreamId,
                        contentType: 'vod',
                        positionSeconds: 9,
                    });
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: 9999991,
                        contentType: 'vod',
                        positionSeconds: 79,
                    });
                },
                { id, xtreamId: Number(target.stream_id) }
            );
            await faultAndCount(
                app,
                dataDir,
                id,
                true,
                failCleanup,
                failCompletion
            );
            const dialog = await openSourceEditor(page, title);
            expect(catalogActions(recorder.actions)).toEqual([]);
            recorder.actions.length = 0;
            await dialog
                .getByTestId('xtream-load-movie')
                .getByRole('checkbox')
                .check();
            await dialog
                .locator('mat-dialog-actions')
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await expect(
                dialog.locator('.workspace-loading-overlay')
            ).toBeVisible();
            await expect
                .poll(() => recorder.actions.includes('get_vod_streams'))
                .toBe(true);
            await expect(
                dialog.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            await expect(
                dialog.getByRole('button', { name: 'Save', exact: true })
            ).toBeVisible();
            await expect(
                dialog.getByRole('button', { name: 'Save', exact: true })
            ).toBeEnabled();
            expect(
                await page.evaluate(
                    (id) => !!localStorage.getItem(`xtream-restore-${id}`),
                    id
                )
            ).toBe(true);
            // Disarm the fault before asserting, including on the red regression run.
            expect(await faultAndCount(app, dataDir, id, false)).toBe(
                failCleanup ? 5000 : 0
            );
            if (legacy) {
                // Persist the exact older shape: full pending history, no ownership
                // token and no native journal. Later actions affect SQLite only.
                await page.evaluate(async (id) => {
                    const key = `xtream-restore-${id}`;
                    const state = JSON.parse(localStorage.getItem(key)!);
                    const journal = JSON.parse(
                        (await window.electron.dbGetAppState(
                            `xtream-history-recovery:${id}`
                        ))!
                    );
                    state.recentlyViewed = journal.recentlyViewed;
                    delete state.catalogSnapshot;
                    localStorage.setItem(key, JSON.stringify(state));
                    const deferredKey = `xtream-catalog-restore-${id}`;
                    const deferred = JSON.parse(
                        localStorage.getItem(deferredKey)!
                    );
                    delete deferred.generation;
                    localStorage.setItem(deferredKey, JSON.stringify(deferred));
                    await window.electron.dbSetAppState(
                        `xtream-history-recovery:${id}`,
                        ''
                    );
                }, id);
            }
            await page.evaluate(
                async ({ id, retained }) => {
                    await window.electron.dbAddRecentItem(retained[0], id);
                    await window.electron.dbAddRecentItem(retained[3], id);
                    await window.electron.dbRemoveRecentItem(retained[1], id);
                    await window.electron.dbRemoveRecentItemsBatch([
                        { contentId: retained[2], playlistId: id },
                    ]);
                    const [category] = await window.electron.dbGetAllCategories(
                        id,
                        'live'
                    );
                    await window.electron.dbUpdateCategoryVisibility(
                        [category.id],
                        true
                    );
                },
                { id, retained }
            );
            // Playback can continue from saved items before import is retried.
            // Use the real playback persistence IPC, including another catalog
            // and an explicit removal after the recovery snapshot was parked.
            await page.evaluate(
                async ({ id, xtreamId }) => {
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: xtreamId,
                        contentType: 'vod',
                        positionSeconds: 22,
                    });
                    await window.electron.dbSavePlaybackPosition(id, {
                        contentXtreamId: 9999992,
                        contentType: 'episode',
                        positionSeconds: 31,
                    });
                    await window.electron.dbClearPlaybackPosition(
                        id,
                        9999991,
                        'vod'
                    );
                },
                { id, xtreamId: Number(target.stream_id) }
            );
            app = await restartElectronApp(app, dataDir);
            page = app.mainWindow;
            await openSources(page);
            if (failCompletion) {
                await faultAndCount(app, dataDir, id, true, false, true, false);
                await app.electronApp.evaluate(({ ipcMain }, id) => {
                    type Handler = (...args: unknown[]) => Promise<unknown>;
                    const handlers = (
                        ipcMain as typeof ipcMain & {
                            _invokeHandlers: Map<string, Handler>;
                        }
                    )._invokeHandlers;
                    const original = handlers.get('DB_SET_APP_STATE')!;
                    const state = globalThis as typeof globalThis & {
                        rejectedCompletion?: boolean;
                    };
                    ipcMain.removeHandler('DB_SET_APP_STATE');
                    ipcMain.handle(
                        'DB_SET_APP_STATE',
                        async (event, key, value) => {
                            try {
                                return await original(event, key, value);
                            } catch (error) {
                                if (
                                    key ===
                                        `xtream-import-status:${id}:movie` &&
                                    value === 'completed'
                                ) {
                                    state.rejectedCompletion = true;
                                }
                                throw error;
                            }
                        }
                    );
                }, id);
            }
            await sourceRowByTitle(page, title)
                .locator('.source-row__name')
                .click();
            if (failCompletion) {
                // Retry writes all native rows, but cannot acknowledge recovery
                // while its completion marker still fails in actual SQLite.
                await expect
                    .poll(
                        () =>
                            app.electronApp.evaluate(
                                () =>
                                    !!(
                                        globalThis as typeof globalThis & {
                                            rejectedCompletion?: boolean;
                                        }
                                    ).rejectedCompletion
                            ),
                        { timeout: 60000 }
                    )
                    .toBe(true);
                await expect(
                    page.locator('.workspace-loading-overlay')
                ).not.toBeVisible();
                await expect(
                    page.getByRole('button', { name: 'Retry', exact: true })
                ).toBeVisible();
                expect(
                    await page.evaluate(
                        (id) => !!localStorage.getItem(`xtream-restore-${id}`),
                        id
                    )
                ).toBe(true);
                expect(
                    await page.evaluate(
                        (id) =>
                            window.electron.dbGetAppState(
                                `xtream-history-recovery:${id}`
                            ),
                        id
                    )
                ).toBeTruthy();
                await faultAndCount(app, dataDir, id, false);
                await page
                    .getByRole('button', { name: 'Retry', exact: true })
                    .click();
            }
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
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            expect(await faultAndCount(app, dataDir, id, false)).toBe(
                streams.length
            );
            await expect
                .poll(() =>
                    page.evaluate(
                        (id) => localStorage.getItem(`xtream-restore-${id}`),
                        id
                    )
                )
                .toBeNull();
            expect(
                await page.evaluate(
                    async ({ id, xtreamId }) =>
                        (await window.electron.dbGetRecentItems(id)).some(
                            (row) => row.xtream_id === xtreamId
                        ),
                    { id, xtreamId: Number(target.stream_id) }
                )
            ).toBe(true);
            const history = await page.evaluate(
                (id) => window.electron.dbGetRecentItems(id, { all: true }),
                id
            );
            expect(history.map((row) => row.xtream_id).sort()).toEqual(
                [881001, 881004, Number(target.stream_id)].sort()
            );
            expect(
                history.find((row) => row.xtream_id === 881001)?.viewed_at
            ).not.toBe('2026-01-01 00:00:00');
            expect(
                await page.evaluate(
                    async (id) =>
                        (
                            await window.electron.dbGetAllCategories(id, 'live')
                        )[0].hidden,
                    id
                )
            ).toBe(true);
            if (legacy) {
                const movies = await page.evaluate(
                    (id) => window.electron.dbGetAllCategories(id, 'movies'),
                    id
                );
                expect(
                    movies.find(
                        (row) => row.xtream_id === Number(target.category_id)
                    )?.hidden
                ).toBe(true);
            }
            const positions = await page.evaluate(
                (id) => window.electron.dbGetAllPlaybackPositions(id),
                id
            );
            expect(positions).toHaveLength(2);
            expect(positions).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        contentXtreamId: Number(target.stream_id),
                        contentType: 'vod',
                        positionSeconds: 22,
                    }),
                    expect.objectContaining({
                        contentXtreamId: 9999992,
                        contentType: 'episode',
                        positionSeconds: 31,
                    }),
                ])
            );
        } finally {
            await closeElectronApp(app);
            await recorder.close();
        }
    });
