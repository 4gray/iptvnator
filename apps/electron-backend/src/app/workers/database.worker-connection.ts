import type BetterSqlite3 from 'better-sqlite3';
import * as schema from 'database-schema';
import { getIptvnatorDatabasePath } from 'database-path-utils';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { workerData } from 'worker_threads';
import type { AppDatabase } from '../database/database.types';

let Database: typeof BetterSqlite3;

function loadBetterSqlite3(): typeof BetterSqlite3 {
    if (
        workerData &&
        typeof workerData === 'object' &&
        'nativeModulesPath' in workerData &&
        typeof workerData.nativeModulesPath === 'string' &&
        existsSync(workerData.nativeModulesPath)
    ) {
        try {
            const nativeRequire = createRequire(
                join(workerData.nativeModulesPath, 'index.js')
            );
            return nativeRequire('better-sqlite3');
        } catch (error) {
            console.error(
                '[DB Worker] Failed to load better-sqlite3 from workerData path:',
                error
            );
        }
    }

    if (
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ) {
        const resourcesPath = (
            process as NodeJS.Process & { resourcesPath?: string }
        ).resourcesPath!;
        const unpackedPath = join(
            resourcesPath,
            'app.asar.unpacked',
            'node_modules'
        );

        if (existsSync(unpackedPath)) {
            try {
                const nativeRequire = createRequire(join(unpackedPath, 'index.js'));
                return nativeRequire('better-sqlite3');
            } catch (error) {
                console.error(
                    '[DB Worker] Failed to load better-sqlite3 from resourcesPath:',
                    error
                );
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('better-sqlite3');
}

Database = loadBetterSqlite3();

let db: AppDatabase | null = null;
let sqlite: BetterSqlite3.Database | null = null;

export async function getWorkerDatabase(): Promise<AppDatabase> {
    if (db) {
        return db;
    }

    const filePath = getIptvnatorDatabasePath();
    sqlite = new Database(filePath);
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');

    db = drizzle(sqlite, { schema });
    return db;
}

export function closeWorkerDatabase(): void {
    if (!sqlite) {
        return;
    }

    sqlite.close();
    sqlite = null;
    db = null;
}
