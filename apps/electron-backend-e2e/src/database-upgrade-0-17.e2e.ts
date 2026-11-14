import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    sourceRowByTitle,
    test,
    workspaceRoot,
    type LaunchedElectronApp,
} from './electron-test-fixtures';

const sourceTitle = 'Synthetic 0.17 source';

/**
 * Writes a synthetic 0.17.1 profile next to the live database, using the
 * running app's Electron-built better-sqlite3, so the next launch upgrades it.
 */
async function writeLegacyDatabase(app: LaunchedElectronApp, file: string) {
    const schema = await readFile(
        join(
            workspaceRoot,
            'libs/shared/database/src/lib/testing/fixtures/v0.17.1-schema.sql'
        ),
        'utf8'
    );
    await app.electronApp.evaluate(
        (_electron, { dependency, file, schema, sourceTitle }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.exec(schema);
                db.prepare(
                    'INSERT INTO playlists (id, name, type, serverUrl, username, password) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(
                    'legacy-0-17',
                    sourceTitle,
                    'xtream',
                    'http://localhost:9',
                    'synthetic-user',
                    'synthetic-password'
                );
                db.exec(`INSERT INTO categories (id, playlist_id, name, type, xtream_id)
                    VALUES (1, 'legacy-0-17', 'Synthetic movies', 'movies', 3);
                    INSERT INTO content (id, category_id, title, xtream_id, type)
                    VALUES (1, 1, 'Synthetic film', 11, 'movie');
                    INSERT INTO favorites (content_id, playlist_id) VALUES (1, 'legacy-0-17');
                    INSERT INTO recently_viewed (content_id, playlist_id) VALUES (1, 'legacy-0-17');`);
            } finally {
                db.close();
            }
        },
        {
            dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
            file,
            schema,
            sourceTitle,
        }
    );
}

async function readUpgradedRows(app: LaunchedElectronApp, file: string) {
    return app.electronApp.evaluate(
        (_electron, { dependency, file }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file, { readonly: true });
            try {
                return {
                    hidden: db
                        .prepare('SELECT hidden FROM categories WHERE id = 1')
                        .get(),
                    favorites: db
                        .prepare(
                            "SELECT COUNT(*) AS count FROM favorites WHERE playlist_id = 'legacy-0-17'"
                        )
                        .get(),
                    recent: db
                        .prepare(
                            "SELECT COUNT(*) AS count FROM recently_viewed WHERE playlist_id = 'legacy-0-17'"
                        )
                        .get(),
                    index: db
                        .prepare(
                            "SELECT name FROM sqlite_master WHERE name = 'idx_categories_visible'"
                        )
                        .get(),
                };
            } finally {
                db.close();
            }
        },
        {
            dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
            file,
        }
    );
}

test('@electron @persistence opens a library upgraded straight from 0.17', async ({
    dataDir,
}) => {
    test.setTimeout(90_000);
    const databases = join(dataDir, 'databases');
    const live = join(databases, 'iptvnator.db');
    const legacy = join(databases, 'legacy-0-17.db');
    let app: LaunchedElectronApp | undefined = await launchElectronApp(dataDir);
    try {
        await writeLegacyDatabase(app, legacy);
        await closeElectronApp(app);
        app = undefined;
        // Replace the current-schema profile with the 0.17 one.
        await Promise.all(
            ['', '-wal', '-shm'].map((suffix) =>
                rm(live + suffix, { force: true })
            )
        );
        await rename(legacy, live);

        for (let startup = 0; startup < 2; startup++) {
            app = await launchElectronApp(dataDir);
            await openSources(app.mainWindow);
            await expect(
                sourceRowByTitle(app.mainWindow, sourceTitle)
            ).toBeVisible();
            expect(await readUpgradedRows(app, live)).toEqual({
                hidden: { hidden: 0 },
                favorites: { count: 1 },
                recent: { count: 1 },
                index: { name: 'idx_categories_visible' },
            });
            await closeElectronApp(app);
            app = undefined;
        }
    } finally {
        if (app) await closeElectronApp(app);
    }
});
