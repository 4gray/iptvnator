import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { __databaseConnectionTestHooks } from './connection';
import { categories, downloads } from './schema';

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

function rebuildDownloadsInElectron(metadataSnapshot: string): {
    metadataSnapshot: string;
    retainedAfterPlaylistDelete: boolean;
    schemaSql: string;
} {
    const electronPath = createRequire(__filename)('electron') as string;
    const connectionUrl = pathToFileURL(
        resolve(__dirname, 'connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { __databaseConnectionTestHooks } = await import(${JSON.stringify(
            connectionUrl
        )});
        const metadataSnapshot = ${JSON.stringify(metadataSnapshot)};
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        sqlite.exec(\`
            CREATE TABLE playlists (id TEXT PRIMARY KEY);
            CREATE TABLE downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id TEXT NOT NULL,
                xtream_id INTEGER NOT NULL,
                content_type TEXT NOT NULL,
                series_xtream_id INTEGER,
                season_number INTEGER,
                episode_number INTEGER,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                file_name TEXT,
                file_path TEXT,
                poster_url TEXT,
                request_headers TEXT,
                metadata_snapshot TEXT,
                status TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                        'queued',
                        'downloading',
                        'completed',
                        'failed',
                        'canceled'
                    )),
                bytes_downloaded INTEGER,
                total_bytes INTEGER,
                error_message TEXT,
                created_at TEXT,
                updated_at TEXT
                , FOREIGN KEY (playlist_id) REFERENCES playlists (id)
                    ON DELETE CASCADE
            );
        \`);
        sqlite.prepare('INSERT INTO playlists (id) VALUES (?)')
            .run('playlist-1');
        sqlite.prepare(\`
            INSERT INTO downloads (
                playlist_id,
                xtream_id,
                content_type,
                title,
                url,
                metadata_snapshot
            ) VALUES (?, ?, ?, ?, ?, ?)
        \`).run(
            'playlist-1',
            42,
            'vod',
            'Offline title',
            'https://example.com/movie',
            metadataSnapshot
        );
        console.log = () => undefined;
        __databaseConnectionTestHooks.ensureDownloadsPauseResumeSchema(sqlite);
        const row = sqlite.prepare(
            'SELECT metadata_snapshot FROM downloads WHERE id = 1'
        ).get();
        const table = sqlite.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'downloads'"
        ).get();
        sqlite.prepare('DELETE FROM playlists WHERE id = ?')
            .run('playlist-1');
        const retainedAfterPlaylistDelete = Boolean(sqlite.prepare(
            'SELECT id FROM downloads WHERE id = 1'
        ).get());
        sqlite.close();
        process.stdout.write(JSON.stringify({
            metadataSnapshot: row.metadata_snapshot,
            retainedAfterPlaylistDelete,
            schemaSql: table.sql,
        }));
    `;
    const output = execFileSync(
        electronPath,
        ['--import', 'tsx', '--eval', script],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
            },
        }
    );

    return JSON.parse(output) as {
        metadataSnapshot: string;
        retainedAfterPlaylistDelete: boolean;
        schemaSql: string;
    };
}

