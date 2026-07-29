import { __databaseConnectionTestHooks } from './connection';

const {
    columnMigrationStatements,
    createTables,
    createTableStatements,
    indexMigrationStatements,
    runMigrations,
    cleanupLegacyTmdbSearchCache,
    upgradeContentTitleFtsTokenizer,
    contentTitleFtsStatement,
} = __databaseConnectionTestHooks;

type SqliteHandle = Parameters<typeof runMigrations>[0];

function compactSql(statement: string): string {
    return statement.replace(/\s+/g, ' ').trim();
}

type StatementHandler = {
    all?: (...args: unknown[]) => unknown[];
    get?: (...args: unknown[]) => unknown;
    run?: jest.Mock;
};

type HandlerRule = [pattern: string, handler: StatementHandler];

function createSqliteMock(rules: HandlerRule[], exec: jest.Mock = jest.fn()) {
    const prepare = jest.fn((statement: string) => {
        const compact = compactSql(statement);
        const rule = rules.find(([pattern]) => compact.includes(pattern));

        return {
            all: jest.fn(() => []),
            get: jest.fn(),
            run: jest.fn(),
            ...(rule?.[1] ?? {}),
        };
    });
    const transaction = jest.fn(
        (callback: (...args: unknown[]) => unknown) => callback
    );

    return {
        exec,
        prepare,
        sqlite: { exec, prepare, transaction } as unknown as SqliteHandle,
        transaction,
    };
}

const completedMigrationStateRule: HandlerRule = [
    'SELECT value FROM app_state',
    { get: () => ({ value: 'done' }) },
];

describe('createTables', () => {
    it('executes every fresh-install statement against the connection in order', () => {
        const { exec, sqlite } = createSqliteMock([]);

        createTables(sqlite);

        expect(exec.mock.calls.map(([statement]) => statement)).toEqual([
            ...createTableStatements,
        ]);
    });
});

describe('runMigrations error tolerance', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('silently skips duplicate-column ALTER errors and still applies index migrations', () => {
        const exec = jest.fn((statement: string) => {
            if (compactSql(statement).startsWith('ALTER TABLE')) {
                throw new Error('duplicate column name: hidden');
            }
        });
        const { sqlite } = createSqliteMock(
            [completedMigrationStateRule],
            exec
        );

        runMigrations(sqlite);

        const executedStatements = exec.mock.calls.map(([statement]) =>
            compactSql(statement)
        );

        expect(executedStatements).toEqual([
            ...columnMigrationStatements.map(compactSql),
            ...indexMigrationStatements.map(compactSql),
        ]);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns and continues when a migration fails for another reason', () => {
        const failingStatement = compactSql(columnMigrationStatements[0]);
        const exec = jest.fn((statement: string) => {
            if (compactSql(statement) === failingStatement) {
                throw new Error('disk I/O error');
            }
        });
        const { sqlite } = createSqliteMock(
            [completedMigrationStateRule],
            exec
        );

        runMigrations(sqlite);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Migration failed (continuing)')
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('disk I/O error')
        );
        expect(exec).toHaveBeenCalledTimes(
            columnMigrationStatements.length + indexMigrationStatements.length
        );
    });
});

describe('TMDB search lookup v2 cache cleanup', () => {
    it('deletes legacy search rows and records the migration atomically', () => {
        const deleteRun = jest.fn();
        const markerRun = jest.fn();
        const { sqlite, transaction } = createSqliteMock([
            ['SELECT value FROM app_state', { get: () => undefined }],
            ['DELETE FROM tmdb_metadata', { run: deleteRun }],
            ['INSERT INTO app_state', { run: markerRun }],
        ]);

        cleanupLegacyTmdbSearchCache(sqlite);

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(deleteRun).toHaveBeenCalledTimes(1);
        expect(markerRun).toHaveBeenCalledWith(
            'migration:tmdb-search-lookup-v2-cache-cleanup:v1'
        );
        const deleteSql = compactSql(
            (sqlite.prepare as jest.Mock).mock.calls.find(([statement]) =>
                statement.includes('DELETE FROM tmdb_metadata')
            )?.[0]
        );
        expect(deleteSql).toContain(
            "lookup_key LIKE 'title:%|year:%' AND lookup_key NOT LIKE 'title:%|year:%|v%'"
        );
    });

    it('does nothing after the migration has completed', () => {
        const { sqlite, prepare, transaction } = createSqliteMock([
            completedMigrationStateRule,
        ]);

        cleanupLegacyTmdbSearchCache(sqlite);

        expect(transaction).not.toHaveBeenCalled();
        expect(prepare).toHaveBeenCalledTimes(1);
    });
});

