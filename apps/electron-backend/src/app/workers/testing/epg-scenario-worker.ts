import type Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

/** Run the real bundled parser; the optional barrier pauses a live transaction. */
export async function runScenarioWorker(
    bundle: string,
    source: string,
    sqlite: Database.Database,
    cancel: 'download' | 'publish' | undefined
) {
    const entry = `${bundle}.entry.cjs`;
    writeFileSync(
        entry,
        `
        const { parentPort, workerData } = require('node:worker_threads');
        const Database = require(workerData.nativeModuleSearchPaths[0] + '/better-sqlite3');
        let metrics;
        const transaction = Database.prototype.transaction;
        Database.prototype.transaction = function(fn) {
            const db = this;
            const run = transaction.call(db, fn);
            return (...args) => {
                if (args.length || db.inTransaction) return run(...args);
                const started = performance.now();
                const stagedBytes = db.pragma('temp.page_count', { simple: true }) *
                    db.pragma('temp.page_size', { simple: true });
                const result = run(...args);
                metrics = { publicationMs: performance.now() - started, stagedBytes,
                    tempStore: db.pragma('temp_store', { simple: true }),
                    heapUsed: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss };
                return result;
            };
        };
        const post = parentPort.postMessage.bind(parentPort);
        parentPort.postMessage = (message) => post(
            message.type === 'EPG_COMPLETE' ? { ...message, testMetrics: metrics } : message
        );
        if (workerData.publishBarrier) {
            const prepare = Database.prototype.prepare;
            Database.prototype.prepare = function(sql) {
                const statement = prepare.call(this, sql);
                if (sql.startsWith('INSERT INTO epg_programs (')) {
                    const run = statement.run.bind(statement);
                    statement.run = (...args) => {
                        if (args[3] === 'New 1000') {
                            parentPort.postMessage({ type: 'TEST_PUBLISH_BARRIER' });
                            Atomics.wait(new Int32Array(workerData.publishBarrier), 0, 0);
                        }
                        return run(...args);
                    };
                }
                return statement;
            };
        }
        require(${JSON.stringify(bundle)});
    `
    );
    const worker = new Worker(entry, {
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 64 },
        workerData: {
            nativeModuleSearchPaths: [resolve('node_modules')],
            publishBarrier:
                cancel === 'publish' ? new SharedArrayBuffer(4) : undefined,
        },
    });
    let progressEvents = 0;
    let workerError: string | undefined;
    let readDuringPublish: unknown;
    let metrics:
        | {
              publicationMs: number;
              stagedBytes: number;
              tempStore: number;
              heapUsed: number;
              rss: number;
          }
        | undefined;
    const started = performance.now();
    try {
        const outcome = await new Promise<string>((resolveOutcome, reject) => {
            const timer = setTimeout(
                () => reject(new Error('EPG worker timed out')),
                90000
            );
            const finish = (type: string) => {
                clearTimeout(timer);
                resolveOutcome(type);
            };
            worker.on('message', (message) => {
                if (message.type === 'READY') {
                    worker.postMessage({
                        type: 'FETCH_EPG',
                        url: source,
                        options: source.startsWith('http')
                            ? { trustedPrivateNetworkEpgUrls: [source] }
                            : { allowLocalFile: true },
                    });
                } else if (message.type === 'EPG_PROGRESS') {
                    progressEvents++;
                    if (
                        cancel === 'download' &&
                        message.stats.totalPrograms >= 1000
                    ) {
                        // Staging must leave the live database writable.
                        sqlite.pragma('user_version = 1');
                        finish('CANCELLED');
                    }
                } else if (message.type === 'TEST_PUBLISH_BARRIER') {
                    // A separate WAL reader must still see the previous guide.
                    readDuringPublish = sqlite
                        .prepare(
                            'SELECT title FROM epg_programs ORDER BY title'
                        )
                        .all();
                    finish('CANCELLED');
                } else if (
                    message.type === 'EPG_COMPLETE' ||
                    message.type === 'EPG_ERROR'
                ) {
                    workerError = message.error;
                    metrics = message.testMetrics;
                    finish(message.type);
                }
            });
            worker.on('error', (error) => {
                workerError = error.message;
                finish('WORKER_ERROR');
            });
            worker.on('exit', () => finish('WORKER_EXIT'));
        });
        return {
            outcome,
            progressEvents,
            workerError,
            readDuringPublish,
            metrics,
            durationMs: performance.now() - started,
        };
    } finally {
        await worker.terminate();
    }
}