describe('database schema statements', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    const {
        createTableStatements,
        columnMigrationStatements,
        indexMigrationStatements,
        normalizeXtreamContentAddedEpochs,
        ensureContentTitleFts,
    } = __databaseConnectionTestHooks;
    const ensureDownloadsPauseResumeSchema = (
        __databaseConnectionTestHooks as unknown as {
            ensureDownloadsPauseResumeSchema: (sqlite: {
                prepare: (statement: string) => {
                    get?: () => unknown;
                    run?: (...args: unknown[]) => unknown;
                };
                transaction: (callback: () => void) => () => void;
            }) => void;
        }
    ).ensureDownloadsPauseResumeSchema;

    it('records only the statement type for expanded main-process SQL', () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const secrets = [
            'main-user-secret',
            'main-password-secret',
            'https://main-user:main-password@example.com/live?token=main-token-secret',
        ];

        __databaseConnectionTestHooks.traceSqlStatement(
            `UPDATE playlists SET username = '${secrets[0]}', password = '${secrets[1]}', url = '${secrets[2]}'`
        );

        const output = (console.log as jest.Mock).mock.calls.flat().join('\n');
        expect(output).toContain('"statementType":"UPDATE"');
        expect(output).not.toContain('UPDATE playlists');
        for (const secret of secrets) {
            expect(output).not.toContain(secret);
        }
    });

    function createRebuildSqlite(legacyTableSql: string | undefined) {
        const statements: string[] = [];
        const transaction = jest.fn((callback: () => void) => callback);
        const prepare = jest.fn((statement: string) => {
            if (statement.includes('FROM sqlite_master')) {
                return {
                    get: () =>
                        legacyTableSql === undefined
                            ? undefined
                            : { sql: legacyTableSql },
                };
            }
            return {
                run: () => {
                    statements.push(compactSql(statement));
                },
            };
        });

        return { prepare, statements, transaction };
    }

    it('defines the core fresh-install tables, indexes, and FTS triggers', () => {
        const schemaSql = createTableStatements.map(compactSql).join('\n');
        const downloadsSchemaSql =
            createTableStatements
                .map(compactSql)
                .find((statement) =>
                    statement.startsWith('CREATE TABLE IF NOT EXISTS downloads')
                ) ?? '';
        const downloadColumns = Object.values(getTableColumns(downloads)).map(
            (column) => column.name
        );
        const categoryForeignKeys = getTableConfig(categories).foreignKeys;
        const downloadForeignKeys = getTableConfig(downloads).foreignKeys;

        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS playlists');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS categories');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS content');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS epg_channels');
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS epg_programs');
        expect(schemaSql).toContain(
            'CREATE VIRTUAL TABLE IF NOT EXISTS epg_programs_fts USING fts5'
        );
        expect(schemaSql).toContain(
            'CREATE VIRTUAL TABLE IF NOT EXISTS content_title_fts USING fts5'
        );
        expect(schemaSql).toContain("tokenize='trigram'");
        expect(schemaSql).toContain(
            'CREATE TABLE IF NOT EXISTS playback_positions'
        );
        expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS downloads');
        expect(downloadsSchemaSql).not.toContain(
            'FOREIGN KEY (playlist_id) REFERENCES playlists'
        );
        expect(categoryForeignKeys).toHaveLength(1);
        expect(downloadForeignKeys).toHaveLength(0);
        expect(schemaSql).toContain('request_headers TEXT');
        expect(schemaSql).toContain('resume_validator TEXT');
        expect(schemaSql).toContain('metadata_snapshot TEXT');
        expect(downloadColumns).toContain('metadata_snapshot');
        expect(schemaSql).toContain("'paused'");
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
        expect(schemaSql).toContain(
            'CREATE TRIGGER IF NOT EXISTS content_title_fts_ai'
        );
        expect(schemaSql).toContain(
            'CREATE TRIGGER IF NOT EXISTS content_title_fts_ad'
        );
        expect(schemaSql).toContain(
            'CREATE TRIGGER IF NOT EXISTS content_title_fts_au'
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
                'ALTER TABLE playlists ADD COLUMN detected_epg_urls TEXT',
                'ALTER TABLE playlists ADD COLUMN manual_epg_urls TEXT',
                'ALTER TABLE playlists ADD COLUMN disabled_epg_urls TEXT',
                'ALTER TABLE favorites ADD COLUMN position INTEGER DEFAULT 0',
                'ALTER TABLE content ADD COLUMN backdrop_url TEXT',
            ])
        );
        expect(columnMigrationStatements).toContain(
            'ALTER TABLE downloads ADD COLUMN metadata_snapshot TEXT'
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
                'CREATE INDEX IF NOT EXISTS idx_epg_programs_source ON epg_programs(source_url)',
                'CREATE INDEX IF NOT EXISTS idx_epg_programs_source_time_range ON epg_programs(source_url, channel_id, start, stop)',
            ])
        );
    });

    it('creates indexes for migrated EPG program columns only after column migrations run', () => {
        const createSchemaSql = createTableStatements.map(compactSql);

        expect(createSchemaSql).not.toContain(
            'CREATE INDEX IF NOT EXISTS idx_epg_programs_source ON epg_programs(source_url)'
        );
        expect(createSchemaSql).not.toContain(
            'CREATE INDEX IF NOT EXISTS idx_epg_programs_source_time_range ON epg_programs(source_url, channel_id, start, stop)'
        );
        expect(columnMigrationStatements.map(compactSql)).toContain(
            'ALTER TABLE epg_programs ADD COLUMN source_url TEXT'
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

    it('runs the legacy millisecond Xtream timestamp normalization once', () => {
        const selectGet = jest.fn().mockReturnValue(undefined);
        const updateRun = jest.fn();
        const stateRun = jest.fn();
        const prepare = jest.fn((statement: string) => {
            if (statement.includes('SELECT value FROM app_state')) {
                return { get: selectGet };
            }
            if (statement.includes('UPDATE content')) {
                return { run: updateRun };
            }
            if (statement.includes('INSERT INTO app_state')) {
                return { run: stateRun };
            }

            throw new Error(`Unexpected statement: ${compactSql(statement)}`);
        });
        const transaction = jest.fn((callback: () => void) => callback);
        const sqlite = {
            prepare,
            transaction,
        } as unknown as Parameters<typeof normalizeXtreamContentAddedEpochs>[0];

        normalizeXtreamContentAddedEpochs(sqlite);

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(updateRun).toHaveBeenCalledWith(10_000_000_000, 10_000_000_000);
        expect(stateRun).toHaveBeenCalledWith(
            'migration:xtream-content-added-epoch-seconds:v1'
        );
    });

    it('skips legacy Xtream timestamp normalization after it has run', () => {
        const selectGet = jest.fn().mockReturnValue({ value: 'done' });
        const prepare = jest.fn((statement: string) => {
            if (statement.includes('SELECT value FROM app_state')) {
                return { get: selectGet };
            }

            throw new Error(`Unexpected statement: ${compactSql(statement)}`);
        });
        const transaction = jest.fn((callback: () => void) => callback);
        const sqlite = {
            prepare,
            transaction,
        } as unknown as Parameters<typeof normalizeXtreamContentAddedEpochs>[0];

        normalizeXtreamContentAddedEpochs(sqlite);

        expect(transaction).not.toHaveBeenCalled();
    });

    it('rebuilds the content title FTS index once for existing content', () => {
        const selectGet = jest.fn().mockReturnValue(undefined);
        const rebuildRun = jest.fn();
        const stateRun = jest.fn();
        const prepare = jest.fn((statement: string) => {
            if (statement.includes('SELECT value FROM app_state')) {
                return { get: selectGet };
            }
            if (statement.includes('content_title_fts')) {
                return { run: rebuildRun };
            }
            if (statement.includes('INSERT INTO app_state')) {
                return { run: stateRun };
            }

            throw new Error(`Unexpected statement: ${compactSql(statement)}`);
        });
        const transaction = jest.fn((callback: () => void) => callback);
        const sqlite = {
            prepare,
            transaction,
        } as unknown as Parameters<typeof ensureContentTitleFts>[0];

        ensureContentTitleFts(sqlite);

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(rebuildRun).toHaveBeenCalledTimes(1);
        expect(stateRun).toHaveBeenCalledWith(
            'migration:content-title-fts-trigram:v1'
        );
    });

    it('skips content title FTS rebuild after it has run', () => {
        const selectGet = jest.fn().mockReturnValue({ value: 'done' });
        const prepare = jest.fn((statement: string) => {
            if (statement.includes('SELECT value FROM app_state')) {
                return { get: selectGet };
            }

            throw new Error(`Unexpected statement: ${compactSql(statement)}`);
        });
        const transaction = jest.fn((callback: () => void) => callback);
        const sqlite = {
            prepare,
            transaction,
        } as unknown as Parameters<typeof ensureContentTitleFts>[0];

        ensureContentTitleFts(sqlite);

        expect(transaction).not.toHaveBeenCalled();
    });

    it('backfills the content title FTS index before content-mutating migrations', () => {
        const callOrder: string[] = [];
        const runMigrations = (
            __databaseConnectionTestHooks as unknown as {
                runMigrations: (sqlite: {
                    exec: (statement: string) => void;
                    prepare: (statement: string) => {
                        all?: () => unknown[];
                        get?: (...args: unknown[]) => unknown;
                        run?: (...args: unknown[]) => unknown;
                    };
                    transaction: (callback: () => void) => () => void;
                }) => void;
            }
        ).runMigrations;
        const sqlite = {
            exec: jest.fn(),
            prepare: jest.fn((statement: string) => {
                if (statement.includes('SELECT value FROM app_state')) {
                    return {
                        get: (): undefined => {
                            return undefined;
                        },
                    };
                }
                if (
                    statement.includes(
                        'INSERT INTO content_title_fts(content_title_fts)'
                    )
                ) {
                    return {
                        run: () => {
                            callOrder.push('fts-rebuild');
                        },
                    };
                }
                if (statement.includes('INSERT INTO app_state')) {
                    return { run: jest.fn() };
                }
                if (statement.includes('UPDATE content')) {
                    return {
                        run: () => {
                            callOrder.push('content-update');
                        },
                    };
                }
                if (statement.includes('DELETE FROM content')) {
                    return {
                        run: () => {
                            callOrder.push('content-delete');
                        },
                    };
                }

                return {
                    all: () => [],
                    get: (): undefined => undefined,
                    run: jest.fn(),
                };
            }),
            transaction: jest.fn((callback: () => void) => callback),
        };

        runMigrations(sqlite);

        expect(callOrder).toEqual(['fts-rebuild', 'content-update']);
        expect(sqlite.prepare).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE content')
        );
    });

    it('backfills migrated EPG program source URLs after creating scoped EPG indexes', () => {
        const callOrder: string[] = [];
        const runMigrations = (
            __databaseConnectionTestHooks as unknown as {
                runMigrations: (sqlite: {
                    exec: (statement: string) => void;
                    prepare: (statement: string) => {
                        all?: () => unknown[];
                        get?: (...args: unknown[]) => unknown;
                        run?: (...args: unknown[]) => unknown;
                    };
                    transaction: (callback: () => void) => () => void;
                }) => void;
            }
        ).runMigrations;
        const sqlite = {
            exec: jest.fn((statement: string) => {
                if (statement.includes('idx_epg_programs_source')) {
                    callOrder.push('epg-source-index');
                }
            }),
            prepare: jest.fn((statement: string) => {
                if (statement.includes('SELECT value FROM app_state')) {
                    return {
                        get: (): undefined => undefined,
                    };
                }
                if (statement.includes('UPDATE epg_programs')) {
                    return {
                        run: () => {
                            callOrder.push('epg-source-backfill');
                        },
                    };
                }
                if (statement.includes('INSERT INTO app_state')) {
                    return { run: jest.fn() };
                }

                return {
                    all: () => [],
                    get: (): undefined => undefined,
                    run: jest.fn(),
                };
            }),
            transaction: jest.fn((callback: () => void) => callback),
        };

        runMigrations(sqlite);

        expect(callOrder).toContain('epg-source-backfill');
        expect(callOrder).toContain('epg-source-index');
        expect(callOrder.indexOf('epg-source-index')).toBeLessThan(
            callOrder.indexOf('epg-source-backfill')
        );
    });

    it('rebuilds a legacy downloads table without paused status or stored headers', () => {
        const sqlite = createRebuildSqlite(
            `CREATE TABLE downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'downloading', 'completed', 'failed', 'canceled')))`
        );

        ensureDownloadsPauseResumeSchema(sqlite);

        expect(sqlite.transaction).toHaveBeenCalledTimes(1);
        const { statements } = sqlite;
        const renameIndex = statements.findIndex((statement) =>
            statement.startsWith('ALTER TABLE downloads RENAME TO')
        );
        const createIndex = statements.findIndex((statement) =>
            statement.startsWith('CREATE TABLE IF NOT EXISTS downloads')
        );
        const copyIndex = statements.findIndex((statement) =>
            statement.startsWith('INSERT INTO downloads')
        );
        const dropLegacyIndex = statements.findIndex((statement) =>
            statement.startsWith('DROP TABLE downloads_pause_resume_legacy')
        );

        expect(renameIndex).toBeGreaterThanOrEqual(0);
        expect(createIndex).toBeGreaterThan(renameIndex);
        expect(copyIndex).toBeGreaterThan(createIndex);
        expect(dropLegacyIndex).toBeGreaterThan(copyIndex);
        // Indexes on the old table are dropped before the rename and
        // recreated after the copy.
        expect(
            statements.filter((statement) =>
                statement.startsWith('DROP INDEX IF EXISTS')
            ).length
        ).toBe(3);
        expect(
            statements
                .slice(dropLegacyIndex + 1)
                .filter((statement) => statement.includes('CREATE')).length
        ).toBe(3);
        // The rebuilt table carries the new contract; legacy rows get NULL
        // stored headers, and the copy never references resume_validator so
        // it defaults to NULL.
        expect(statements[createIndex]).toContain(`'paused'`);
        expect(statements[createIndex]).toContain('request_headers TEXT');
        expect(statements[createIndex]).toContain('resume_validator TEXT');
        expect(statements[copyIndex]).toContain('NULL AS request_headers');
        expect(statements[copyIndex]).toContain('NULL AS metadata_snapshot');
        expect(statements[copyIndex]).toContain('NULL AS resume_validator');
    });

    it('copies stored headers when only the paused status is missing', () => {
        const sqlite = createRebuildSqlite(
            `CREATE TABLE downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, request_headers TEXT, status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'downloading', 'completed', 'failed', 'canceled')))`
        );

        ensureDownloadsPauseResumeSchema(sqlite);

        const copy = sqlite.statements.find((statement) =>
            statement.startsWith('INSERT INTO downloads')
        );
        expect(copy).toBeDefined();
        expect(copy).not.toContain('NULL AS request_headers');
        expect(copy).toContain('request_headers');
    });

    it('preserves metadata snapshots when rebuilding the pause/resume schema', () => {
        const metadataSnapshot = JSON.stringify({
            version: 1,
            language: 'en',
            mediaKind: 'movie',
            title: 'Offline title',
        });
        const rebuilt = rebuildDownloadsInElectron(metadataSnapshot);

        expect(rebuilt.schemaSql).toContain(`'paused'`);
        expect(rebuilt.schemaSql).not.toContain('REFERENCES playlists');
        expect(rebuilt.metadataSnapshot).toBe(metadataSnapshot);
        expect(rebuilt.retainedAfterPlaylistDelete).toBe(true);
    });

    it('rebuilds a current downloads table that still cascades with its source playlist', () => {
        const sqlite = createRebuildSqlite(
            `CREATE TABLE downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                request_headers TEXT,
                resume_validator TEXT,
                status TEXT CHECK (status IN ('queued', 'downloading', 'paused', 'completed', 'failed', 'canceled'))
            )`
        );

        ensureDownloadsPauseResumeSchema(sqlite);

        expect(sqlite.transaction).toHaveBeenCalledTimes(1);
        const replacement = sqlite.statements.find((statement) =>
            statement.startsWith('CREATE TABLE IF NOT EXISTS downloads')
        );
        expect(replacement).toBeDefined();
        expect(replacement).not.toContain('REFERENCES playlists');
    });

    it('skips the downloads rebuild when the table already has the paused contract', () => {
        const sqlite = createRebuildSqlite(
            `CREATE TABLE downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, request_headers TEXT, resume_validator TEXT, status TEXT CHECK (status IN ('queued', 'downloading', 'paused', 'completed', 'failed', 'canceled')))`
        );

        ensureDownloadsPauseResumeSchema(sqlite);

        expect(sqlite.transaction).not.toHaveBeenCalled();
        expect(sqlite.statements).toHaveLength(0);
    });

    it('backfills migrated EPG program source URLs in bounded batches', () => {
        const { backfillEpgProgramSourceUrls } = __databaseConnectionTestHooks;
        let updateStatement = '';
        const backfillRun = jest
            .fn()
            .mockReturnValueOnce({ changes: 50_000 })
            .mockReturnValueOnce({ changes: 12 });
        const stateRun = jest.fn();
        const prepare = jest.fn((statement: string) => {
            if (statement.includes('SELECT value FROM app_state')) {
                return {
                    get: (): undefined => undefined,
                };
            }
            if (statement.includes('UPDATE epg_programs')) {
                updateStatement = compactSql(statement);
                return {
                    run: backfillRun,
                };
            }
            if (statement.includes('INSERT INTO app_state')) {
                return { run: stateRun };
            }

            throw new Error(`Unexpected statement: ${compactSql(statement)}`);
        });
        const transaction = jest.fn((callback: () => void) => callback);
        const sqlite = {
            prepare,
            transaction,
        } as unknown as Parameters<typeof backfillEpgProgramSourceUrls>[0];

        backfillEpgProgramSourceUrls(sqlite);

        expect(updateStatement).toContain('LIMIT 50000');
        expect(backfillRun).toHaveBeenCalledTimes(2);
        expect(stateRun).toHaveBeenCalledWith(
            'migration:epg-program-source-url-backfill:v1'
        );
    });
});
