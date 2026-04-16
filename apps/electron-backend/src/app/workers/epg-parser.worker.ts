import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { getIptvnatorDatabasePath } from 'database-path-utils';
import { Readable } from 'stream';
import { parentPort, workerData } from 'worker_threads';
import { createGunzip } from 'zlib';
import {
    ParsedChannel,
    ParsedProgram,
    StreamingEpgParser,
} from './epg-streaming-parser';
import { shouldGunzipEpgResponse } from './epg-response-utils';
import {
    getNativeModuleSearchPaths,
    getWorkerDataNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
} from './worker-runtime-paths';

let Database: typeof BetterSqlite3;

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
        loggerLabel: '[EPG Worker]',
        searchPaths: nativeModuleSearchPaths,
        fallbackRequire: () =>
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('better-sqlite3') as typeof BetterSqlite3,
    });
}

Database = loadBetterSqlite3();

/**
 * Streaming EPG Parser Worker
 * Uses SAX parsing to process XML incrementally without loading entire file into memory.
 * Supports both regular and gzipped EPG files.
 * Performs database operations directly to avoid blocking the main thread.
 */

interface WorkerMessage {
    type: 'FETCH_EPG' | 'FORCE_FETCH' | 'CLEAR_EPG';
    url?: string;
}

interface WorkerResponse {
    type:
        | 'EPG_COMPLETE'
        | 'EPG_ERROR'
        | 'EPG_PROGRESS'
        | 'CLEAR_COMPLETE'
        | 'READY';
    error?: string;
    url?: string;
    stats?: {
        totalChannels: number;
        totalPrograms: number;
    };
}

const loggerLabel = '[EPG Worker]';

// Batch size for database inserts
const CHANNEL_BATCH_SIZE = 100;
const PROGRAM_BATCH_SIZE = 1000;

/**
 * Database helper class for EPG operations
 * Creates its own connection to avoid blocking main thread
 */
class EpgDatabase {
    private db: BetterSqlite3.Database;
    private knownChannelIds: Set<string> = new Set();

    // Prepared statements for better performance
    private insertChannelStmt: BetterSqlite3.Statement;
    private insertProgramStmt: BetterSqlite3.Statement;
    private deleteChannelsStmt: BetterSqlite3.Statement;

