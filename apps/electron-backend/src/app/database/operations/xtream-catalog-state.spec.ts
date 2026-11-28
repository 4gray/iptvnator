import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDbMock } from './operations.test-helpers';
import { updatePlaylist } from './playlist.operations';
import { completeXtreamStartupRefresh } from './xtream-catalog-state';

const condition = {
    playlistId: 'synthetic-source',
    serverUrl: 'https://portal.example.test',
    username: 'synthetic-user',
    password: 'synthetic-password',
    previousUpdateDate: null,
};
const current = {
    id: condition.playlistId,
    type: 'xtream',
    serverUrl: condition.serverUrl,
    username: condition.username,
    password: condition.password,
    autoRefresh: true,
    updateDate: null,
    lastUpdated: null,
    payload: JSON.stringify({ xtreamContentTypes: ['live'] }),
};
const updatedAt = '2026-01-01T00:00:00.000Z';
const timestamp = Date.parse(updatedAt);

it('completes the live catalog and updates only the date columns in the same transaction', async () => {
    const { db, transaction, updateRun, updateSet, insertValues, insertRun } =
        createDbMock([[current], [current]]);
    await expect(
        updatePlaylist(
            db,
            condition.playlistId,
            { updateDate: timestamp, autoRefresh: false },
            condition
        )
    ).resolves.toEqual({ success: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({
        updateDate: timestamp,
        lastUpdated: updatedAt,
    });
    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith({
        key: 'xtream-import-status:synthetic-source:live',
        value: 'completed',
        updatedAt,
    });
    expect(insertRun).toHaveBeenCalledTimes(1);
});

it('compares the old projected date when a legacy source only has lastUpdated', () => {
    const lastUpdated = '2025-12-31T00:00:00.000Z';
    const legacy = {
        ...current,
        autoRefresh: null,
        lastUpdated,
        payload: JSON.stringify({ autoRefresh: true }),
    };
    const { db } = createDbMock([[legacy], [legacy]]);
    expect(
        completeXtreamStartupRefresh(db, timestamp, {
            ...condition,
            previousUpdateDate: Date.parse(lastUpdated),
        })
    ).toEqual({ success: true });
});

it.each([
    { ...current, password: 'synthetic-changed' },
    { ...current, autoRefresh: false },
    { ...current, updateDate: timestamp + 1 },
    { ...current, payload: JSON.stringify({ xtreamContentTypes: ['movie'] }) },
])(
    'does not complete the catalog or update its date when a source setting no longer matches',
    (row) => {
        const { db, updateRun, insertRun } = createDbMock([[row], [row]]);
        expect(completeXtreamStartupRefresh(db, timestamp, condition)).toEqual({
            success: false,
        });
        expect(updateRun).not.toHaveBeenCalled();
        expect(insertRun).not.toHaveBeenCalled();
    }
);

it('declines a condition addressed to a different source', async () => {
    const { db, transaction } = createDbMock();
    await expect(
        updatePlaylist(
            db,
            'synthetic-other',
            { updateDate: timestamp },
            condition
        )
    ).resolves.toEqual({ success: false });
    expect(transaction).not.toHaveBeenCalled();
});

it('rejects an invalid timestamp before opening a transaction', () => {
    const { db, transaction } = createDbMock();
    expect(() => completeXtreamStartupRefresh(db, NaN, condition)).toThrow(
        'Invalid Xtream refresh timestamp'
    );
    expect(transaction).not.toHaveBeenCalled();
});
it('commits the catalog and timestamp together in SQLite', () => {
    const operation = pathToFileURL(
        resolve(__dirname, 'xtream-catalog-state.ts')
    ).href;
    const connection = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connection)});
        const { completeXtreamStartupRefresh } = await import(${JSON.stringify(operation)});
        const sqlite = new Database(':memory:');
        for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
            try { sqlite.exec(statement); }
            catch (error) { if (!String(error).includes('duplicate column name')) throw error; }
        }
        const db = drizzle(sqlite, { schema });
        const source = ${JSON.stringify({ ...current, name: 'Synthetic source' })};
        const condition = ${JSON.stringify(condition)};
        const timestamp = ${timestamp};
        const key = 'xtream-import-status:synthetic-source:live';
        db.insert(schema.playlists).values({ ...source, password: 'changed-synthetic-password' }).run();
        db.insert(schema.appState).values({ key, value: 'importing', updatedAt: source.lastUpdated ?? '2025-12-31' }).run();
        const read = () => ({
            date: db.select().from(schema.playlists).get().updateDate,
            status: db.select().from(schema.appState).get().value,
        });
        const rejected = !completeXtreamStartupRefresh(db, timestamp, condition).success;
        const afterSourceChange = read();
        db.update(schema.playlists).set({ password: source.password }).run();
        sqlite.exec("CREATE TRIGGER fail_state BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'Synthetic state write failure'); END");
        let failedWrite = false;
        try { completeXtreamStartupRefresh(db, timestamp, condition); }
        catch (error) { failedWrite = String(error).includes('Synthetic state write failure'); }
        const afterFailedWrite = read();
        sqlite.exec('DROP TRIGGER fail_state');
        const committed = completeXtreamStartupRefresh(db, timestamp, condition).success;
        console.log(JSON.stringify({ rejected, afterSourceChange, failedWrite, afterFailedWrite, committed, afterCommit: read() }));
        sqlite.close();
    `;
    const result = JSON.parse(
        execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        )
    );
    expect(result).toEqual({
        rejected: true,
        afterSourceChange: { date: null, status: 'importing' },
        failedWrite: true,
        afterFailedWrite: { date: null, status: 'importing' },
        committed: true,
        afterCommit: { date: timestamp, status: 'completed' },
    });
});
