import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    test,
    waitForDbOperationEvent,
    waitForSourceRowIdle,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

async function rejectDeletionPreparation(
    app: LaunchedElectronApp,
    dataDir: string,
    id: string,
    enabled: boolean
) {
    await app.electronApp.evaluate(
        (_electron, { dependency, file, id, enabled }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.exec(
                    'DROP TRIGGER IF EXISTS test_fail_deletion_preparation'
                );
                if (enabled) {
                    const literal = id.replaceAll("'", "''");
                    db.exec(`CREATE TRIGGER test_fail_deletion_preparation BEFORE UPDATE OF value ON app_state
                    WHEN NEW.key = 'xtream-import-status:${literal}:movie' AND NEW.value = 'idle'
                    BEGIN SELECT RAISE(ABORT, 'simulated deletion preparation failure'); END`);
                }
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

test('failed native deletion preparation retains healthy cached catalog identities and history', async ({
    dataDir,
}) => {
    const recorder = await recordCatalogRequests();
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Retain healthy prepared catalog';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            contentTypes: ['movie'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const source = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    return source
                        ? window.electron.dbGetAppState(
                              `xtream-import-status:${source._id}:movie`
                          )
                        : null;
                }, title)
            )
            .toBe('completed');
        const seeded = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            )!;
            const content = await window.electron.dbGetContent(
                source._id,
                'movie'
            );
            if (!content.length) throw new Error('Fixture needs cached Movies');
            await window.electron.dbAddRecentItem(content[0].id, source._id);
            return {
                id: source._id,
                ids: content.map((row) => row.id),
                historyId: content[0].xtream_id,
            };
        }, title);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        let dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        await dialog
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect(dialog).not.toBeVisible();
        await rejectDeletionPreparation(app, dataDir, seeded.id, true);
        dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await dialog
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await waitForDbOperationEvent(page, {
            operation: 'delete-xtream-content',
            playlistId: seeded.id,
            status: 'error',
        });
        await expect(
            dialog.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await expect(
            dialog.getByRole('button', { name: 'Save', exact: true })
        ).toBeEnabled();
        await rejectDeletionPreparation(app, dataDir, seeded.id, false);
        expect(
            await page.evaluate(
                async (id) =>
                    (await window.electron.dbGetContent(id, 'movie')).map(
                        (row) => row.id
                    ),
                seeded.id
            )
        ).toEqual(seeded.ids);
        expect(
            await page.evaluate(
                (id) =>
                    window.electron.dbGetAppState(
                        `xtream-import-status:${id}:movie`
                    ),
                seeded.id
            )
        ).toBe('completed');
        const history = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id),
            seeded.id
        );
        expect(history.map((row) => row.xtream_id)).toContain(seeded.historyId);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
