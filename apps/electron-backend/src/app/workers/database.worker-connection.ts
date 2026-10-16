import type BetterSqlite3 from 'better-sqlite3';
import * as schema from '@iptvnator/shared/database/schema';
import { getIptvnatorDatabasePath } from '@iptvnator/shared/database/path-utils';
import { parentPort, workerData } from 'worker_threads';
import type { AppDatabase } from '../database/database.types';
import {
    getNativeModuleSearchPaths,
    getWorkerDataNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
} from './worker-runtime-paths';
import {
    isSqlStatementCountEnabled,
    isSqlTraceEnabled,
    trace,
    traceSqlStatement,
} from '../services/debug-trace';
import {
    countSqlStatementExecutions,
    createSqlStatementCountReporter,
} from './database-worker-sql-statement-count';

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
            require('better-sqlite3') as typeof BetterSqlite3,
    });
}

function getDrizzleFactory(): (typeof import('drizzle-orm/better-sqlite3'))['drizzle'] {
    if (drizzleFactory) {
        return drizzleFactory;
    }

    // Require drizzle only after native lookup paths have been registered.
    // Its better-sqlite3 driver resolves the native package at module load time.
    drizzleFactory = require('drizzle-orm/better-sqlite3').drizzle as (
        typeof import('drizzle-orm/better-sqlite3')
    )['drizzle'];

    return drizzleFactory;
}

const Database = loadBetterSqlite3();

let db: AppDatabase | null = null;
let sqlite: BetterSqlite3.Database | null = null;

// IPTVNATOR_PERF_CAPTURE=1 with IPTVNATOR_PERF_COUNT_SQL=1 only: the main
// process keeps the running total.
const sqlStatementCount = isSqlStatementCountEnabled()
    ? createSqlStatementCountReporter((message) =>
          parentPort?.postMessage(message)
      )
    : null;

/**
 * Posts the statements counted since the last flush. The worker calls this
 * before every other message so a response never overtakes its statements.
 */
export function flushWorkerSqlStatementCount(): void {
    sqlStatementCount?.flush();
}

export async function getWorkerDatabase(): Promise<AppDatabase> {
    if (db) {
        return db;
    }

    const filePath = getIptvnatorDatabasePath();
    sqlite = new Database(filePath, {
        verbose: isSqlTraceEnabled()
            ? (sql: string) => traceSqlStatement('sql-worker', sql)
            : undefined,
    });
    if (sqlStatementCount) {
        countSqlStatementExecutions(sqlite, sqlStatementCount.record);
    }
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('cache_size = -64000');
    sqlite.pragma('temp_store = MEMORY');
    sqlite.pragma('mmap_size = 268435456');

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

    try {
        sqlite.pragma('optimize');
    } catch {
        // Optimize is advisory; never block close on it.
    }

    sqlite.close();

    if (isSqlTraceEnabled()) {
        trace('sql-worker', 'close');
    }

    sqlite = null;
    db = null;
}
