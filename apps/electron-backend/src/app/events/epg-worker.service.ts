import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';

export type EpgProgressStatus = 'queued' | 'loading' | 'complete' | 'error';

export interface EpgProgressStats {
    totalChannels: number;
    totalPrograms: number;
}

interface EpgWorkerMessage {
    type: string;
    error?: string;
    url?: string;
    stats?: EpgProgressStats;
}

export class EpgWorkerService {
    private readonly fetchedUrls = new Set<string>();
    private readonly workers = new Map<string, Worker>();

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
        queuePosition?: number
    ): void {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
            win.webContents.send('EPG_PROGRESS_UPDATE', {
                url,
                status,
                stats,
                error,
                queuePosition,
            });
        });
    }

    async fetchEpgFromUrl(url: string): Promise<void> {
        if (this.fetchedUrls.has(url)) {
            console.log(
                this.loggerLabel,
                `Skipping already fetched URL: ${url}`
            );
            return;
        }

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
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                fn();
            };

            const timeoutId = setTimeout(() => {
                const errorMessage = `EPG fetch timed out after ${
                    this.fetchTimeoutMs / 1000
                }s`;
                console.error(this.loggerLabel, `${errorMessage}: ${url}`);
                this.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    errorMessage
                );
                worker.terminate();
                this.workers.delete(url);
                settle(() => reject(new Error(errorMessage)));
            }, this.fetchTimeoutMs);

            worker.on('message', async (message: EpgWorkerMessage) => {
                try {
                    switch (message.type) {
                        case 'READY':
                            this.sendProgressToRenderer(url, 'loading', {
                                totalChannels: 0,
                                totalPrograms: 0,
                            });
                            worker.postMessage({ type: 'FETCH_EPG', url });
                            break;

                        case 'EPG_PROGRESS':
                            if (message.stats) {
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
                            worker.terminate();
                            this.workers.delete(url);
                            settle(() => resolve());
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
                                message.error
                            );
                            worker.terminate();
                            this.workers.delete(url);
                            settle(() =>
                                reject(
                                    new Error(message.error || 'Unknown error')
                                )
                            );
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
                    worker.terminate();
                    this.workers.delete(url);
                    settle(() => reject(err));
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
                worker.terminate();
                this.workers.delete(url);
                settle(() => reject(error));
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
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                fn();
            };

            const timeoutId = setTimeout(() => {
                const errorMessage = `EPG clear timed out after ${
                    this.fetchTimeoutMs / 1000
                }s`;
                console.error(this.loggerLabel, errorMessage);
                settle(() => {
                    worker.terminate();
                    reject(new Error(errorMessage));
                });
            }, this.fetchTimeoutMs);

            worker.on(
                'message',
                (message: { type: string; error?: string }) => {
                    if (message.type === 'READY') {
                        worker.postMessage({ type: 'CLEAR_EPG' });
                    } else if (message.type === 'CLEAR_COMPLETE') {
                        settle(() => {
                            console.log(
                                this.loggerLabel,
                                'EPG data cleared via worker'
                            );
                            this.fetchedUrls.clear();
                            this.workers.forEach((runningWorker) =>
                                runningWorker.terminate()
                            );
                            this.workers.clear();
                            worker.terminate();
                            resolve();
                        });
                    } else if (message.type === 'EPG_ERROR') {
                        console.error(
                            this.loggerLabel,
                            'Worker clear error:',
                            message.error
                        );
                        settle(() => {
                            worker.terminate();
                            reject(new Error(message.error || 'Clear failed'));
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
                    worker.terminate();
                    reject(error);
                });
            });

            worker.on('exit', (code) => {
                if (settled) return;
                const errorMessage = `Clear worker exited unexpectedly (code ${code})`;
                console.error(this.loggerLabel, errorMessage);
                settle(() => reject(new Error(errorMessage)));
            });
        });
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
