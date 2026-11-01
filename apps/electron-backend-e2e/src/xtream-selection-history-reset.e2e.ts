import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    refreshSource,
    saveSourceDialog,
    restartElectronApp,
    sourceRowByTitle,
    test,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

async function faultRecoveryReset(
    app: LaunchedElectronApp,
    dataDir: string,
    playlistId: string,
    enabled: boolean
) {
    await app.electronApp.evaluate(
        (_electron, { dependency, file, playlistId, enabled }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.exec('DROP TRIGGER IF EXISTS test_fail_history_reset');
                if (enabled) {
                    const literal = playlistId.replaceAll("'", "''");
                    db.exec(`CREATE TRIGGER test_fail_history_reset BEFORE INSERT ON app_state
                        WHEN NEW.key = 'xtream-history-recovery:${literal}' AND NEW.value = ''
                        BEGIN SELECT RAISE(ABORT, 'simulated journal reset failure'); END`);
                }
            } finally {
                db.close();
            }
        },
        {
            dependency: join(__dirname, '../../../node_modules/better-sqlite3'),
            file: join(dataDir, 'databases/iptvnator.db'),
            playlistId,
            enabled,
        }
    );
}

test('explicit backup retry resets a journal left by an interrupted cache recovery', async ({
    dataDir,
}) => {
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    const title = 'Explicit backup journal reset';
    try {
        await addXtreamPortal(page, {
            name: title,
            contentTypes: ['live', 'movie'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const row = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    if (!row) return false;
                    return (
                        await Promise.all(
                            ['live', 'movie'].map((type) =>
                                window.electron.dbGetAppState(
                                    `xtream-import-status:${row._id}:${type}`
                                )
                            )
                        )
                    ).every((status) => status === 'completed');
                }, title)
            )
            .toBe(true);
        const seeded = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            )!;
            const [movie] = await window.electron.dbGetContent(
                source._id,
                'movie'
            );
            const [live] = await window.electron.dbGetContent(
                source._id,
                'live'
            );
            if (!movie || !live) throw new Error('Fixture needs both catalogs');
            const key = `xtream-history-recovery:${source._id}`;
            await window.electron.dbAddRecentItem(live.id, source._id);
            await window.electron.dbSetAppState(
                key,
                JSON.stringify({
                    version: 1,
                    contentTypes: ['live', 'movie', 'series'],
                    recentlyViewed: [
                        {
                            contentType: 'live',
                            xtreamId: live.xtream_id,
                            viewedAt: '2026-01-01',
                        },
                    ],
                })
            );
            // Explicit import parks this archive before attempting the reset.
            localStorage.setItem(
                `xtream-restore-${source._id}`,
                JSON.stringify({
                    favorites: [],
                    favoritesRestoreId: 'explicit-reset-regression',
                    hiddenCategories: [],
                    playbackPositions: [],
                    recentlyViewed: [
                        {
                            contentType: 'movie',
                            xtreamId: movie.xtream_id,
                            viewedAt: '2026-02-01',
                        },
                    ],
                })
            );
            return { id: source._id, movie: movie.xtream_id, key };
        }, title);
        await faultRecoveryReset(app, dataDir, seeded.id, true);
        const rejected = await page.evaluate(async (key) => {
            try {
                await window.electron.dbSetAppState(key, '');
                return false;
            } catch {
                return true;
            }
        }, seeded.key);
        await faultRecoveryReset(app, dataDir, seeded.id, false);
        expect(rejected).toBe(true);
        expect(
            await page.evaluate(
                (key) => window.electron.dbGetAppState(key),
                seeded.key
            )
        ).toBeTruthy();
        app = await restartElectronApp(app, dataDir);
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
            (id) => window.electron.dbGetRecentItems(id, { all: true }),
            seeded.id
        );
        expect(history.map((row) => `${row.type}:${row.xtream_id}`)).toEqual([
            `movie:${seeded.movie}`,
        ]);
        expect(history[0].viewed_at).toBe('2026-02-01');
        expect(
            await page.evaluate(
                (key) => window.electron.dbGetAppState(key),
                seeded.key
            )
        ).toBe('');
    } finally {
        await closeElectronApp(app);
    }
});

test('ordinary selective refresh retry preserves history and progress changed after failure', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    const title = 'Ordinary selective recovery';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            contentTypes: ['movie', 'live'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const row = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    if (!row) return false;
                    return (
                        await Promise.all(
                            ['live', 'movie'].map((type) =>
                                window.electron.dbGetAppState(
                                    `xtream-import-status:${row._id}:${type}`
                                )
                            )
                        )
                    ).every((status) => status === 'completed');
                }, title)
            )
            .toBe(true);
        const saved = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            )!;
            const live = (
                await window.electron.dbGetContent(source._id, 'live')
            ).slice(0, 4);
            const [movie] = await window.electron.dbGetContent(
                source._id,
                'movie'
            );
            if (live.length < 4 || !movie)
                throw new Error('Missing fixture content');
            for (const row of [...live.slice(0, 3), movie])
                await window.electron.dbAddRecentItem(row.id, source._id);
            await window.electron.dbSavePlaybackPosition(source._id, {
                contentXtreamId: movie.xtream_id,
                contentType: 'vod',
                positionSeconds: 9,
            });
            return { id: source._id, live, movie };
        }, title);
        await openSources(page);
        const dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-live')
            .getByRole('checkbox')
            .uncheck();
        await saveSourceDialog(page, dialog);
        const recover = recorder.fail('get_vod_streams');
        await refreshSource(page, title, { confirm: true });
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) =>
                            window.electron.dbGetAppState(
                                `xtream-import-status:${id}:movie`
                            ),
                        saved.id
                    ),
                { timeout: 30000 }
            )
            .toBe('failed');
        await page.evaluate(async ({ id, live, movie }) => {
            await window.electron.dbAddRecentItem(live[0].id, id);
            await window.electron.dbAddRecentItem(live[3].id, id);
            await window.electron.dbRemoveRecentItem(live[1].id, id);
            await window.electron.dbRemoveRecentItemsBatch([
                { playlistId: id, contentId: live[2].id },
            ]);
            await window.electron.dbSavePlaybackPosition(id, {
                contentXtreamId: movie.xtream_id,
                contentType: 'vod',
                positionSeconds: 22,
            });
            const [category] = await window.electron.dbGetAllCategories(
                id,
                'live'
            );
            await window.electron.dbUpdateCategoryVisibility(
                [category.id],
                true
            );
        }, saved);
        recover();
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) => localStorage.getItem(`xtream-restore-${id}`),
                        saved.id
                    ),
                { timeout: 30000 }
            )
            .toBeNull();
        const history = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id, { all: true }),
            saved.id
        );
        expect(
            history.map((row) => `${row.type}:${row.xtream_id}`).sort()
        ).toEqual(
            [
                `live:${saved.live[0].xtream_id}`,
                `live:${saved.live[3].xtream_id}`,
                `movie:${saved.movie.xtream_id}`,
            ].sort()
        );
        expect(
            (
                await page.evaluate(
                    (id) => window.electron.dbGetAllPlaybackPositions(id),
                    saved.id
                )
            )[0].positionSeconds
        ).toBe(22);
        expect(
            (
                await page.evaluate(
                    (id) => window.electron.dbGetAllCategories(id, 'live'),
                    saved.id
                )
            )[0].hidden
        ).toBe(true);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
