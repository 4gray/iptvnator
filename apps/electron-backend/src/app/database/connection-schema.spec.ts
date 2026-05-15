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
        expect(statementContaining('CREATE TABLE IF NOT EXISTS categories')).toContain(
            'UNIQUE(playlist_id, type, xtream_id)'
        );
        expect(statementContaining('CREATE TABLE IF NOT EXISTS content')).toContain(
            'UNIQUE(category_id, type, xtream_id)'
        );
    });

    it('creates the favorites position index only after the position migration can run', () => {
        expect(statementContaining('CREATE TABLE IF NOT EXISTS favorites')).toContain(
            'position INTEGER DEFAULT 0'
        );
        expect(
            __databaseConnectionTestHooks.createTableStatements.some((entry) =>
                entry.includes('favorites_playlist_position_idx')
            )
        ).toBe(false);
        expect(statementContaining('ALTER TABLE favorites ADD COLUMN position')).toBe(
            'ALTER TABLE favorites ADD COLUMN position INTEGER DEFAULT 0'
        );
        expect(statementContaining('favorites_playlist_position_idx')).toContain(
            'CREATE INDEX IF NOT EXISTS favorites_playlist_position_idx'
        );
    });
});
