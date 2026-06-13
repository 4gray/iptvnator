import type BetterSqlite3 from 'better-sqlite3';
import { EpgDatabaseClearOperation } from './epg-database';

function createDatabaseMock(exec: jest.Mock) {
    const database = {
        close: jest.fn(),
        exec,
        pragma: jest.fn(),
    };
    const Database = jest.fn(() => database) as unknown as typeof BetterSqlite3;

    return { Database, database };
}

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
