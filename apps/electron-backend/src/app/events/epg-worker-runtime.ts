import { epgLogger } from '../util/epg-logger';
import { app } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';

interface ClearWorkerMessage {
    type: 'CLEAR_EPG' | 'CLEAR_EPG_SOURCE';
    sourceUrl?: string;
}

/** Worker bootstrap, shutdown and one-shot cache-clear protocol. */
export class EpgWorkerRuntime {
    constructor(
        private readonly loggerLabel: string,
        private readonly fetchTimeoutMs: number
    ) {}

    runClearWorker(options: {
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
                epgLogger.error(
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
                const errorMessage = `${options.timeoutLabel} timed out after ${
                    this.fetchTimeoutMs / 1000
                }s`;
                epgLogger.error(this.loggerLabel, errorMessage);
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
                        epgLogger.error(
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
                epgLogger.error(
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
                epgLogger.error(this.loggerLabel, errorMessage);
                settle(() => reject(new Error(errorMessage)));
            });
        });
    }

    /**
     * Awaits worker shutdown so callers can sequence work (e.g. the next DB
     * access) after the thread has really exited. Termination failures are
     * logged and swallowed — there is nothing actionable left to do.
     */
    async terminateWorker(worker: Worker, context: string): Promise<void> {
        try {
            await worker.terminate();
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                `Failed to terminate ${context} worker:`,
                error
            );
        }
    }

    createEpgWorker(): Worker {
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
