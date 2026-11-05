import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { __databaseConnectionTestHooks } from '@iptvnator/shared/database';
import type {
    DbWorkerOperation,
    DbWorkerResponseMessage,
} from './database-worker.types';

describe('database worker in a packaged resource layout', () => {
    it.each([false, true])(
        'loads sources with SQLite available only in app.asar.unpacked (minify=%s)',
        async (minify) => {
            const directory = mkdtempSync(
                join(tmpdir(), 'iptvnator-packaged-db-')
            );
            let worker: Worker | undefined;
            try {
                const nativeModules = join(
                    directory,
                    'app.asar.unpacked',
                    'node_modules'
                );
                cpSync(
                    dirname(require.resolve('better-sqlite3/package.json')),
                    join(nativeModules, 'better-sqlite3'),
                    { recursive: true }
                );
                const bundle = join(
                    directory,
                    'dist',
                    'apps',
                    'electron-backend',
                    'workers',
                    'database.worker.js'
                );
                buildSync({
                    entryPoints: [
                        resolve(
                            'apps/electron-backend/src/app/workers/database.worker.ts'
                        ),
                    ],
                    outfile: bundle,
                    bundle: true,
                    platform: 'node',
                    target: 'node18',
                    format: 'cjs',
                    external: ['better-sqlite3'],
                    tsconfig: resolve('tsconfig.base.json'),
                    minify,
                });

                const dataRoot = join(directory, 'data');
                const profile = 'a'.repeat(64);
                const original = seedPlaylist(
                    join(dataRoot, 'databases'),
                    'original'
                );
                seedPlaylist(
                    join(dataRoot, 'server-profiles', profile, 'databases'),
                    'server'
                );
                const originalBytes = readFileSync(original);
                worker = new Worker(bundle, {
                    execArgv: [],
                    env: {
                        ...process.env,
                        NODE_PATH: '',
                        IPTVNATOR_E2E_DATA_DIR: dataRoot,
                        IPTVNATOR_SOURCE_PROFILE: profile,
                        IPTVNATOR_PERF_CAPTURE: '0',
                    },
                    workerData: { nativeModuleSearchPaths: [nativeModules] },
                });
                expect(await nextMessage(worker)).toEqual({ type: 'ready' });
                const metas = await request(
                    worker,
                    'DB_GET_APP_PLAYLIST_METAS'
                );
                expect(metas).toMatchObject({
                    success: true,
                    result: [{ _id: 'server' }],
                });
                const sources = await request(
                    worker,
                    'DB_GET_STANDALONE_SOURCES'
                );
                expect(sources).toMatchObject({
                    success: true,
                    result: [
                        { _id: 'original', favorites: ['saved-favorite'] },
                    ],
                });
                expect(readFileSync(original)).toEqual(originalBytes);
            } finally {
                await worker?.terminate();
                rmSync(directory, { recursive: true, force: true });
            }
        },
        30_000
    );
});

function seedPlaylist(directory: string, id: string): string {
    mkdirSync(directory, { recursive: true });
    const filename = join(directory, 'iptvnator.db');
    const sqlite = new Database(filename);
    try {
        const statement =
            __databaseConnectionTestHooks.createTableStatements.find((sql) =>
                sql.startsWith('CREATE TABLE IF NOT EXISTS playlists')
            );
        if (!statement) throw new Error('Missing playlists schema');
        sqlite.exec(statement);
        sqlite
            .prepare(
                'INSERT INTO playlists (id, name, type, favorites) VALUES (?, ?, ?, ?)'
            )
            .run(id, 'Saved source', 'm3u-url', '["saved-favorite"]');
    } finally {
        sqlite.close();
    }
    return filename;
}

async function nextMessage(worker: Worker): Promise<unknown> {
    const [message] = await once(worker, 'message', {
        signal: AbortSignal.timeout(15_000),
    });
    return message;
}

async function request(
    worker: Worker,
    operation: DbWorkerOperation
): Promise<DbWorkerResponseMessage> {
    const response = nextMessage(worker);
    worker.postMessage({
        type: 'request',
        requestId: operation,
        operation,
        payload: {},
    });
    return (await response) as DbWorkerResponseMessage;
}
