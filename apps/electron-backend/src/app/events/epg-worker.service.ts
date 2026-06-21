import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import {
    ElectronBridgeSecurityErrorCode,
    ElectronBridgeTrustOptions,
} from '@iptvnator/shared/interfaces';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';

export type EpgProgressStatus = 'queued' | 'loading' | 'complete' | 'error';

export interface EpgProgressStats {
    totalChannels: number;
    totalPrograms: number;
}

interface EpgWorkerMessage {
    type: string;
    error?: string;
    errorCode?: ElectronBridgeSecurityErrorCode;
    errorHost?: string;
    url?: string;
    stats?: EpgProgressStats;
}

interface ClearWorkerMessage {
    type: 'CLEAR_EPG' | 'CLEAR_EPG_SOURCE';
    sourceUrl?: string;
}

export class EpgWorkerService {
    private readonly fetchedUrls = new Set<string>();
    private readonly workers = new Map<string, Worker>();
    private readonly inFlightFetches = new Map<string, Promise<void>>();

    constructor(
        private readonly loggerLabel = '[EPG Events]',
        private readonly fetchTimeoutMs = 5 * 60 * 1000
    ) {}

    hasFetchedUrl(url: string): boolean {
        return this.fetchedUrls.has(url);
    }

    markFetchedUrl(url: string): void {
        this.fetchedUrls.add(url);
    }

    deleteFetchedUrl(url: string): void {
        this.fetchedUrls.delete(url);
    }

