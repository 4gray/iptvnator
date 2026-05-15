import { __databaseConnectionTestHooks } from './connection';

function compactSql(statement: string): string {
    return statement.replace(/\s+/g, ' ').trim();
}

function createdObjectNames(prefix: string, statements: readonly string[]) {
    return statements
        .map(compactSql)
        .filter((statement) => statement.startsWith(prefix))
        .map((statement) => {
            const match = statement.match(
                /^(?:CREATE\s+(?:UNIQUE\s+)?(?:VIRTUAL\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS)\s+([^\s(]+)/i
            );
            return match?.[1] ?? null;
        })
        .filter((name): name is string => Boolean(name));
}

describe('database schema statements', () => {
    const {
        createTableStatements,
        columnMigrationStatements,
        indexMigrationStatements,
    } = __databaseConnectionTestHooks;

    it('defines the core fresh-install tables, indexes, and FTS triggers', () => {
        const schemaSql = createTableStatements.map(compactSql).join('\n');

        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS playlists');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS categories');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS content');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS epg_channels');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS epg_programs');
        expect(schemaSql).toContain(
            'CREATE VIRTUAL TABLE IF NOT EXISTS epg_programs_fts USING fts5'
        );
        expect(schemaSql).toContain(
            'CREATE TABLE IF NOT EXISTS playback_positions'
        );
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS downloads');
        expect(schemaSql).toContain(
            'CREATE UNIQUE INDEX IF NOT EXISTS favorites_content_playlist_unique'
        );
        expect(schemaSql).toContain(
            'CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_content_playlist_unique'
        );
        expect(schemaSql).toContain(
            'CREATE TRIGGER IF NOT EXISTS epg_programs_ai'
        );
        expect(schemaSql).toContain(
            'CREATE TRIGGER IF NOT EXISTS epg_programs_ad'
        );
        expect(schemaSql).toContain(
            'CREATE TRIGGER IF NOT EXISTS epg_programs_au'
        );
    });

    it('keeps legacy column migrations idempotent ALTER TABLE statements', () => {
        expect(columnMigrationStatements.length).toBeGreaterThan(0);
        expect(
            columnMigrationStatements
                .map(compactSql)
                .every((statement) => statement.startsWith('ALTER TABLE '))
        ).toBe(true);
        expect(columnMigrationStatements.map(compactSql)).toEqual(
            expect.arrayContaining([
                'ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0',
                'ALTER TABLE playlists ADD COLUMN payload TEXT',
                'ALTER TABLE favorites ADD COLUMN position INTEGER DEFAULT 0',
                'ALTER TABLE content ADD COLUMN backdrop_url TEXT',
            ])
        );
    });

    it('keeps legacy index migrations idempotent IF NOT EXISTS statements', () => {
        expect(indexMigrationStatements.length).toBeGreaterThan(0);
        expect(
            indexMigrationStatements
                .map(compactSql)
                .every((statement) =>
                    /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /i.test(statement)
                )
        ).toBe(true);
        expect(indexMigrationStatements.map(compactSql)).toEqual(
            expect.arrayContaining([
                'CREATE UNIQUE INDEX IF NOT EXISTS categories_playlist_type_xtream_unique ON categories(playlist_id, type, xtream_id)',
                'CREATE UNIQUE INDEX IF NOT EXISTS content_category_type_xtream_unique ON content(category_id, type, xtream_id)',
                'CREATE INDEX IF NOT EXISTS favorites_playlist_position_idx ON favorites(playlist_id, position, added_at DESC)',
            ])
        );
    });

    it('does not define duplicate fresh-install schema object names', () => {
        const objectNames = [
            ...createdObjectNames(
                'CREATE TABLE IF NOT EXISTS',
                createTableStatements
            ),
            ...createdObjectNames(
                'CREATE VIRTUAL TABLE IF NOT EXISTS',
                createTableStatements
            ),
            ...createdObjectNames(
                'CREATE INDEX IF NOT EXISTS',
                createTableStatements
            ),
            ...createdObjectNames(
                'CREATE UNIQUE INDEX IF NOT EXISTS',
                createTableStatements
            ),
            ...createdObjectNames(
                'CREATE TRIGGER IF NOT EXISTS',
                createTableStatements
            ),
        ];

        expect(objectNames).toHaveLength(new Set(objectNames).size);
    });
});
