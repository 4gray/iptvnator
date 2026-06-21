import type BetterSqlite3 from 'better-sqlite3';
import {
    EpgDatabase,
    EpgDatabaseClearOperation,
    EpgDatabaseSourceClearOperation,
} from './epg-database';
import type { ParsedChannel } from './epg-streaming-parser';

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

function createEpgDatabaseMock() {
    const statements = new Map<string, jest.Mock>();
    const prepare = jest.fn((statement: string) => {
        const run = jest.fn();
        statements.set(normalizeSql(statement), run);
        return { run };
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
    it('refreshes a source without cascading shared channel programs from other sources', () => {
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