    sendProgressToRenderer(
        url: string,
        status: EpgProgressStatus,
        stats?: EpgProgressStats,
        error?: string,
        queuePosition?: number,
        errorCode?: ElectronBridgeSecurityErrorCode,
        errorHost?: string
    ): void {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
            win.webContents.send('EPG_PROGRESS_UPDATE', {
                url,
                status,
                stats,
                error,
                queuePosition,
                errorCode,
                errorHost,
            });
        });
    }

    async fetchEpgFromUrl(
        url: string,
        options: ElectronBridgeTrustOptions = {}
    ): Promise<void> {
        // A second request for an URL that is already being fetched must not
        // spawn a competing worker: both would parse and write the same EPG
        // data, and the late one would overwrite the early one's entry in
        // `workers`, leaking that worker. Share the in-flight promise instead.
        // Checked before the fetched-URL shortcut: a completed fetch is added
        // to `fetchedUrls` while its worker is still terminating, and callers
        // must keep awaiting that termination window.
        const inFlight = this.inFlightFetches.get(url);
        if (inFlight) {
            console.log(
                this.loggerLabel,
                `Reusing in-flight EPG fetch: ${url}`
            );
            return inFlight;
        }

        if (this.fetchedUrls.has(url)) {
            console.log(
                this.loggerLabel,
                `Skipping already fetched URL: ${url}`
            );
            return;
        }

        const fetchPromise = this.startFetch(url, options).finally(() => {
            this.inFlightFetches.delete(url);
        });
        this.inFlightFetches.set(url, fetchPromise);
        return fetchPromise;
    }

    private startFetch(
        url: string,
        options: ElectronBridgeTrustOptions
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            let worker: Worker;
            try {
                worker = this.createEpgWorker();
            } catch (error) {
                console.error(
                    this.loggerLabel,
                    'Failed to create worker:',
                    error
                );
                reject(error);
                return;
            }

            this.workers.set(url, worker);

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

            const scheduleFetchTimeout = () => {
                clearFetchTimeout();
                timeoutId = setTimeout(() => {
                    handleFetchTimeout();
                }, this.fetchTimeoutMs);
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
                const errorMessage = `EPG fetch timed out after ${
                    this.fetchTimeoutMs / 1000
                }s without progress`;
                console.error(this.loggerLabel, `${errorMessage}: ${url}`);
                this.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    errorMessage
                );
                this.workers.delete(url);
                // Settle only after the worker thread is really gone: a
                // terminated-but-still-running worker can keep holding the
                // SQLite lock and block the next EPG fetch.
                settle(() => {
                    void this.terminateWorker(worker, 'timed out fetch').then(
                        () => reject(new Error(errorMessage))
                    );
                });
            };

            scheduleFetchTimeout();

            worker.on('message', async (message: EpgWorkerMessage) => {
                try {
                    switch (message.type) {
                        case 'READY':
                            scheduleFetchTimeout();
                            this.sendProgressToRenderer(url, 'loading', {
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
                                this.sendProgressToRenderer(
                                    url,
                                    'loading',
                                    message.stats
                                );
                            }
                            break;

                        case 'EPG_COMPLETE':
                            console.log(
                                this.loggerLabel,
                                `EPG parsing complete for ${url}:`,
                                message.stats
                            );
                            this.sendProgressToRenderer(
                                url,
                                'complete',
                                message.stats
                            );
                            this.fetchedUrls.add(url);
                            this.workers.delete(url);
                            settle(() => {
                                void this.terminateWorker(
                                    worker,
                                    'completed fetch'
                                ).then(() => resolve());
                            });
                            break;

                        case 'EPG_ERROR':
                            console.error(
                                this.loggerLabel,
                                'Worker error:',
                                message.error
                            );
                            this.sendProgressToRenderer(
                                url,
                                'error',
                                undefined,
                                message.error,
                                undefined,
                                message.errorCode,
                                message.errorHost
                            );
                            this.workers.delete(url);
                            settle(() => {
                                void this.terminateWorker(
                                    worker,
                                    'failed fetch'
                                ).then(() =>
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
                    console.error(
                        this.loggerLabel,
                        'Error handling message:',
                        err
                    );
                    this.sendProgressToRenderer(
                        url,
                        'error',
                        undefined,
                        err instanceof Error ? err.message : String(err)
                    );
                    this.workers.delete(url);
                    settle(() => {
                        void this.terminateWorker(
                            worker,
                            'failed message handling'
                        ).then(() => reject(err));
                    });
                }
            });

            worker.on('error', (error) => {
                console.error(this.loggerLabel, 'Worker error event:', error);
                this.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    error.message
                );
                this.workers.delete(url);
                settle(() => {
                    void this.terminateWorker(worker, 'errored fetch').then(
                        () => reject(error)
                    );
                });
            });

            worker.on('exit', (code) => {
                if (settled) return;
                const errorMessage = `Worker exited unexpectedly (code ${code})`;
                console.error(this.loggerLabel, `${errorMessage}: ${url}`);
                this.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    errorMessage
                );
                this.workers.delete(url);
                settle(() => reject(new Error(errorMessage)));
            });
        });
    }

    async clearEpgData(): Promise<void> {
        return this.runClearWorker({
            timeoutLabel: 'EPG clear',
            exitLabel: 'Clear worker',
            readyMessage: { type: 'CLEAR_EPG' },
            completeWorkerLabel: 'completed clear',
            failedWorkerLabel: 'failed clear',
            erroredWorkerLabel: 'errored clear',
            onComplete: async (worker) => {
                console.log(this.loggerLabel, 'EPG data cleared via worker');
                this.fetchedUrls.clear();
                // Resolve only after every interrupted fetch worker has exited
                // too — they may still hold the SQLite lock the caller expects
                // to be free.
                const terminations = [...this.workers.values()].map(
                    (runningWorker) =>
                        this.terminateWorker(
                            runningWorker,
                            'fetch during clear'
                        )
                );
                this.workers.clear();
                terminations.push(
                    this.terminateWorker(worker, 'completed clear')
                );
                await Promise.all(terminations);
            },
        });
    }

    async clearEpgDataForSource(sourceUrl: string): Promise<void> {
        const normalizedSourceUrl = sourceUrl.trim();
        if (!normalizedSourceUrl) {
            return;
        }

        const runningWorker = this.workers.get(normalizedSourceUrl);
        if (runningWorker) {
            this.workers.delete(normalizedSourceUrl);
            await this.terminateWorker(runningWorker, 'source clear');
        }

        return this.runClearWorker({
            timeoutLabel: 'EPG source clear',
            exitLabel: 'Source clear worker',
            readyMessage: {
                type: 'CLEAR_EPG_SOURCE',
                sourceUrl: normalizedSourceUrl,
            },
            completeWorkerLabel: 'completed source clear',
            failedWorkerLabel: 'failed source clear',
            erroredWorkerLabel: 'errored source clear',
            onComplete: async (worker) => {
                console.log(
                    this.loggerLabel,
                    `EPG data cleared for source via worker: ${normalizedSourceUrl}`
                );
                this.fetchedUrls.delete(normalizedSourceUrl);
                await this.terminateWorker(worker, 'completed source clear');
            },
        });
    }

    private runClearWorker(options: {
        timeoutLabel: string;
        exitLabel: string;
        readyMessage: ClearWorkerMessage;
        completeWorkerLabel: string;
        failedWorkerLabel: string;
        erroredWorkerLabel: string;
        onComplete: (worker: Worker) => Promise<void>;
    }): Promise<void> {
        return new Promise((resolve, reject) => {
            let worker: Worker;
            try {
                worker = this.createEpgWorker();
            } catch (error) {
                console.error(
                    this.loggerLabel,
                    'Failed to create worker for clear:',
                    error
                );
                reject(error);
                return;
            }

            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout>;
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                fn();
            };

            timeoutId = setTimeout(() => {
                const errorMessage = `${options.timeoutLabel} timed out after ${
                    this.fetchTimeoutMs / 1000
                }s`;
                console.error(this.loggerLabel, errorMessage);
                settle(() => {
                    void this.terminateWorker(
                        worker,
                        `timed out ${options.timeoutLabel}`
                    ).then(() => reject(new Error(errorMessage)));
                });
            }, this.fetchTimeoutMs);

            worker.on(
                'message',
                (message: { type: string; error?: string }) => {
                    if (message.type === 'READY') {
                        worker.postMessage(options.readyMessage);
                    } else if (message.type === 'CLEAR_COMPLETE') {
                        settle(() => {
                            void options
                                .onComplete(worker)
                                .then(() => resolve(), reject);
                        });
                    } else if (message.type === 'EPG_ERROR') {
                        console.error(
                            this.loggerLabel,
                            'Worker clear error:',
                            message.error
                        );
                        settle(() => {
                            void this.terminateWorker(
                                worker,
                                options.failedWorkerLabel
                            ).then(() =>
                                reject(
                                    new Error(message.error || 'Clear failed')
                                )
                            );
                        });
                    }
                }
            );

            worker.on('error', (error) => {
                console.error(
                    this.loggerLabel,
                    'Worker error during clear:',
                    error
                );
                settle(() => {
                    void this.terminateWorker(
                        worker,
                        options.erroredWorkerLabel
                    ).then(() => reject(error));
                });
            });

            worker.on('exit', (code) => {
                if (settled) return;
                const errorMessage = `${options.exitLabel} exited unexpectedly (code ${code})`;
                console.error(this.loggerLabel, errorMessage);
                settle(() => reject(new Error(errorMessage)));
            });
        });
    }

    /**
     * Awaits worker shutdown so callers can sequence work (e.g. the next DB
     * access) after the thread has really exited. Termination failures are
     * logged and swallowed — there is nothing actionable left to do.
     */
    private async terminateWorker(
        worker: Worker,
        context: string
    ): Promise<void> {
        try {
            await worker.terminate();
        } catch (error) {
            console.error(
                this.loggerLabel,
                `Failed to terminate ${context} worker:`,
                error
            );
        }
    }

    private createEpgWorker(): Worker {
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: app.isPackaged,
            workerFilename: 'epg-parser.worker.js',
            developmentWorkerDir: path.join(__dirname, 'workers'),
            resourcesPath: (
                process as NodeJS.Process & { resourcesPath?: string }
            ).resourcesPath,
            appPath: app.getAppPath(),
        });

        const workerURL = pathToFileURL(bootstrap.workerPath);
        return new Worker(workerURL, {
            resourceLimits: {
                maxOldGenerationSizeMb: 4096,
                maxYoungGenerationSizeMb: 512,
            },
            workerData: {
                nativeModuleSearchPaths: bootstrap.nativeModuleSearchPaths,
            },
        });
    }
}

export const epgWorkerService = new EpgWorkerService();
