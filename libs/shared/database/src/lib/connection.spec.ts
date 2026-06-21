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
        normalizeXtreamContentAddedEpochs,
        ensureContentTitleFts,
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
            'CREATE VIRTUAL TABLE IF NOT EXISTS content_title_fts USING fts5'
        );
        expect(schemaSql).toContain("tokenize='trigram'");
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

    it('backfills migrated EPG program source URLs in bounded batches', () => {
        const { backfillEpgProgramSourceUrls } =
            __databaseConnectionTestHooks;
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
