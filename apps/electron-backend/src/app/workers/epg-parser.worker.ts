import { epgLogger } from '../util/epg-logger';
import type BetterSqlite3 from 'better-sqlite3';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    ElectronBridgeSecurityErrorCode,
    ElectronBridgeTrustOptions,
} from '@iptvnator/shared/interfaces';
import { parentPort, workerData } from 'worker_threads';
import type { Readable } from 'node:stream';
import {
    EpgDatabase,
    EpgDatabaseClearOperation,
    EpgDatabaseSourceClearOperation,
} from './epg-database';
import { openEpgSourceStream } from './epg-source-stream';
import { applyElectronNetworkDefaults } from '../util/network-defaults';
import { StreamingEpgParser } from './epg-streaming-parser';
import { UnsafeUrlError } from '../events/url-safety';
import {
    getHostnameFromErrorUrl,
    getHostnameFromUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import {
    getNativeModuleSearchPaths,
    getWorkerDataNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
} from './worker-runtime-paths';

const nativeModuleSearchPaths = [
    ...getWorkerDataNativeModuleSearchPaths(workerData),
    ...getNativeModuleSearchPaths({
        resourcesPath: (process as NodeJS.Process & { resourcesPath?: string })
            .resourcesPath,
    }),
];

registerNativeModuleSearchPaths(nativeModuleSearchPaths);

function loadBetterSqlite3(): typeof BetterSqlite3 {
    return loadNativeModuleFromSearchPaths({
        moduleName: 'better-sqlite3',
        loggerLabel: '[EPG Worker]',
        searchPaths: nativeModuleSearchPaths,
        fallbackRequire: () =>
            require('better-sqlite3') as typeof BetterSqlite3,
    });
}

const Database = loadBetterSqlite3();

/**
 * Streaming EPG Parser Worker
 * Uses SAX parsing to process XML incrementally without loading entire file into memory.
 * Supports both regular and gzipped EPG files.
 * Performs database operations directly to avoid blocking the main thread.
 */

interface WorkerMessage {
    type: 'FETCH_EPG' | 'FORCE_FETCH' | 'CLEAR_EPG' | 'CLEAR_EPG_SOURCE';
    url?: string;
    sourceUrl?: string;
    options?: ElectronBridgeTrustOptions;
}

interface WorkerResponse {
    type:
        | 'EPG_COMPLETE'
        | 'EPG_ERROR'
        | 'EPG_PROGRESS'
        | 'CLEAR_COMPLETE'
        | 'READY';
    error?: string;
    errorCode?: ElectronBridgeSecurityErrorCode;
    errorHost?: string;
    url?: string;
    stats?: {
        totalChannels: number;
        totalPrograms: number;
    };
}

// Worker threads keep their own Node networking defaults; see the helper.
applyElectronNetworkDefaults();

const loggerLabel = '[EPG Worker]';

// Batch size for database inserts
const CHANNEL_BATCH_SIZE = 100;
const PROGRAM_BATCH_SIZE = 1000;

/**
 * Fetches and parses EPG data from URL using streaming
 * Inserts directly into SQLite to avoid blocking main thread
 */
async function fetchAndParseEpgStreaming(
    url: string,
    options: ElectronBridgeTrustOptions = {}
): Promise<void> {
    epgLogger.log(loggerLabel, 'Fetching EPG source');

    // Create database connection in worker
    const epgDb = new EpgDatabase(Database);

    let decodedStream: Readable | undefined;
    let stats: ReturnType<StreamingEpgParser['finish']>;

    try {
        decodedStream = await openEpgSourceStream(url, options);
        const staged = epgDb.createImport(url);

        const parser = new StreamingEpgParser(
            (channels) => staged.insertChannels(channels),
            (programs) => staged.insertPrograms(programs),
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

        // Decode after decompression, retaining partial UTF-8 sequences
        // between chunks and flushing the decoder before the end event.
        const dataStream = decodedStream.setEncoding('utf8');
        stats = await new Promise<ReturnType<StreamingEpgParser['finish']>>(
            (resolve, reject) => {
                dataStream.on('data', (chunk: string) => {
                    try {
                        parser.write(chunk);
                    } catch (err) {
                        epgLogger.error(loggerLabel, 'Parse error:', err);
                        reject(err);
                        dataStream.destroy();
                    }
                });

                dataStream.on('end', () => {
                    try {
                        resolve(parser.finish());
                    } catch (err) {
                        reject(err);
                    }
                });

                dataStream.on('error', (err) => {
                    epgLogger.error(loggerLabel, 'Stream error:', err);
                    reject(err);
                });
            }
        );
        if (stats.totalChannels === 0) {
            throw new Error(
                'EPG parse produced 0 channels — feed may be unreachable or unsupported'
            );
        }
        // Publish all batches, source metadata and freshness together. A SQL
        // failure rolls back the replacement; parsing never changes live rows.
        staged.commit();
    } catch (error) {
        throw toEpgFetchError(error, url);
    } finally {
        decodedStream?.destroy();
        epgDb.close();
    }
    epgLogger.log(
        loggerLabel,
        `Parsing complete: ${stats.totalChannels} channels, ${stats.totalPrograms} programs`
    );
    const response: WorkerResponse = { type: 'EPG_COMPLETE', url, stats };
    parentPort?.postMessage(response);
}

function toEpgFetchError(
    error: unknown,
    url: string
): Error & {
    code?: ElectronBridgeSecurityErrorCode;
    host?: string;
} {
    if (
        error instanceof UnsafeUrlError &&
        /private|local network/i.test(error.message)
    ) {
        return Object.assign(
            new Error('EPG source points to private network and was blocked.'),
            {
                code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked,
                host: getHostnameFromUrl(url),
            }
        );
    }

    if (isInvalidTlsCertificateError(error)) {
        return Object.assign(
            new Error('Certificate for this source host is invalid.'),
            {
                code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
                host: getHostnameFromErrorUrl(error, url),
            }
        );
    }

    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Clears all EPG data from the database
 * Runs in worker thread to avoid blocking main thread
 */
function clearAllEpgData(): void {
    const clearOperation = new EpgDatabaseClearOperation(Database);

    try {
        epgLogger.log(loggerLabel, 'Clearing all EPG data...');

        clearOperation.run();

        epgLogger.log(loggerLabel, 'All EPG data cleared');

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        epgLogger.error(loggerLabel, 'Error clearing EPG data:', error);
        const errorResponse: WorkerResponse = {
            type: 'EPG_ERROR',
            error: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorResponse);
    } finally {
        clearOperation.close();
    }
}

function clearEpgDataForSource(sourceUrl: string): void {
    const clearOperation = new EpgDatabaseSourceClearOperation(Database);

    try {
        epgLogger.log(loggerLabel, 'Clearing EPG data for source...');

        clearOperation.run(sourceUrl);

        epgLogger.log(loggerLabel, 'EPG data cleared for source');

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        epgLogger.error(loggerLabel, 'Error clearing EPG source data:', error);
        const errorResponse: WorkerResponse = {
            type: 'EPG_ERROR',
            error: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorResponse);
    } finally {
        clearOperation.close();
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
                await fetchAndParseEpgStreaming(message.url!, message.options);
            } else if (message.type === 'CLEAR_EPG') {
                clearAllEpgData();
            } else if (message.type === 'CLEAR_EPG_SOURCE') {
                clearEpgDataForSource(message.sourceUrl ?? '');
            }
        } catch (error) {
            epgLogger.error(loggerLabel, 'Worker error:', error);
            const typedError = error as {
                code?: ElectronBridgeSecurityErrorCode;
                host?: string;
            };
            const errorResponse: WorkerResponse = {
                type: 'EPG_ERROR',
                error: error instanceof Error ? error.message : String(error),
                errorCode: typedError.code,
                errorHost: typedError.host,
                url: message.url,
            };
            parentPort?.postMessage(errorResponse);
        }
    });

    // Notify parent that worker is ready
    parentPort.postMessage({ type: 'READY' });
} else {
    epgLogger.error(loggerLabel, 'parentPort is not available!');
}
