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
    deduplicateXtreamCache,
    ensurePlaylistsPayloadLast,
    playlistsTableSql,
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
    exec: jest.Mock = jest.fn(),
    pragma: jest.Mock = jest.fn(() => [])
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
        pragma,
        sqlite: {
            exec,
            prepare,
            pragma,
            transaction,
        } as unknown as SqliteHandle,
        transaction,
    };
}

const completedMigrationStateRule: HandlerRule = [
    'SELECT value FROM app_state',
    { get: () => ({ value: 'done' }) },
];

/** The live title index, already carrying the folding tokenizer. */
const foldedIndexRule: HandlerRule = [
    "name = 'content_title_fts'",
    {
        get: () => ({
            sql: "CREATE VIRTUAL TABLE content_title_fts USING fts5(title, tokenize='trigram remove_diacritics 1')",
        }),
    },
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
            [completedMigrationStateRule, foldedIndexRule],
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
            [completedMigrationStateRule, foldedIndexRule],
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

describe('TMDB search lookup cache cleanup', () => {
    function deleteStatements(sqlite: SqliteHandle): string[] {
        return (sqlite.prepare as jest.Mock).mock.calls
            .map(([statement]) => compactSql(statement))
            .filter((statement) =>
                statement.includes('DELETE FROM tmdb_metadata')
            );
    }

    it('deletes every retired key generation and records each migration atomically', () => {
        const deleteRun = jest.fn();
        const markerRun = jest.fn();
        const { sqlite, transaction } = createSqliteMock([
            ['SELECT value FROM app_state', { get: () => undefined }],
            ['DELETE FROM tmdb_metadata', { run: deleteRun }],
            ['INSERT INTO app_state', { run: markerRun }],
        ]);

        cleanupLegacyTmdbSearchCache(sqlite);

        expect(transaction).toHaveBeenCalledTimes(3);
        expect(deleteRun).toHaveBeenCalledTimes(3);
        expect(markerRun.mock.calls.map(([key]) => key)).toEqual([
            'migration:tmdb-search-lookup-v2-cache-cleanup:v1',
            'migration:tmdb-search-lookup-v3-cache-cleanup:v1',
            'migration:tmdb-search-lookup-v4-cache-cleanup:v1',
        ]);
        const [unversionedDelete, v2Delete, v3Delete] =
            deleteStatements(sqlite);
        expect(unversionedDelete).toContain(
            "lookup_key LIKE 'title:%|year:%' AND lookup_key NOT LIKE 'title:%|year:%|v%'"
        );
        // Each generation deletes only its own rows: the v4 rows the resolver
        // writes now, and the `id:`/`person:`/`badProviderId:` rows, survive.
        expect(v2Delete).toContain("WHERE lookup_key LIKE 'title:%|year:%|v2'");
        expect(v2Delete).not.toContain('v3');
        expect(v3Delete).toContain("WHERE lookup_key LIKE 'title:%|year:%|v3'");
        expect(v3Delete).not.toContain('v4');
    });

    it('runs only the generations that have not completed yet', () => {
        const markerRun = jest.fn();
        const { sqlite, transaction } = createSqliteMock([
            [
                'SELECT value FROM app_state',
                {
                    get: (key: unknown) =>
                        key ===
                        'migration:tmdb-search-lookup-v2-cache-cleanup:v1'
                            ? { value: 'done' }
                            : undefined,
                },
            ],
            ['INSERT INTO app_state', { run: markerRun }],
        ]);

        cleanupLegacyTmdbSearchCache(sqlite);

        expect(transaction).toHaveBeenCalledTimes(2);
        expect(markerRun.mock.calls.map(([key]) => key)).toEqual([
            'migration:tmdb-search-lookup-v3-cache-cleanup:v1',
            'migration:tmdb-search-lookup-v4-cache-cleanup:v1',
        ]);
        expect(deleteStatements(sqlite)).toEqual([
            expect.stringContaining("lookup_key LIKE 'title:%|year:%|v2'"),
            expect.stringContaining("lookup_key LIKE 'title:%|year:%|v3'"),
        ]);
    });

    it('does nothing after every migration has completed', () => {
        const { sqlite, prepare, transaction } = createSqliteMock([
            completedMigrationStateRule,
        ]);

        cleanupLegacyTmdbSearchCache(sqlite);

        expect(transaction).not.toHaveBeenCalled();
        // One marker read per retired generation, nothing else
        expect(prepare).toHaveBeenCalledTimes(3);
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
            foldedIndexRule,
        ]);

        upgradeContentTitleFtsTokenizer(sqlite);

        expect(exec).not.toHaveBeenCalled();
    });

    it('rebuilds when the record says done but the index is not folded', () => {
        const rebuild = { run: jest.fn() };
        const { sqlite, exec } = createSqliteMock([
            completedMigrationStateRule,
            [
                'SELECT sql FROM sqlite_master',
                {
                    get: () => ({
                        sql: "CREATE VIRTUAL TABLE content_title_fts USING fts5(title, tokenize='trigram')",
                    }),
                },
            ],
            ['INSERT INTO content_title_fts(content_title_fts)', rebuild],
        ]);

        upgradeContentTitleFtsTokenizer(sqlite);

        // `createTables` declares this table too, with the plain tokenizer, so
        // the marker and the live table can disagree. Trusting the marker
        // leaves a silently degraded index: discovery simply stops finding
        // "Pokémon" for "pokemon", with nothing to show that it should have.
        const statements = exec.mock.calls.map(([sql]) => compactSql(sql));
        expect(statements).toContainEqual(
            expect.stringContaining("tokenize='trigram remove_diacritics 1'")
        );
        expect(rebuild.run).toHaveBeenCalled();
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

describe('deduplicateXtreamCache guard', () => {
    const uniqueIndexCountRule = (count: number): HandlerRule => [
        "FROM sqlite_master WHERE type = 'index'",
        { get: () => ({ count }) },
    ];

    it('skips the duplicate scans once both unique indexes exist', () => {
        const categoryGroups = jest.fn(() => []);
        const contentGroups = jest.fn(() => []);
        const { sqlite, transaction } = createSqliteMock([
            uniqueIndexCountRule(2),
            [
                'FROM categories GROUP BY playlist_id, type, xtream_id',
                { all: categoryGroups },
            ],
            [
                'FROM content GROUP BY category_id, type, xtream_id',
                { all: contentGroups },
            ],
        ]);

        deduplicateXtreamCache(sqlite);

        expect(transaction).not.toHaveBeenCalled();
        expect(categoryGroups).not.toHaveBeenCalled();
        expect(contentGroups).not.toHaveBeenCalled();
    });

    it('still scans while one of the unique indexes is missing', () => {
        const categoryGroups = jest.fn(() => []);
        const contentGroups = jest.fn(() => []);
        const { sqlite, transaction } = createSqliteMock([
            uniqueIndexCountRule(1),
            [
                'FROM categories GROUP BY playlist_id, type, xtream_id',
                { all: categoryGroups },
            ],
            [
                'FROM content GROUP BY category_id, type, xtream_id',
                { all: contentGroups },
            ],
        ]);

        deduplicateXtreamCache(sqlite);

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(categoryGroups).toHaveBeenCalledTimes(1);
        expect(contentGroups).toHaveBeenCalledTimes(1);
    });

    it('names the unique indexes the index migrations create', () => {
        for (const name of [
            'categories_playlist_type_xtream_unique',
            'content_category_type_xtream_unique',
        ]) {
            expect(
                indexMigrationStatements.some((statement) =>
                    statement.includes(
                        `CREATE UNIQUE INDEX IF NOT EXISTS ${name} `
                    )
                )
            ).toBe(true);
        }
    });
});

describe('ensurePlaylistsPayloadLast', () => {
    const canonicalColumns = [
        'id',
        'name',
        'serverUrl',
        'username',
        'password',
        'date_created',
        'last_updated',
        'type',
        'userAgent',
        'origin',
        'referrer',
        'filePath',
        'epg_urls',
        'detected_epg_urls',
        'manual_epg_urls',
        'disabled_epg_urls',
        'autoRefresh',
        'macAddress',
        'url',
        'portal_url',
        'count',
        'import_date',
        'update_date',
        'position',
        'favorites',
        'recently_viewed',
        'last_usage',
        'payload',
    ];
    /** A pre-0.19 table after its ALTER TABLE migrations. */
    const legacyColumns = [
        ...canonicalColumns.filter(
            (name) => !name.endsWith('epg_urls') && name !== 'payload'
        ),
        'payload',
        'epg_urls',
        'detected_epg_urls',
        'manual_epg_urls',
        'disabled_epg_urls',
    ];
    /** Rules answering the column list and the foreign key check. */
    const playlistRules = (
        columns: string[],
        foreignKeyCheck: unknown[] = []
    ): HandlerRule[] => [
        [
            "FROM pragma_table_info('playlists')",
            { all: () => columns.map((name) => ({ name })) },
        ],
        [
            'FROM sqlite_master AS m, pragma_foreign_key_list(m.name)',
            { all: () => [{ name: 'favorites' }, { name: 'categories' }] },
        ],
        [
            'FROM pragma_foreign_key_check(?)',
            {
                get: (table: unknown) => ({
                    count: foreignKeyCheck.filter(
                        (row) => (row as { table: string }).table === table
                    ).length,
                }),
            },
        ],
    ];
    const rebuildStatements = (prepare: jest.Mock) =>
        prepare.mock.calls
            .map(([statement]) => compactSql(statement as string))
            .filter((statement) => !statement.includes('pragma_'));

    let warnSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
        logSpy.mockRestore();
    });

    it('creates fresh tables with payload as the last column', () => {
        expect(createTableStatements[0]).toMatch(
            /CREATE TABLE IF NOT EXISTS playlists \([\s\S]*payload TEXT\s*\)$/
        );
        expect(playlistsTableSql('rebuilt')).toMatch(
            /^CREATE TABLE IF NOT EXISTS rebuilt \(/
        );
    });

    it('leaves a table whose last column is payload alone', () => {
        const { sqlite, prepare, pragma, transaction } = createSqliteMock(
            playlistRules(canonicalColumns)
        );

        ensurePlaylistsPayloadLast(sqlite);

        expect(transaction).not.toHaveBeenCalled();
        expect(rebuildStatements(prepare)).toEqual([]);
        expect(pragma).not.toHaveBeenCalled();
    });

    it('rebuilds a table whose columns were appended after payload, with foreign keys off', () => {
        const { sqlite, prepare, pragma, transaction } = createSqliteMock(
            playlistRules(legacyColumns)
        );

        ensurePlaylistsPayloadLast(sqlite);

        expect(transaction).toHaveBeenCalledTimes(1);
        const quoted = canonicalColumns.map((name) => `"${name}"`).join(', ');
        expect(rebuildStatements(prepare)).toEqual([
            'DROP TABLE IF EXISTS playlists_payload_rebuild',
            expect.stringMatching(
                /^CREATE TABLE IF NOT EXISTS playlists_payload_rebuild \( id TEXT PRIMARY KEY,.* last_usage TEXT, payload TEXT \)$/
            ),
            `INSERT INTO playlists_payload_rebuild (${quoted}) SELECT ${quoted} FROM playlists`,
            'DROP TABLE playlists',
            'ALTER TABLE playlists_payload_rebuild RENAME TO playlists',
        ]);
        // Foreign keys go off before the transaction and come back after it,
        // and the check runs inside it, after the rename.
        expect(pragma.mock.calls.map(([statement]) => statement)).toEqual([
            'foreign_keys = OFF',
            'foreign_keys = ON',
        ]);
        const all = prepare.mock.calls.map(([statement]) =>
            compactSql(statement as string)
        );
        expect(
            all.findIndex((statement) =>
                statement.startsWith(
                    'SELECT COUNT(*) AS count FROM pragma_foreign_key_check(?)'
                )
            )
        ).toBeGreaterThan(
            all.indexOf(
                'ALTER TABLE playlists_payload_rebuild RENAME TO playlists'
            )
        );
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('rolls the rebuild back and restores foreign keys when a reference breaks', () => {
        const { sqlite, pragma } = createSqliteMock(
            playlistRules(legacyColumns, [
                { table: 'favorites', rowid: 1, parent: 'playlists', fkid: 0 },
            ])
        );

        expect(() => ensurePlaylistsPayloadLast(sqlite)).not.toThrow();

        expect(warnSpy).toHaveBeenCalledWith(
            '[DB] playlists payload-last rebuild failed:',
            expect.objectContaining({
                message: expect.stringContaining('1 foreign key violation(s)'),
            })
        );
        expect(pragma.mock.calls.at(-1)?.[0]).toBe('foreign_keys = ON');
    });

    it('does not rebuild while a canonical column is still missing', () => {
        const { sqlite, pragma, transaction } = createSqliteMock(
            playlistRules(
                legacyColumns.filter((name) => name !== 'disabled_epg_urls')
            )
        );

        ensurePlaylistsPayloadLast(sqlite);

        expect(transaction).not.toHaveBeenCalled();
        expect(pragma).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('columns missing: disabled_epg_urls')
        );
    });
});
