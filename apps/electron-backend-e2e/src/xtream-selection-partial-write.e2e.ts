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
import { recordCatalogRequests } from './xtream-selection.e2e-support';

async function faultAndCount(
    app: LaunchedElectronApp,
    dataDir: string,
    id: string,
    enabled: boolean
) {
    return app.electronApp.evaluate(
        (_electron, { dependency, file, id, enabled }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.exec('DROP TRIGGER IF EXISTS test_fail_movie_second_batch');
                if (enabled) {
                    const literal = id.replaceAll("'", "''");
                    db.exec(`CREATE TRIGGER test_fail_movie_second_batch BEFORE INSERT ON content
                    WHEN (SELECT playlist_id FROM categories WHERE id = NEW.category_id) = '${literal}' AND NEW.type = 'movie'
                    AND (SELECT count(*) FROM content c JOIN categories g ON c.category_id = g.id WHERE g.playlist_id = '${literal}' AND c.type = 'movie') >= 5000
                    BEGIN SELECT RAISE(ABORT, 'simulated second transaction failure'); END`);
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
        }
    );
}

test('interrupted catalog writes restart from an empty cache and restore history beyond the committed batch', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const response = await request.get(
        `${xtreamMockServer}/player_api.php?username=performance&password=performance&action=get_vod_streams`
    );
    const streams = (await response.json()) as { stream_id: number }[];
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
        await page.evaluate(
            ({ id, xtreamId }) =>
                localStorage.setItem(
                    `xtream-catalog-restore-${id}`,
                    JSON.stringify({
                        version: 1,
                        favorites: [],
                        playbackPositions: [],
                        hiddenCategories: [],
                        recentlyViewed: [
                            {
                                contentType: 'movie',
                                xtreamId,
                                viewedAt: '2026-01-01T00:00:00.000Z',
                            },
                        ],
                    })
                ),
            { id, xtreamId: Number(target.stream_id) }
        );
        await faultAndCount(app, dataDir, id, true);
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
            .poll(() => recorder.actions.includes('get_vod_streams'))
            .toBe(true);
        await expect(
            dialog.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
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
        expect(await faultAndCount(app, dataDir, id, false)).toBe(0);
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
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
