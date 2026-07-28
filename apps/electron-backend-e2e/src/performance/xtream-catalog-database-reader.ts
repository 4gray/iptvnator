import type { ElectronApplication } from '@playwright/test';
import { isAbsolute, join } from 'node:path';

import type { XtreamCatalogDatabaseSnapshot } from './xtream-catalog-database-verification';
import {
    buildXtreamCatalogDatabaseQueries,
    type XtreamCatalogDatabaseQuery,
} from './xtream-catalog-database-queries';

export type XtreamCatalogDatabaseEvaluator = Pick<
    ElectronApplication,
    'evaluate'
>;

export interface XtreamCatalogDatabaseReadOptions {
    readonly captureStoppedEpochMs: number;
    readonly dataDirectory: string;
    readonly playlistId: string;
    readonly requireFromPath: string;
}

interface DatabaseReadInput {
    readonly databasePath: string;
    readonly queries: readonly XtreamCatalogDatabaseQuery[];
    readonly requireFromPath: string;
}

interface DatabaseReadTransport {
    readonly databaseReadStartedEpochMs: number;
    readonly rows: readonly unknown[];
}

export async function readXtreamCatalogDatabaseSnapshot(
    evaluator: XtreamCatalogDatabaseEvaluator,
    options: XtreamCatalogDatabaseReadOptions
): Promise<XtreamCatalogDatabaseSnapshot> {
    try {
        assertOptions(options);
        const queries = buildXtreamCatalogDatabaseQueries(options.playlistId);
        const transport = (await evaluator.evaluate(
            async (_electron, input: DatabaseReadInput) => {
                interface SqliteStatement {
                    get(...parameters: readonly (number | string)[]): unknown;
                }
                interface SqliteDatabase {
                    close(): void;
                    pragma(source: string): unknown;
                    prepare(source: string): SqliteStatement;
                }
                interface SqliteConstructor {
                    new (
                        path: string,
                        options: {
                            readonly: true;
                            fileMustExist: true;
                        }
                    ): SqliteDatabase;
                }
                interface NodeModuleBuiltin {
                    createRequire(path: string): (id: string) => unknown;
                }
                interface NodePerfHooksBuiltin {
                    readonly performance: {
                        now(): number;
                        readonly timeOrigin: number;
                    };
                }

                const perfHooks = process.getBuiltinModule(
                    'node:perf_hooks'
                ) as NodePerfHooksBuiltin;
                const databaseReadStartedEpochMs =
                    perfHooks.performance.timeOrigin +
                    perfHooks.performance.now();
                const nodeModule = process.getBuiltinModule(
                    'node:module'
                ) as NodeModuleBuiltin;
                const requireFromBuild = nodeModule.createRequire(
                    input.requireFromPath
                );
                const Sqlite = requireFromBuild(
                    'better-sqlite3'
                ) as SqliteConstructor;
                const database = new Sqlite(input.databasePath, {
                    readonly: true,
                    fileMustExist: true,
                });
                try {
                    database.pragma('query_only = ON');
                    return {
                        databaseReadStartedEpochMs,
                        rows: input.queries.map((query) =>
                            database.prepare(query.sql).get(...query.parameters)
                        ),
                    };
                } finally {
                    database.close();
                }
            },
            {
                databasePath: join(
                    options.dataDirectory,
                    'databases',
                    'iptvnator.db'
                ),
                queries,
                requireFromPath: options.requireFromPath,
            }
        )) as DatabaseReadTransport;
        return snapshotTransport(
            transport,
            options.captureStoppedEpochMs,
            queries.length
        );
    } catch {
        throw new Error('invalid Xtream catalog database read');
    }
}

