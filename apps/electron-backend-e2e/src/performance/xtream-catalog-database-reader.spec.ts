import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
    readXtreamCatalogDatabaseSnapshot,
    type XtreamCatalogDatabaseEvaluator,
} from './xtream-catalog-database-reader';

interface TestStatement {
    get(...parameters: readonly (number | string)[]): unknown;
    run(...parameters: readonly (number | string)[]): unknown;
}

interface TestDatabase {
    close(): void;
    exec(source: string): void;
    prepare(source: string): TestStatement;
}

interface TestDatabaseConstructor {
    new (path: string): TestDatabase;
}

interface RuntimeProcess {
    getBuiltinModule(id: string): unknown;
}

const { DatabaseSync } = (
    process as unknown as RuntimeProcess
).getBuiltinModule('node:sqlite') as {
    readonly DatabaseSync: TestDatabaseConstructor;
};

describe('Xtream catalog database reader', () => {
    it('reads the scoped catalog and import state after capture stops', async () => {
        const database = createDatabase();
        seedPlaylist(database, 'playlist-1');
        seedPartition(database, {
            categoryId: 91_101,
            categoryName: 'Performance Live 01',
            categoryType: 'live',
            contentBase: 1_000_000,
            contentType: 'live',
            playlistId: 'playlist-1',
            titleLabel: 'Live',
        });
        seedPartition(database, {
            categoryId: 92_101,
            categoryName: 'Performance VOD 01',
            categoryType: 'movies',
            contentBase: 2_000_000,
            contentType: 'movie',
            playlistId: 'playlist-1',
            titleLabel: 'Movie',
        });
        seedPartition(database, {
            categoryId: 93_101,
            categoryName: 'Performance Series 01',
            categoryType: 'series',
            contentBase: 3_000_000,
            contentType: 'series',
            playlistId: 'playlist-1',
            titleLabel: 'Series',
        });
        seedStatuses(database, 'playlist-1', 'completed');
        const evaluator = evaluatorFor(database, 2_001);

        const snapshot = await readXtreamCatalogDatabaseSnapshot(evaluator, {
            captureStoppedEpochMs: 2_000,
            dataDirectory: '/tmp/iptvnator-performance-fixture',
            playlistId: 'playlist-1',
            requireFromPath: '/workspace/dist/apps/electron-backend/main.js',
        });

        assert.deepEqual(snapshot, {
            captureStoppedEpochMs: 2_000,
            categories: {
                live: categoryPartition(1, 91_101),
                movies: categoryPartition(1, 92_101),
                series: categoryPartition(1, 93_101),
            },
            categoryCount: 3,
            content: {
                live: contentPartition(1_000, 1_000_000),
                movie: contentPartition(1_000, 2_000_000),
                series: contentPartition(1_000, 3_000_000),
            },
            contentCount: 3_000,
            databaseReadStartedEpochMs: 2_001,
            importStatuses: {
                live: 'completed',
                movie: 'completed',
                series: 'completed',
            },
            matchingPlaylistCount: 1,
            matchingPlaylistType: 'xtream',
            playlistCount: 1,
        });
        database.close();
    });

    it('reports malformed fixture rows and incomplete category cardinality', async () => {
        const database = createDatabase();
        seedPlaylist(database, 'playlist-1');
        database.exec(`
            INSERT INTO categories (playlist_id, name, type, xtream_id)
            VALUES ('playlist-1', 'wrong category', 'live', 91101);
            INSERT INTO content (category_id, title, xtream_id, type)
            VALUES (last_insert_rowid(), 'wrong title', 1000000, 'live');
        `);
        seedStatuses(database, 'playlist-1', 'cancelled');

        const snapshot = await readXtreamCatalogDatabaseSnapshot(
            evaluatorFor(database, 3_001),
            {
                captureStoppedEpochMs: 3_000,
                dataDirectory: '/tmp/iptvnator-performance-fixture',
                playlistId: 'playlist-1',
                requireFromPath:
                    '/workspace/dist/apps/electron-backend/main.js',
            }
        );

        assert.equal(snapshot.categories.live.invalidNameCount, 1);
        assert.equal(snapshot.content.live.invalidTitleCount, 1);
        assert.equal(snapshot.content.live.invalidCategoryCardinalityCount, 1);
        assert.deepEqual(snapshot.importStatuses, {
            live: 'cancelled',
            movie: 'cancelled',
            series: 'cancelled',
        });
        database.close();
    });

    it('returns an empty deleted state without inventing a playlist type', async () => {
        const database = createDatabase();
        seedStatuses(database, 'playlist-1', 'completed');

        const snapshot = await readXtreamCatalogDatabaseSnapshot(
            evaluatorFor(database, 4_001),
            {
                captureStoppedEpochMs: 4_000,
                dataDirectory: '/tmp/iptvnator-performance-fixture',
                playlistId: 'playlist-1',
                requireFromPath:
                    '/workspace/dist/apps/electron-backend/main.js',
            }
        );

        assert.equal(snapshot.categoryCount, 0);
        assert.equal(snapshot.contentCount, 0);
        assert.equal(snapshot.matchingPlaylistCount, 0);
        assert.equal(snapshot.matchingPlaylistType, null);
        assert.equal(snapshot.playlistCount, 0);
        database.close();
    });

    it('fails closed for pre-capture reads and malformed main-process results', async () => {
        const database = createDatabase();
        const base = {
            captureStoppedEpochMs: 5_000,
            dataDirectory: '/tmp/iptvnator-performance-fixture',
            playlistId: 'playlist-1',
            requireFromPath: '/workspace/dist/apps/electron-backend/main.js',
        };

        await assert.rejects(
            readXtreamCatalogDatabaseSnapshot(
                evaluatorFor(database, 4_999),
                base
            ),
            /invalid Xtream catalog database read/
        );
        await assert.rejects(
            readXtreamCatalogDatabaseSnapshot(
                {
                    evaluate: async () => ({
                        databaseReadStartedEpochMs: 5_001,
                        rows: [],
                    }),
                },
                base
            ),
            /invalid Xtream catalog database read/
        );
        await assert.rejects(
            readXtreamCatalogDatabaseSnapshot(evaluatorFor(database, 5_001), {
                ...base,
                dataDirectory: 'relative',
            }),
            /invalid Xtream catalog database read/
        );
        database.close();
    });

    it('accepts high-resolution fractional capture and database epochs', async () => {
        const database = createDatabase();

        const snapshot = await readXtreamCatalogDatabaseSnapshot(
            evaluatorFor(database, 6_000.75),
            {
                captureStoppedEpochMs: 6_000.5,
                dataDirectory: '/tmp/iptvnator-performance-fixture',
                playlistId: 'playlist-1',
                requireFromPath:
                    '/workspace/dist/apps/electron-backend/main.js',
            }
        );

        assert.equal(snapshot.captureStoppedEpochMs, 6_000.5);
        assert.equal(snapshot.databaseReadStartedEpochMs, 6_000.75);
        database.close();
    });

    it('uses the high-resolution epoch clock inside the main-process read boundary', () => {
        const source = readFileSync(
            resolve(
                process.cwd(),
                'src/performance/xtream-catalog-database-reader.ts'
            ),
            'utf8'
        );

        assert.match(source, /getBuiltinModule\(\s*'node:perf_hooks'\s*\)/u);
        assert.match(
            source,
            /perfHooks\.performance\.timeOrigin\s*\+\s*perfHooks\.performance\.now\(\)/u
        );
        assert.doesNotMatch(source, /Date\.now\(\)/u);
    });
});