describe('runMigrations Xtream cache deduplication', () => {
    it('re-points content to the canonical duplicate category before deleting the rest', () => {
        const candidatesAll = jest.fn(() => [
            { id: 1, hidden: 0, contentCount: 10 },
            { id: 2, hidden: 1, contentCount: 0 },
        ]);
        const updateContentRun = jest.fn();
        const deleteCategoryRun = jest.fn();
        const { sqlite } = createSqliteMock([
            completedMigrationStateRule,
            [
                'FROM categories GROUP BY playlist_id, type, xtream_id',
                {
                    all: () => [
                        { playlistId: 'p1', type: 'live', xtreamId: 5 },
                    ],
                },
            ],
            ['LEFT JOIN content', { all: candidatesAll }],
            [
                'UPDATE content SET category_id = ? WHERE category_id = ?',
                { run: updateContentRun },
            ],
            ['DELETE FROM categories WHERE id = ?', { run: deleteCategoryRun }],
            [
                'FROM content GROUP BY category_id, type, xtream_id',
                { all: () => [] },
            ],
        ]);

        runMigrations(sqlite);

        expect(candidatesAll).toHaveBeenCalledWith('p1', 'live', 5);
        expect(updateContentRun).toHaveBeenCalledTimes(1);
        expect(updateContentRun).toHaveBeenCalledWith(1, 2);
        expect(deleteCategoryRun).toHaveBeenCalledTimes(1);
        expect(deleteCategoryRun).toHaveBeenCalledWith(2);
    });

    it('moves favorites and history to the canonical content row before deleting duplicates', () => {
        const moveFavoritesRun = jest.fn();
        const deleteFavoritesRun = jest.fn();
        const moveRecentlyViewedRun = jest.fn();
        const deleteRecentlyViewedRun = jest.fn();
        const deleteContentRun = jest.fn();
        const { sqlite } = createSqliteMock([
            completedMigrationStateRule,
            [
                'FROM categories GROUP BY playlist_id, type, xtream_id',
                { all: () => [] },
            ],
            [
                'FROM content GROUP BY category_id, type, xtream_id',
                {
                    all: () => [
                        { categoryId: 7, type: 'movie', xtreamId: 300 },
                    ],
                },
            ],
            [
                'SELECT id FROM content WHERE category_id = ?',
                { all: () => [{ id: 10 }, { id: 11 }] },
            ],
            ['INSERT INTO favorites', { run: moveFavoritesRun }],
            [
                'DELETE FROM favorites WHERE content_id = ?',
                { run: deleteFavoritesRun },
            ],
            ['INSERT INTO recently_viewed', { run: moveRecentlyViewedRun }],
            [
                'DELETE FROM recently_viewed WHERE content_id = ?',
                { run: deleteRecentlyViewedRun },
            ],
            ['DELETE FROM content WHERE id = ?', { run: deleteContentRun }],
        ]);

        runMigrations(sqlite);

        expect(moveFavoritesRun).toHaveBeenCalledWith(10, 11);
        expect(deleteFavoritesRun).toHaveBeenCalledWith(11);
        expect(moveRecentlyViewedRun).toHaveBeenCalledWith(10, 11);
        expect(deleteRecentlyViewedRun).toHaveBeenCalledWith(11);
        expect(deleteContentRun).toHaveBeenCalledTimes(1);
        expect(deleteContentRun).toHaveBeenCalledWith(11);
    });
});

/**
 * The title index folds diacritics, or the cross-playlist matcher cannot see
 * accented titles at all: it compares normalized titles ("amelie") against an
 * index built from the raw one ("Amélie").
 */
describe('content title FTS tokenizer upgrade', () => {
    it('asks for diacritic folding in the statement it creates', () => {
        expect(compactSql(contentTitleFtsStatement(true))).toContain(
            "tokenize='trigram remove_diacritics 1'"
        );
        expect(compactSql(contentTitleFtsStatement(false))).toContain(
            "tokenize='trigram'"
        );
    });

    it('recreates and rebuilds the index, then records the migration', () => {
        const rebuild = { run: jest.fn() };
        const marker = { run: jest.fn() };
        const { sqlite, exec, transaction } = createSqliteMock([
            ['SELECT value FROM app_state', { get: () => undefined }],
            ['INSERT INTO content_title_fts(content_title_fts)', rebuild],
            ['INSERT INTO app_state', marker],
        ]);

        upgradeContentTitleFtsTokenizer(sqlite);

        // The tokenizer is fixed at CREATE time, so the table has to go.
        const statements = exec.mock.calls.map(([sql]) => compactSql(sql));
        expect(statements).toContainEqual(
            expect.stringContaining('DROP TABLE IF EXISTS content_title_fts')
        );
        expect(statements).toContainEqual(
            expect.stringContaining("tokenize='trigram remove_diacritics 1'")
        );
        expect(rebuild.run).toHaveBeenCalled();
        expect(marker.run).toHaveBeenCalled();
        // One transaction, so a rejected CREATE rolls the drop back and the
        // working index survives.
        expect(transaction).toHaveBeenCalled();
    });

    it('does nothing once the migration has completed', () => {
        const { sqlite, exec } = createSqliteMock([
            completedMigrationStateRule,
        ]);

        upgradeContentTitleFtsTokenizer(sqlite);

        expect(exec).not.toHaveBeenCalled();
    });

    it('leaves the index alone when the runtime rejects the tokenizer', () => {
        const marker = { run: jest.fn() };
        const exec = jest.fn((statement: string) => {
            if (statement.includes('remove_diacritics')) {
                throw new Error('unknown tokenizer option');
            }
        });
        const { sqlite } = createSqliteMock(
            [
                ['SELECT value FROM app_state', { get: () => undefined }],
                ['INSERT INTO app_state', marker],
            ],
            exec
        );

        upgradeContentTitleFtsTokenizer(sqlite);

        // The probe failed, so the real table was never dropped — and the
        // migration is NOT marked done, so a newer SQLite retries it.
        const statements = exec.mock.calls.map(([sql]) => compactSql(sql));
        expect(statements).not.toContainEqual(
            expect.stringContaining('DROP TABLE IF EXISTS content_title_fts')
        );
        expect(marker.run).not.toHaveBeenCalled();
    });
});
