import type { Worker } from 'worker_threads';
import type {
    ElectronBridgeSecurityErrorCode,
    ElectronBridgeTrustOptions,
} from '@iptvnator/shared/interfaces';
import { epgSourceGeneration } from './epg-source-generation';
import type { EpgWorkerRuntime } from './epg-worker-runtime';
import type { EpgProgressStats, EpgWorkerService } from './epg-worker.service';

interface EpgWorkerMessage {
    type: string;
    error?: string;
    errorCode?: ElectronBridgeSecurityErrorCode;
    errorHost?: string;
    url?: string;
    stats?: EpgProgressStats;
}

interface FetchContext {
    runtime: EpgWorkerRuntime;
    workers: Map<string, Worker>;
    fetchedUrls: Set<string>;
    loggerLabel: string;
    fetchTimeoutMs: number;
    sendProgressToRenderer: EpgWorkerService['sendProgressToRenderer'];
}

/** One import's message, cancellation, timeout and exit lifecycle. */
export function runEpgFetch(
    url: string,
    options: ElectronBridgeTrustOptions,
    context: FetchContext
): Promise<void> {
    const generation = epgSourceGeneration(url);
    return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
            worker = context.runtime.createEpgWorker();
        } catch (error) {
            console.error(
                context.loggerLabel,
                'Failed to create worker:',
                error
            );
            reject(error);
            return;
        }

        context.workers.set(url, worker);

        // Guards against double-settling and keeps the outer loop moving
        // when the worker dies or hangs without sending EPG_COMPLETE/EPG_ERROR.
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let lastProgressStats: EpgProgressStats = {
            totalChannels: 0,
            totalPrograms: 0,
        };

        const clearFetchTimeout = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
        };

        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearFetchTimeout();
            fn();
        };

        const cancelIfRetired = (exited = false): boolean => {
            if (generation === epgSourceGeneration(url)) return false;
            if (context.workers.get(url) === worker)
                context.workers.delete(url);
            settle(() => {
                context.sendProgressToRenderer(
                    url,
                    'cancelled',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    generation
                );
                if (exited) resolve();
                else
                    void context.runtime
                        .terminateWorker(worker, 'retired fetch')
                        .then(() => resolve());
            });
            return true;
        };

        const scheduleFetchTimeout = () => {
            clearFetchTimeout();
            timeoutId = setTimeout(() => {
                handleFetchTimeout();
            }, context.fetchTimeoutMs);
        };

        const hasProgressMoved = (stats: EpgProgressStats): boolean =>
            stats.totalChannels > lastProgressStats.totalChannels ||
            stats.totalPrograms > lastProgressStats.totalPrograms;

        const recordProgress = (stats: EpgProgressStats): void => {
            lastProgressStats = {
                totalChannels: Math.max(
                    lastProgressStats.totalChannels,
                    stats.totalChannels
                ),
                totalPrograms: Math.max(
                    lastProgressStats.totalPrograms,
                    stats.totalPrograms
                ),
            };
        };

        const handleFetchTimeout = () => {
            if (settled || cancelIfRetired()) return;
            const errorMessage = `EPG fetch timed out after ${
                context.fetchTimeoutMs / 1000
            }s without progress`;
            console.error(context.loggerLabel, `${errorMessage}: ${url}`);
            context.sendProgressToRenderer(
                url,
                'error',
                undefined,
                errorMessage
            );
            context.workers.delete(url);
            // Settle only after the worker thread is really gone: a
            // terminated-but-still-running worker can keep holding the
            // SQLite lock and block the next EPG fetch.
            settle(() => {
                void context.runtime
                    .terminateWorker(worker, 'timed out fetch')
                    .then(() => reject(new Error(errorMessage)));
            });
        };

        scheduleFetchTimeout();

        worker.on('message', async (message: EpgWorkerMessage) => {
            if (settled || generation !== epgSourceGeneration(url)) return;
            try {
                switch (message.type) {
                    case 'READY':
                        scheduleFetchTimeout();
                        context.sendProgressToRenderer(url, 'loading', {
                            totalChannels: 0,
                            totalPrograms: 0,
                        });
                        worker.postMessage({
                            type: 'FETCH_EPG',
                            url,
                            options,
                        });
                        break;

                    case 'EPG_PROGRESS':
                        if (message.stats) {
                            if (hasProgressMoved(message.stats)) {
                                recordProgress(message.stats);
                                scheduleFetchTimeout();
                            }
                            context.sendProgressToRenderer(
                                url,
                                'loading',
                                message.stats
                            );
                        }
                        break;

                    case 'EPG_COMPLETE':
                        console.log(
                            context.loggerLabel,
                            `EPG parsing complete for ${url}:`,
                            message.stats
                        );
                        context.sendProgressToRenderer(
                            url,
                            'complete',
                            message.stats
                        );
                        context.fetchedUrls.add(url);
                        context.workers.delete(url);
                        settle(() => {
                            void context.runtime
                                .terminateWorker(worker, 'completed fetch')
                                .then(() => resolve());
                        });
                        break;

                    case 'EPG_ERROR':
                        console.error(
                            context.loggerLabel,
                            'Worker error:',
                            message.error
                        );
                        context.sendProgressToRenderer(
                            url,
                            'error',
                            undefined,
                            message.error,
                            undefined,
                            message.errorCode,
                            message.errorHost
                        );
                        context.workers.delete(url);
                        settle(() => {
                            void context.runtime
                                .terminateWorker(worker, 'failed fetch')
                                .then(() =>
                                    reject(
                                        new Error(
                                            message.error || 'Unknown error'
                                        )
                                    )
                                );
                        });
                        break;
                }
            } catch (err) {
                if (settled || cancelIfRetired()) return;
                console.error(
                    context.loggerLabel,
                    'Error handling message:',
                    err
                );
                context.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    err instanceof Error ? err.message : String(err)
                );
                context.workers.delete(url);
                settle(() => {
                    void context.runtime
                        .terminateWorker(worker, 'failed message handling')
                        .then(() => reject(err));
                });
            }
        });

        worker.on('error', (error) => {
            if (settled || cancelIfRetired()) return;
            console.error(context.loggerLabel, 'Worker error event:', error);
            context.sendProgressToRenderer(
                url,
                'error',
                undefined,
                error.message
            );
            context.workers.delete(url);
            settle(() => {
                void context.runtime
                    .terminateWorker(worker, 'errored fetch')
                    .then(() => reject(error));
            });
        });

        worker.on('exit', (code) => {
            if (settled || cancelIfRetired(true)) return;
            const errorMessage = `Worker exited unexpectedly (code ${code})`;
            console.error(context.loggerLabel, `${errorMessage}: ${url}`);
            context.sendProgressToRenderer(
                url,
                'error',
                undefined,
                errorMessage
            );
            context.workers.delete(url);
            settle(() => reject(new Error(errorMessage)));
        });
    });
}
