import type BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    EpgDatabase,
    EpgDatabaseClearOperation,
    EpgDatabaseSourceClearOperation,
} from './epg-database';
import type { ParsedChannel } from './epg-streaming-parser';

const e2eDataDirectoryEnv = 'IPTVNATOR_E2E_DATA_DIR';
let dataDirectory: string;
let previousDataDirectory: string | undefined;

beforeAll(() => {
    previousDataDirectory = process.env[e2eDataDirectoryEnv];
    dataDirectory = mkdtempSync(join(tmpdir(), 'iptvnator-epg-db-test-'));
    process.env[e2eDataDirectoryEnv] = dataDirectory;
});

afterAll(() => {
    if (previousDataDirectory === undefined) {
        delete process.env[e2eDataDirectoryEnv];
    } else {
        process.env[e2eDataDirectoryEnv] = previousDataDirectory;
    }
    rmSync(dataDirectory, { recursive: true, force: true });
});

function createDatabaseMock(exec: jest.Mock) {
    const database = {
        close: jest.fn(),
        exec,
        pragma: jest.fn(),
    };
    const Database = jest.fn(() => database) as unknown as typeof BetterSqlite3;

    return { Database, database };
}

function normalizeSql(sql: unknown): string {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createEpgDatabaseMock(
    options: {
        /** Result of the sqlite_master index-existence probe. */
        dedupIndexExists?: boolean;
        /** Make the CREATE UNIQUE INDEX statement throw on run(). */
        failIndexCreation?: boolean;
    } = {}
) {
    const statements = new Map<string, jest.Mock>();
    const prepare = jest.fn((statement: string) => {
        const normalized = normalizeSql(statement);
        const run = jest.fn(() => {
            if (
                options.failIndexCreation &&
                normalized.startsWith('CREATE UNIQUE INDEX')
            ) {
                throw new Error('UNIQUE constraint failed');
            }
        });
        const get = jest.fn(() =>
            options.dedupIndexExists ? { 1: 1 } : undefined
        );
        statements.set(normalized, run);
        return { run, get };
    });
    const transaction = jest.fn((callback: (rows: unknown[]) => void) => {
        return (rows: unknown[]) => callback(rows);
    });
    const database = {
        close: jest.fn(),
        pragma: jest.fn(),
        prepare,
        transaction,
    };
    const Database = jest.fn(() => database) as unknown as typeof BetterSqlite3;

    return { Database, database, statements };
}

describe('EpgDatabase', () => {
    it('refreshes a source selectively, keeping the recent past-programme archive', () => {
        const sourceUrl = 'https://example.com/playlist-guide.xml';
        const { Database, database, statements } = createEpgDatabaseMock();
        const epgDb = new EpgDatabase(Database);

        const channels: ParsedChannel[] = [
            {
                id: 'shared.channel',
                displayName: [{ lang: '', value: 'Shared Channel' }],
                icon: [],
                url: [],
            },
        ];

        epgDb.insertChannels(channels, sourceUrl, true);

        const preparedSql = database.prepare.mock.calls.map(([sql]) =>
            normalizeSql(sql)
        );
        const deleteTodayAndFutureSql = normalizeSql(`
            DELETE FROM epg_programs
            WHERE source_url = ?
              AND (start >= date('now') OR start < date('now', '-7 days'))
        `);
        const deleteOrphanChannelsSql = normalizeSql(`
            DELETE FROM epg_channels
            WHERE source_url = ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM epg_programs
                  WHERE epg_programs.channel_id = epg_channels.id
              )
        `);

        expect(preparedSql).toContain(deleteTodayAndFutureSql);
        expect(preparedSql).toContain(deleteOrphanChannelsSql);
        // A refresh must not wipe the whole source: the last 7 days of
        // programmes stay behind so catch-up remains browsable (#1138),
        // and other sources' shared channels must not cascade away.
        expect(preparedSql).not.toContain(
            'DELETE FROM epg_programs WHERE source_url = ?'
        );
        expect(preparedSql).not.toContain(
            'DELETE FROM epg_channels WHERE source_url = ?'
        );
        expect(statements.get(deleteTodayAndFutureSql)).toHaveBeenCalledWith(
            sourceUrl
        );
        expect(statements.get(deleteOrphanChannelsSql)).toHaveBeenCalledWith(
            sourceUrl
        );
    });

    it('does not overwrite a shared channel source URL when another EPG source reuses the same channel ID', () => {
        const { Database, database } = createEpgDatabaseMock();

        new EpgDatabase(Database);

        const insertChannelSql = database.prepare.mock.calls
            .map(([sql]) => normalizeSql(sql))
            .find((sql) => sql.startsWith('INSERT INTO epg_channels'));

        expect(insertChannelSql).toBeDefined();
        expect(insertChannelSql).not.toContain(
            'source_url = excluded.source_url'
        );
    });

    it('removes pre-existing duplicate programs before creating the dedup index', () => {
        const { Database, database, statements } = createEpgDatabaseMock();

        new EpgDatabase(Database);

        const preparedSql = database.prepare.mock.calls.map(([sql]) =>
            normalizeSql(sql)
        );
        const dedupDeleteSql = preparedSql.find((sql) =>
            sql.startsWith('DELETE FROM epg_programs WHERE id NOT IN')
        );
        const createIndexSql = preparedSql.find((sql) =>
            sql.startsWith('CREATE UNIQUE INDEX idx_epg_programs_dedup_v2')
        );
        const dropOldIndexSql = preparedSql.find((sql) =>
            sql.startsWith('DROP INDEX IF EXISTS idx_epg_programs_dedup')
        );

        expect(dedupDeleteSql).toBeDefined();
        expect(createIndexSql).toBeDefined();
        expect(dropOldIndexSql).toBeDefined();
        expect(statements.get(dedupDeleteSql!)).toHaveBeenCalled();
        expect(statements.get(createIndexSql!)).toHaveBeenCalled();
        expect(statements.get(dropOldIndexSql!)).toHaveBeenCalled();

        // The dedup key and index are source-aware so programmes imported
        // from different EPG sources are not collapsed.
        expect(dedupDeleteSql).toContain(
            'GROUP BY channel_id, start, title, source_url'
        );
        expect(createIndexSql).toContain(
            'epg_programs(channel_id, start, title, source_url)'
        );

        const insertProgramSql = preparedSql.find((sql) =>
            sql.startsWith('INSERT INTO epg_programs')
        );
        expect(insertProgramSql).toContain(
            'ON CONFLICT(channel_id, start, title, source_url) DO UPDATE SET'
        );
        expect(insertProgramSql).not.toContain(
            'source_url = excluded.source_url'
        );
    });

    it('skips the dedup pass when the index already exists', () => {
        const { Database, database } = createEpgDatabaseMock({
            dedupIndexExists: true,
        });

        new EpgDatabase(Database);

        const preparedSql = database.prepare.mock.calls.map(([sql]) =>
            normalizeSql(sql)
        );
        expect(
            preparedSql.some((sql) =>
                sql.startsWith('DELETE FROM epg_programs WHERE id NOT IN')
            )
        ).toBe(false);
        expect(
            preparedSql.some((sql) => sql.startsWith('CREATE UNIQUE INDEX'))
        ).toBe(false);

        const insertProgramSql = preparedSql.find((sql) =>
            sql.startsWith('INSERT INTO epg_programs')
        );
        expect(insertProgramSql).toContain(
            'ON CONFLICT(channel_id, start, title, source_url) DO UPDATE SET'
        );
    });

    it('falls back to plain inserts when index creation fails', () => {
        const { Database, database } = createEpgDatabaseMock({
            failIndexCreation: true,
        });

        expect(() => new EpgDatabase(Database)).not.toThrow();

        const preparedSql = database.prepare.mock.calls.map(([sql]) =>
            normalizeSql(sql)
        );
        const insertProgramSql = preparedSql.find((sql) =>
            sql.startsWith('INSERT INTO epg_programs')
        );
        expect(insertProgramSql).toBeDefined();
        expect(insertProgramSql).not.toContain('ON CONFLICT');
    });
});

describe('EpgDatabaseClearOperation', () => {
    it('clears programs and channels in one transaction', () => {
        const exec = jest.fn();
        const { Database, database } = createDatabaseMock(exec);

        new EpgDatabaseClearOperation(Database).run();

        expect(database.pragma).toHaveBeenCalledWith('busy_timeout = 5000');
        expect(exec.mock.calls.map(([statement]) => statement)).toEqual([
            'BEGIN',
            'DELETE FROM epg_programs',
            'DELETE FROM epg_channels',
            'COMMIT',
        ]);
    });

    it('rolls back when either delete fails', () => {
        const failure = new Error('database is busy');
        const exec = jest.fn((statement: string) => {
            if (statement === 'DELETE FROM epg_channels') {
                throw failure;
            }
        });
        const { Database } = createDatabaseMock(exec);

        expect(() => new EpgDatabaseClearOperation(Database).run()).toThrow(
            failure
        );
        expect(exec.mock.calls.map(([statement]) => statement)).toEqual([
            'BEGIN',
            'DELETE FROM epg_programs',
            'DELETE FROM epg_channels',
            'ROLLBACK',
        ]);
    });
});

describe('EpgDatabaseSourceClearOperation', () => {
    it('clears programs for one source and prunes only orphan channels from that source', () => {
        const sourceUrl = 'https://playlist.example.com/guide.xml';
        const { Database, database, statements } = createEpgDatabaseMock();

        new EpgDatabaseSourceClearOperation(Database).run(sourceUrl);

        const preparedSql = database.prepare.mock.calls.map(([sql]) =>
            normalizeSql(sql)
        );
        const deleteProgramsSql =
            'DELETE FROM epg_programs WHERE source_url = ?';
        const deleteOrphanChannelsSql = normalizeSql(`
            DELETE FROM epg_channels
            WHERE source_url = ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM epg_programs
                  WHERE epg_programs.channel_id = epg_channels.id
              )
        `);

        expect(preparedSql).toContain(deleteProgramsSql);
        expect(preparedSql).toContain(deleteOrphanChannelsSql);
        expect(preparedSql).not.toContain(
            'DELETE FROM epg_channels WHERE source_url = ?'
        );
        expect(statements.get(deleteProgramsSql)).toHaveBeenCalledWith(
            sourceUrl
        );
        expect(statements.get(deleteOrphanChannelsSql)).toHaveBeenCalledWith(
            sourceUrl
        );
    });
});
