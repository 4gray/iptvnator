import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
    CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY,
    CONTENT_TITLE_FTS_MIGRATION_KEY,
    contentTitleFtsStatement,
    CONTENT_TITLE_FTS_TRIGGER_STATEMENTS,
    isContentTitleFtsBuildPending,
    prepareContentTitleFts,
} from '@iptvnator/shared/database/content-title-fts';
import type { DbWorkerResponseMessage } from './database-worker.types';
import {
    CONTENT_TITLE_FTS_BUILD_MAX_FAILURES,
    runContentTitleFtsBuild,
    startContentTitleFtsBuild,
} from './content-title-fts-build';

const sqliteStub = {} as Database.Database;
const immediate = () => Promise.resolve();

describe('runContentTitleFtsBuild', () => {
    it('waits before the first batch and yields between batches until done', async () => {
        const calls: string[] = [];
        const results = ['pending', 'pending', 'done'] as const;
        const outcome = await runContentTitleFtsBuild({
            getSqlite: async () => sqliteStub,
            buildBatch: (_sqlite, batchSize) => {
                calls.push(`batch:${batchSize}`);
                return results[
                    calls.filter((c) => c.startsWith('batch')).length - 1
                ];
            },
            wait: async (ms) => {
                calls.push(`wait:${ms}`);
            },
            yieldToRequests: async () => {
                calls.push('yield');
            },
            batchSize: 7,
            startDelayMs: 11,
        });

        expect(outcome).toBe('done');
        expect(calls).toEqual([
            'wait:11',
            'batch:7',
            'yield',
            'batch:7',
            'yield',
            'batch:7',
        ]);
    });

    it('retries a failed batch, then gives up for this session', async () => {
        const log = jest.fn();
        const buildBatch = jest.fn(() => {
            throw new Error('database is locked');
        });

        const outcome = await runContentTitleFtsBuild({
            getSqlite: async () => sqliteStub,
            buildBatch,
            wait: immediate,
            yieldToRequests: immediate,
            log,
        });

        expect(outcome).toBe('failed');
        expect(buildBatch).toHaveBeenCalledTimes(
            CONTENT_TITLE_FTS_BUILD_MAX_FAILURES
        );
        expect(log).toHaveBeenLastCalledWith(
            expect.stringContaining('database is locked')
        );
    });

    it('recovers after a transient failure', async () => {
        const buildBatch = jest
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('database is locked');
            })
            .mockReturnValueOnce('pending')
            .mockReturnValueOnce('done');

        const outcome = await runContentTitleFtsBuild({
            getSqlite: async () => sqliteStub,
            buildBatch,
            wait: immediate,
            yieldToRequests: immediate,
            log: jest.fn(),
        });

        expect(outcome).toBe('done');
        expect(buildBatch).toHaveBeenCalledTimes(3);
    });

    it('runs one build at a time', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const buildBatch = jest.fn(() => 'done' as const);
        const deps = {
            getSqlite: async () => sqliteStub,
            buildBatch,
            wait: () => gate,
        };

        const first = startContentTitleFtsBuild(deps);
        const second = startContentTitleFtsBuild(deps);
        release();

        expect(second).toBe(first);
        await expect(first).resolves.toBe('done');
        expect(buildBatch).toHaveBeenCalledTimes(1);
    });
});

/**
 * The real worker bundle on a profile `initDatabase()` left a build for:
 * it answers requests while it builds, and swaps in the folded index.
 */
describe('database worker deferred title index build', () => {
    it('builds the folded index in the background and keeps answering', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'iptvnator-fts-worker-'));
        let worker: Worker | undefined;
        try {
            const bundle = join(directory, 'database.worker.js');
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
            });
            const dataRoot = join(directory, 'data');
            const filename = seedDeferredProfile(join(dataRoot, 'databases'));

            worker = new Worker(bundle, {
                execArgv: [],
                env: {
                    ...process.env,
                    IPTVNATOR_E2E_DATA_DIR: dataRoot,
                    IPTVNATOR_PERF_CAPTURE: '0',
                },
                // The bundle lives outside the repository.
                workerData: {
                    nativeModuleSearchPaths: [
                        dirname(
                            dirname(
                                require.resolve('better-sqlite3/package.json')
                            )
                        ),
                    ],
                },
            });
            await nextMessage(worker);
            worker.postMessage({ type: 'content-title-fts-build' });
            // A second request while it runs is ignored, not a second build.
            worker.postMessage({ type: 'content-title-fts-build' });

            const reader = new Database(filename, { readonly: true });
            try {
                const answered = await getAppState(worker, 'probe');
                expect(answered.success).toBe(true);
                await waitFor(() => !isContentTitleFtsBuildPending(reader));
                // A request after the swap still works.
                expect((await getAppState(worker, 'probe')).success).toBe(true);

                const live = reader
                    .prepare(
                        `SELECT sql FROM sqlite_master WHERE name = 'content_title_fts'`
                    )
                    .get() as { sql: string };
                expect(live.sql).toContain('remove_diacritics');
                const found = reader
                    .prepare(
                        `SELECT COUNT(*) AS n FROM content_title_fts
                         WHERE content_title_fts MATCH 'amelie'`
                    )
                    .get() as { n: number };
                expect(found.n).toBe(ROWS / 2);
                const markers = reader
                    .prepare(
                        `SELECT key FROM app_state WHERE value = 'done' ORDER BY key`
                    )
                    .all() as { key: string }[];
                expect(markers.map(({ key }) => key)).toEqual(
                    [
                        CONTENT_TITLE_FTS_DIACRITICS_MIGRATION_KEY,
                        CONTENT_TITLE_FTS_MIGRATION_KEY,
                    ].sort()
                );
            } finally {
                reader.close();
            }
        } finally {
            await worker?.terminate();
            rmSync(directory, { recursive: true, force: true });
        }
    }, 30_000);
});

const ROWS = 12_000;

/** A 0.22-shaped catalog, prepared as `initDatabase()` defers it. */
function seedDeferredProfile(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const filename = join(directory, 'iptvnator.db');
    const sqlite = new Database(filename);
    try {
        sqlite.pragma('journal_mode = WAL');
        sqlite.exec(`CREATE TABLE app_state (key TEXT PRIMARY KEY,
            value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`);
        sqlite.exec(`CREATE TABLE content (id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL)`);
        const insert = sqlite.prepare(`INSERT INTO content (title) VALUES (?)`);
        sqlite.transaction(() => {
            for (let id = 1; id <= ROWS; id++) {
                insert.run(id % 2 ? `Amélie ${id}` : `Synthetic ${id}`);
            }
        })();
        sqlite.exec(contentTitleFtsStatement(false));
        sqlite.exec(
            `INSERT INTO content_title_fts(content_title_fts) VALUES ('rebuild')`
        );
        for (const statement of CONTENT_TITLE_FTS_TRIGGER_STATEMENTS) {
            sqlite.exec(statement);
        }
        sqlite
            .prepare(`INSERT INTO app_state (key, value) VALUES (?, 'done')`)
            .run(CONTENT_TITLE_FTS_MIGRATION_KEY);
        expect(
            prepareContentTitleFts(sqlite, { startupRebuildLimit: 1_000 })
        ).toBe('deferred');
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

async function getAppState(
    worker: Worker,
    key: string
): Promise<DbWorkerResponseMessage> {
    const response = nextMessage(worker);
    worker.postMessage({
        type: 'request',
        requestId: key,
        operation: 'DB_GET_APP_STATE',
        payload: { key },
    });
    return (await response) as DbWorkerResponseMessage;
}

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Build did not finish');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
