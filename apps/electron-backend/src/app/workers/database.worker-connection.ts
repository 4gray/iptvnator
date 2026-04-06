import type BetterSqlite3 from 'better-sqlite3';
import * as schema from 'database-schema';
import { getIptvnatorDatabasePath } from 'database-path-utils';
import { workerData } from 'worker_threads';
import type { AppDatabase } from '../database/database.types';
import {
    getNativeModuleSearchPaths,
    getWorkerDataNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
} from './worker-runtime-paths';
import {
    compactSqlForTrace,
    isSqlTraceEnabled,
    trace,
} from '../services/debug-trace';

let Database: typeof BetterSqlite3;
let drizzleFactory:
    | (typeof import('drizzle-orm/better-sqlite3'))['drizzle']
    | undefined;

const nativeModuleSearchPaths = [
    ...getWorkerDataNativeModuleSearchPaths(workerData),
    ...getNativeModuleSearchPaths({
        resourcesPath: (
            process as NodeJS.Process & { resourcesPath?: string }
        ).resourcesPath,
    }),
];

registerNativeModuleSearchPaths(nativeModuleSearchPaths);

function loadBetterSqlite3(): typeof BetterSqlite3 {
    return loadNativeModuleFromSearchPaths({
        moduleName: 'better-sqlite3',
        loggerLabel: '[DB Worker]',
        searchPaths: nativeModuleSearchPaths,
        fallbackRequire: () =>
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('better-sqlite3') as typeof BetterSqlite3,
    });
}

function getDrizzleFactory(): (typeof import('drizzle-orm/better-sqlite3'))['drizzle'] {
    if (drizzleFactory) {
        return drizzleFactory;
    }

    // Require drizzle only after native lookup paths have been registered.
    // Its better-sqlite3 driver resolves the native package at module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    drizzleFactory = require('drizzle-orm/better-sqlite3').drizzle as (
        typeof import('drizzle-orm/better-sqlite3')
    )['drizzle'];

    return drizzleFactory;
}

Database = loadBetterSqlite3();

let db: AppDatabase | null = null;
let sqlite: BetterSqlite3.Database | null = null;

export async function getWorkerDatabase(): Promise<AppDatabase> {
    if (db) {
        return db;
    }

    const filePath = getIptvnatorDatabasePath();
    sqlite = new Database(filePath, {
        verbose: isSqlTraceEnabled()
            ? (sql: string) => {
                  trace('sql-worker', 'query', {
                      sql: compactSqlForTrace(sql),
                  });
              }
            : undefined,
    });
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');

    if (isSqlTraceEnabled()) {
        trace('sql-worker', 'open', {
            filePath,
        });
    }

    db = getDrizzleFactory()(sqlite, { schema });
    return db;
}

export function closeWorkerDatabase(): void {
    if (!sqlite) {
        return;
    }

    sqlite.close();

    if (isSqlTraceEnabled()) {
        trace('sql-worker', 'close');
    }

    sqlite = null;
    db = null;
}
