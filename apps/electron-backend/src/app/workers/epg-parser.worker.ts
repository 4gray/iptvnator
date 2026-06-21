import type BetterSqlite3 from 'better-sqlite3';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    ElectronBridgeSecurityErrorCode,
    ElectronBridgeTrustOptions,
} from '@iptvnator/shared/interfaces';
import { Readable } from 'stream';
import { parentPort, workerData } from 'worker_threads';
import {
    EpgDatabase,
    EpgDatabaseClearOperation,
    EpgDatabaseSourceClearOperation,
} from './epg-database';
import { createDecodedEpgStream } from './epg-stream-decoder';
import { StreamingEpgParser } from './epg-streaming-parser';
import {
    getEpgResponseContentEncoding,
    shouldGunzipEpgResponse,
} from './epg-response-utils';
import {
    isPrivateNetworkUrlAccessAllowed,
    UnsafeUrlError,
} from '../events/url-safety';
import { createPlaylistAgentFactory } from '../util/secure-https';
import {
    getHostnameFromErrorUrl,
    getHostnameFromUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import { requestWithValidatedRedirects } from '../util/validated-axios';
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
    console.log(loggerLabel, `Fetching EPG from ${url}`);

    // Create database connection in worker
    const epgDb = new EpgDatabase(Database);

    // Old rows for this source are retained until the first successful insert
    // batch arrives — see `hasClearedSource` below. That way, a fetch or parse
    // that yields zero channels leaves the existing data intact instead of
    // wiping it and leaving the URL permanently stale.
    let hasClearedSource = false;

    try {
        // EPG URLs can originate from an untrusted M3U `url-tvg` attribute.
        // Validate every redirect and require an explicit operator opt-in for
        // private/LAN sources.
        const response = await requestWithValidatedRedirects<Readable>(
            url.trim(),
            {
                agentFactory: createPlaylistAgentFactory({
                    trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
                }),
                decompress: false,
                method: 'GET',
                responseType: 'stream',
            },
            {
                allowPrivateNetworks:
                    isPrivateNetworkUrlAccessAllowed() ||
                    isTrustedPrivateNetworkEpgSource(url, options),
            }
        );
        const responseUrl = response.config.url;
        const isGzipped = shouldGunzipEpgResponse(url, {
            headers: response.headers,
            url: responseUrl,
        });
        const contentEncoding = getEpgResponseContentEncoding(response.headers);

        if (responseUrl && responseUrl !== url) {
            console.log(
                loggerLabel,
                `Resolved EPG redirect: ${url} -> ${responseUrl}`
            );
        }

        console.log(
            loggerLabel,
            `EPG response detected as gzipped: ${isGzipped}`
        );
        if (contentEncoding) {
            console.log(
                loggerLabel,
                `EPG response content-encoding: ${contentEncoding}`
            );
        }

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.data) {
            throw new Error('Response body is null');
        }

        const parser = new StreamingEpgParser(
            (channels) => {
                // Clear old rows in the same transaction as the first insert
                // so we never end up with zero rows on a failed/empty parse.
                epgDb.insertChannels(channels, url, !hasClearedSource);
                hasClearedSource = true;
            },
            (programs) => {
                // Insert programs directly into database
                epgDb.insertPrograms(programs, url);
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

        return new Promise((resolve, reject) => {
            const dataStream = createDecodedEpgStream(
                response.data,
                response.headers,
                isGzipped
            );

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

                    // Treat empty results as failure rather than silently
                    // marking the URL as fetched — that causes the freshness
                    // check to re-trigger a fetch every session and hides the
                    // real problem (unreachable feed, SAX parse failure, etc.).
                    if (stats.totalChannels === 0) {
                        const errorMessage = `EPG parse produced 0 channels — feed may be unreachable or unsupported`;
                        console.error(loggerLabel, `${errorMessage}: ${url}`);
                        const response: WorkerResponse = {
                            type: 'EPG_ERROR',
                            url,
                            error: errorMessage,
                        };
                        parentPort?.postMessage(response);
                        reject(new Error(errorMessage));
                        return;
                    }

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
        throw toEpgFetchError(error, url);
    }
}

function isTrustedPrivateNetworkEpgSource(
    url: string,
    options: ElectronBridgeTrustOptions
): boolean {
    const normalizedUrl = url.trim();
    return (
        options.trustedPrivateNetworkEpgUrls?.some(
            (trustedUrl) => trustedUrl.trim() === normalizedUrl
        ) ?? false
    );
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
        console.log(loggerLabel, 'Clearing all EPG data...');

        clearOperation.run();

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
        clearOperation.close();
    }
}

function clearEpgDataForSource(sourceUrl: string): void {
    const clearOperation = new EpgDatabaseSourceClearOperation(Database);

    try {
        console.log(
            loggerLabel,
            `Clearing EPG data for source ${sourceUrl}...`
        );

        clearOperation.run(sourceUrl);

        console.log(loggerLabel, `EPG data cleared for source ${sourceUrl}`);

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        console.error(loggerLabel, 'Error clearing EPG source data:', error);
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
            console.error(loggerLabel, 'Worker error:', error);
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
    console.error(loggerLabel, 'parentPort is not available!');
}