    constructor() {
        const dbPath = getIptvnatorDatabasePath();
        this.db = new Database(dbPath);
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL'); // Better concurrent write performance
        this.db.pragma('busy_timeout = 5000');

        // Prepare statements
        // Use INSERT OR REPLACE to update existing channels and refresh updated_at
        // Use strftime with ISO format for consistent date comparison
        this.insertChannelStmt = this.db.prepare(`
            INSERT INTO epg_channels (id, display_name, icon_url, url, source_url, updated_at)
            VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                icon_url = excluded.icon_url,
                url = excluded.url,
                source_url = excluded.source_url,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        `);

        this.insertProgramStmt = this.db.prepare(`
            INSERT INTO epg_programs (channel_id, start, stop, title, description, category, icon_url, rating, episode_num)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.deleteChannelsStmt = this.db.prepare(`
            DELETE FROM epg_channels WHERE source_url = ?
        `);
    }

    /**
     * Clear existing EPG data for a source URL
     */
    clearSourceData(sourceUrl: string): void {
        this.deleteChannelsStmt.run(sourceUrl);
        this.knownChannelIds.clear();
    }

    /**
     * Insert a batch of channels
     */
    insertChannels(channels: ParsedChannel[], sourceUrl: string): void {
        const insertMany = this.db.transaction((channels: ParsedChannel[]) => {
            for (const channel of channels) {
                const displayName =
                    channel.displayName?.[0]?.value || channel.id;
                const iconUrl = channel.icon?.[0]?.src || null;
                const url = channel.url?.[0] || null;

                this.insertChannelStmt.run(
                    channel.id,
                    displayName,
                    iconUrl,
                    url,
                    sourceUrl
                );
                this.knownChannelIds.add(channel.id);
            }
        });

        insertMany(channels);
    }

    /**
     * Insert a batch of programs
     * Only inserts programs for known channels to avoid FK constraint failures
     */
    insertPrograms(programs: ParsedProgram[]): number {
        let insertedCount = 0;

        const insertMany = this.db.transaction((programs: ParsedProgram[]) => {
            for (const prog of programs) {
                // Skip if channel not known
                if (!this.knownChannelIds.has(prog.channel)) continue;

                const title = prog.title?.[0]?.value || 'Unknown';
                const description = prog.desc?.[0]?.value || null;
                const category = prog.category?.[0]?.value || null;
                const iconUrl = prog.icon?.[0]?.src || null;
                const rating = prog.rating?.[0]?.value || null;
                const episodeNum = prog.episodeNum?.[0]?.value || null;

                try {
                    this.insertProgramStmt.run(
                        prog.channel,
                        prog.start,
                        prog.stop,
                        title,
                        description,
                        category,
                        iconUrl,
                        rating,
                        episodeNum
                    );
                    insertedCount++;
                } catch (err) {
                    // Skip individual failures (e.g., FK constraint)
                }
            }
        });

        insertMany(programs);
        return insertedCount;
    }

    /**
     * Close the database connection
     */
    close(): void {
        this.db.close();
    }
}

/**
 * Fetches and parses EPG data from URL using streaming
 * Inserts directly into SQLite to avoid blocking main thread
 */
async function fetchAndParseEpgStreaming(url: string): Promise<void> {
    console.log(loggerLabel, `Fetching EPG from ${url}`);

    // Create database connection in worker
    const epgDb = new EpgDatabase();

    try {
        // Clear existing data for this source
        console.log(loggerLabel, `Clearing existing data for ${url}`);
        epgDb.clearSourceData(url);

        const response = await fetch(url.trim());
        const isGzipped = shouldGunzipEpgResponse(url, response);

        if (response.url && response.url !== url) {
            console.log(
                loggerLabel,
                `Resolved EPG redirect: ${url} -> ${response.url}`
            );
        }

        console.log(
            loggerLabel,
            `EPG response detected as gzipped: ${isGzipped}`
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        const parser = new StreamingEpgParser(
            (channels) => {
                // Insert channels directly into database
                epgDb.insertChannels(channels, url);
            },
            (programs) => {
                // Insert programs directly into database
                epgDb.insertPrograms(programs);
            },
            (totalChannels, totalPrograms) => {
                // Send progress to main thread (lightweight)
                const response: WorkerResponse = {
                    type: 'EPG_PROGRESS',
                    stats: { totalChannels, totalPrograms },
                };
                parentPort?.postMessage(response);
            },
            CHANNEL_BATCH_SIZE,
            PROGRAM_BATCH_SIZE
        );

        // Convert web stream to Node.js stream
        const nodeStream = Readable.fromWeb(response.body as any);

        return new Promise((resolve, reject) => {
            let dataStream: Readable = nodeStream;

            if (isGzipped) {
                const gunzip = createGunzip();
                dataStream = nodeStream.pipe(gunzip);

                gunzip.on('error', (err) => {
                    console.error(loggerLabel, 'Gunzip error:', err);
                    epgDb.close();
                    reject(err);
                });
            }

            dataStream.on('data', (chunk: Buffer) => {
                try {
                    parser.write(chunk.toString('utf-8'));
                } catch (err) {
                    console.error(loggerLabel, 'Parse error:', err);
                    epgDb.close();
                    reject(err);
                }
            });

            dataStream.on('end', () => {
                try {
                    const stats = parser.finish();
                    console.log(
                        loggerLabel,
                        `Parsing complete: ${stats.totalChannels} channels, ${stats.totalPrograms} programs`
                    );

                    // Close database connection
                    epgDb.close();

                    const response: WorkerResponse = {
                        type: 'EPG_COMPLETE',
                        url,
                        stats: {
                            totalChannels: stats.totalChannels,
                            totalPrograms: stats.totalPrograms,
                        },
                    };
                    parentPort?.postMessage(response);
                    resolve();
                } catch (err) {
                    epgDb.close();
                    reject(err);
                }
            });

            dataStream.on('error', (err) => {
                console.error(loggerLabel, 'Stream error:', err);
                epgDb.close();
                reject(err);
            });
        });
    } catch (error) {
        epgDb.close();
        throw error;
    }
}

/**
 * Clears all EPG data from the database
 * Runs in worker thread to avoid blocking main thread
 */
function clearAllEpgData(): void {
    const dbPath = getIptvnatorDatabasePath();
    const db = new Database(dbPath);

    try {
        console.log(loggerLabel, 'Clearing all EPG data...');

        // Delete programs first (foreign key constraint)
        db.exec('DELETE FROM epg_programs');
        // Then delete channels
        db.exec('DELETE FROM epg_channels');

        console.log(loggerLabel, 'All EPG data cleared');

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        console.error(loggerLabel, 'Error clearing EPG data:', error);
        const errorResponse: WorkerResponse = {
            type: 'EPG_ERROR',
            error: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorResponse);
    } finally {
        db.close();
    }
}

/**
 * Worker message handler
 */
if (parentPort) {
    parentPort.on('message', async (message: WorkerMessage) => {
        try {
            if (
                message.type === 'FETCH_EPG' ||
                message.type === 'FORCE_FETCH'
            ) {
                await fetchAndParseEpgStreaming(message.url!);
            } else if (message.type === 'CLEAR_EPG') {
                clearAllEpgData();
            }
        } catch (error) {
            console.error(loggerLabel, 'Worker error:', error);
            const errorResponse: WorkerResponse = {
                type: 'EPG_ERROR',
                error: error instanceof Error ? error.message : String(error),
                url: message.url,
            };
            parentPort?.postMessage(errorResponse);
        }
    });

    // Notify parent that worker is ready
    parentPort.postMessage({ type: 'READY' });
} else {
    console.error(loggerLabel, 'parentPort is not available!');
}