function snapshotTransport(
    value: unknown,
    captureStoppedEpochMs: number,
    expectedRowCount: number
): XtreamCatalogDatabaseSnapshot {
    const transport = exactRecord(value, [
        'databaseReadStartedEpochMs',
        'rows',
    ]);
    const databaseReadStartedEpochMs = transport[
        'databaseReadStartedEpochMs'
    ] as unknown;
    const rows = transport['rows'];
    if (
        !isPositiveFinite(databaseReadStartedEpochMs) ||
        databaseReadStartedEpochMs < captureStoppedEpochMs ||
        !Array.isArray(rows) ||
        rows.length !== expectedRowCount
    ) {
        invalid();
    }

    const playlist = numericRecord(rows[0], [
        'playlistCount',
        'matchingPlaylistCount',
        'matchingPlaylistType',
    ]);
    const categoryCount = singleCount(rows[1], 'categoryCount');
    const contentCount = singleCount(rows[2], 'contentCount');
    const categories = [rows[3], rows[4], rows[5]].map(categoryPartition);
    const content = [rows[6], rows[7], rows[8]].map(contentPartition);
    const importStatuses = statusRecord(rows[9]);
    const matchingPlaylistType = playlist['matchingPlaylistType'];
    if (
        matchingPlaylistType !== null &&
        typeof matchingPlaylistType !== 'string'
    ) {
        invalid();
    }

    return Object.freeze({
        captureStoppedEpochMs,
        categories: Object.freeze({
            live: categories[0],
            movies: categories[1],
            series: categories[2],
        }),
        categoryCount,
        content: Object.freeze({
            live: content[0],
            movie: content[1],
            series: content[2],
        }),
        contentCount,
        databaseReadStartedEpochMs,
        importStatuses,
        matchingPlaylistCount: nonNegativeInteger(
            playlist['matchingPlaylistCount']
        ),
        matchingPlaylistType,
        playlistCount: nonNegativeInteger(playlist['playlistCount']),
    });
}

function categoryPartition(value: unknown) {
    const row = numericRecord(value, [
        'count',
        'distinctXtreamIdCount',
        'invalidNameCount',
        'maxXtreamId',
        'minXtreamId',
    ]);
    return Object.freeze({
        count: nonNegativeInteger(row['count']),
        distinctXtreamIdCount: nonNegativeInteger(row['distinctXtreamIdCount']),
        invalidNameCount: nonNegativeInteger(row['invalidNameCount']),
        maxXtreamId: nullableInteger(row['maxXtreamId']),
        minXtreamId: nullableInteger(row['minXtreamId']),
    });
}

function contentPartition(value: unknown) {
    const row = numericRecord(value, [
        'count',
        'distinctXtreamIdCount',
        'invalidCategoryCardinalityCount',
        'invalidTitleCount',
        'maxXtreamId',
        'minXtreamId',
    ]);
    return Object.freeze({
        count: nonNegativeInteger(row['count']),
        distinctXtreamIdCount: nonNegativeInteger(row['distinctXtreamIdCount']),
        invalidCategoryCardinalityCount: nonNegativeInteger(
            row['invalidCategoryCardinalityCount']
        ),
        invalidTitleCount: nonNegativeInteger(row['invalidTitleCount']),
        maxXtreamId: nullableInteger(row['maxXtreamId']),
        minXtreamId: nullableInteger(row['minXtreamId']),
    });
}

function singleCount(value: unknown, key: string): number {
    return nonNegativeInteger(numericRecord(value, [key])[key]);
}

function statusRecord(value: unknown) {
    const row = exactRecord(value, ['live', 'movie', 'series']);
    for (const key of ['live', 'movie', 'series']) {
        if (row[key] !== null && typeof row[key] !== 'string') {
            invalid();
        }
    }
    return Object.freeze({
        live: row['live'] as string | null,
        movie: row['movie'] as string | null,
        series: row['series'] as string | null,
    });
}

function numericRecord(
    value: unknown,
    keys: readonly string[]
): Record<string, unknown> {
    return exactRecord(value, keys);
}

function exactRecord(
    value: unknown,
    expectedKeys: readonly string[]
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid();
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expectedKeys.length ||
        keys.some(
            (key) => typeof key !== 'string' || !expectedKeys.includes(key)
        )
    ) {
        invalid();
    }
    return Object.fromEntries(
        expectedKeys.map((key) => [key, Reflect.get(value, key)])
    );
}

function nonNegativeInteger(value: unknown): number {
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        invalid();
    }
    return value;
}

function nullableInteger(value: unknown): number | null {
    if (value === null) return null;
    return nonNegativeInteger(value);
}

function assertOptions(options: XtreamCatalogDatabaseReadOptions): void {
    if (
        !isPositiveFinite(options.captureStoppedEpochMs) ||
        !isAbsolute(options.dataDirectory) ||
        !isAbsolute(options.requireFromPath) ||
        options.playlistId.length === 0 ||
        options.playlistId.length > 256
    ) {
        invalid();
    }
}

function isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function invalid(): never {
    throw new Error('invalid');
}
