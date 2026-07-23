import type Database from 'better-sqlite3';
import { __databaseConnectionTestHooks } from '@iptvnator/shared/database';

function statementContaining(pattern: string): string {
    const statement =
        __databaseConnectionTestHooks.createTableStatements.find((entry) =>
            entry.includes(pattern)
        ) ??
        __databaseConnectionTestHooks.indexMigrationStatements.find((entry) =>
            entry.includes(pattern)
        ) ??
        __databaseConnectionTestHooks.columnMigrationStatements.find((entry) =>
            entry.includes(pattern)
        );

    if (!statement) {
        throw new Error(`Expected database statement containing "${pattern}"`);
    }

    return statement;
}

describe('database connection schema', () => {
    it('creates fresh Xtream cache tables with the unique targets used by IPC writes', () => {
        expect(
            statementContaining('CREATE TABLE IF NOT EXISTS categories')
        ).toContain('UNIQUE(playlist_id, type, xtream_id)');
        expect(
            statementContaining('CREATE TABLE IF NOT EXISTS content')
        ).toContain('UNIQUE(category_id, type, xtream_id)');
    });

    it('creates the favorites position index only after the position migration can run', () => {
        expect(
            statementContaining('CREATE TABLE IF NOT EXISTS favorites')
        ).toContain('position INTEGER DEFAULT 0');
        expect(
            __databaseConnectionTestHooks.createTableStatements.some((entry) =>
                entry.includes('favorites_playlist_position_idx')
            )
        ).toBe(false);
        expect(
            statementContaining('ALTER TABLE favorites ADD COLUMN position')
        ).toBe('ALTER TABLE favorites ADD COLUMN position INTEGER DEFAULT 0');
        expect(
            statementContaining('favorites_playlist_position_idx')
        ).toContain(
            'CREATE INDEX IF NOT EXISTS favorites_playlist_position_idx'
        );
    });

    it('creates the provider-neutral recordings table and scheduler indexes', () => {
        const table = statementContaining(
            'CREATE TABLE IF NOT EXISTS recordings'
        );

        expect(table).toContain(
            "source_type TEXT NOT NULL CHECK (source_type IN ('xtream', 'stalker', 'm3u'))"
        );
        expect(table).toContain('scheduled_start_at TEXT NOT NULL');
        expect(table).toContain('scheduled_end_at TEXT NOT NULL');
        expect(table).toContain('stream_url TEXT,');
        expect(table).not.toContain('stream_url TEXT NOT NULL');
        expect(table).toContain(
            'padding_before_seconds INTEGER NOT NULL DEFAULT 0'
        );
        expect(table).toContain(
            'padding_after_seconds INTEGER NOT NULL DEFAULT 0'
        );
        expect(table).toContain(
            "status TEXT NOT NULL DEFAULT 'scheduled' CHECK"
        );
        expect(table).not.toContain('FOREIGN KEY');
        expect(statementContaining('recordings_playlist_idx')).toContain(
            'ON recordings(playlist_id)'
        );
        expect(statementContaining('recordings_status_start_idx')).toContain(
            'ON recordings(status, scheduled_start_at)'
        );
        expect(statementContaining('recordings_completed_idx')).toContain(
            'ON recordings(completed_at)'
        );
    });

    it('migrates pre-release recordings so cancel can clear the stream URL', () => {
        const exec = jest.fn();
        const all = jest.fn().mockReturnValue([
            { name: 'id', notnull: 0 },
            { name: 'stream_url', notnull: 1 },
        ]);
        const transaction = jest.fn((callback: () => void) => () => callback());
        const sqlite = {
            exec,
            prepare: jest.fn().mockReturnValue({ all }),
            transaction,
        } as unknown as Database.Database;

        __databaseConnectionTestHooks.relaxRecordingPlaybackSnapshotNullability(
            sqlite
        );

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(exec.mock.calls.map(([statement]) => statement)).toEqual(
            expect.arrayContaining([
                expect.stringContaining(
                    'ALTER TABLE recordings RENAME TO recordings_legacy_not_null_stream_url'
                ),
                __databaseConnectionTestHooks.recordingTableSql,
                expect.stringContaining(
                    'INSERT INTO recordings (id, playlist_id, source_type'
                ),
                expect.stringContaining(
                    'DROP TABLE recordings_legacy_not_null_stream_url'
                ),
                expect.stringContaining('recordings_playlist_idx'),
                expect.stringContaining('recordings_status_start_idx'),
                expect.stringContaining('recordings_completed_idx'),
            ])
        );

        exec.mockClear();
        all.mockReturnValue([
            { name: 'id', notnull: 0 },
            { name: 'stream_url', notnull: 0 },
        ]);
        __databaseConnectionTestHooks.relaxRecordingPlaybackSnapshotNullability(
            sqlite
        );
        expect(exec).not.toHaveBeenCalled();
    });
});
