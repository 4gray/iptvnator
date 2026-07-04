import { __databaseConnectionTestHooks } from './connection';

const {
    columnMigrationStatements,
    createTables,
    createTableStatements,
    indexMigrationStatements,
    runMigrations,
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

function createSqliteMock(
    rules: HandlerRule[],
    exec: jest.Mock = jest.fn()
) {
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
                { all: () => [{ playlistId: 'p1', type: 'live', xtreamId: 5 }] },
            ],
            ['LEFT JOIN content', { all: candidatesAll }],
            [
                'UPDATE content SET category_id = ? WHERE category_id = ?',
                { run: updateContentRun },
            ],
            ['DELETE FROM categories WHERE id = ?', { run: deleteCategoryRun }],
            ['FROM content GROUP BY category_id, type, xtream_id', { all: () => [] }],
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