interface QueryDescriptor {
    readonly parameters: readonly (number | string)[];
    readonly sql: string;
}

interface EvaluationInput {
    readonly queries: readonly QueryDescriptor[];
}

function evaluatorFor(
    database: TestDatabase,
    databaseReadStartedEpochMs: number
): XtreamCatalogDatabaseEvaluator {
    return {
        evaluate: async (_pageFunction: unknown, value: unknown) => {
            const input = value as unknown as EvaluationInput;
            return {
                databaseReadStartedEpochMs,
                rows: input.queries.map((query) =>
                    database.prepare(query.sql).get(...query.parameters)
                ),
            };
        },
    } as unknown as XtreamCatalogDatabaseEvaluator;
}

function createDatabase(): TestDatabase {
    const database = new DatabaseSync(':memory:');
    database.exec(`
        CREATE TABLE playlists (id TEXT PRIMARY KEY, type TEXT NOT NULL);
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            xtream_id INTEGER NOT NULL
        );
        CREATE TABLE content (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            xtream_id INTEGER NOT NULL,
            type TEXT NOT NULL
        );
    `);
    return database;
}

function seedPlaylist(database: TestDatabase, playlistId: string): void {
    database
        .prepare('INSERT INTO playlists (id, type) VALUES (?, ?)')
        .run(playlistId, 'xtream');
}

function seedStatuses(
    database: TestDatabase,
    playlistId: string,
    status: string
): void {
    const insert = database.prepare(
        'INSERT INTO app_state (key, value) VALUES (?, ?)'
    );
    for (const type of ['live', 'movie', 'series']) {
        insert.run(`xtream-import-status:${playlistId}:${type}`, status);
    }
}

function seedPartition(
    database: TestDatabase,
    options: {
        readonly categoryId: number;
        readonly categoryName: string;
        readonly categoryType: string;
        readonly contentBase: number;
        readonly contentType: string;
        readonly playlistId: string;
        readonly titleLabel: string;
    }
): void {
    database
        .prepare(
            `INSERT INTO categories (playlist_id, name, type, xtream_id)
             VALUES (?, ?, ?, ?)`
        )
        .run(
            options.playlistId,
            options.categoryName,
            options.categoryType,
            options.categoryId
        );
    const categoryRow = database
        .prepare('SELECT id FROM categories WHERE playlist_id = ? AND type = ?')
        .get(options.playlistId, options.categoryType) as { id: number };
    const insert = database.prepare(
        `INSERT INTO content (category_id, title, xtream_id, type)
         VALUES (?, ?, ?, ?)`
    );
    for (let index = 0; index < 1_000; index += 1) {
        insert.run(
            categoryRow.id,
            `Performance ${options.titleLabel} ${String(index + 1).padStart(
                6,
                '0'
            )}`,
            options.contentBase + index,
            options.contentType
        );
    }
}

function categoryPartition(count: number, id: number) {
    return {
        count,
        distinctXtreamIdCount: count,
        invalidNameCount: 0,
        maxXtreamId: id,
        minXtreamId: id,
    };
}

function contentPartition(count: number, id: number) {
    return {
        count,
        distinctXtreamIdCount: count,
        invalidCategoryCardinalityCount: 0,
        invalidTitleCount: 0,
        maxXtreamId: id + count - 1,
        minXtreamId: id,
    };
}
