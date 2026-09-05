import { epgLogger } from '../util/epg-logger';
import {
    epgSourceGeneration,
    requestEpgSource,
    retireEpgSource,
} from './epg-source-generation';
import { BrowserWindow } from 'electron';
import { EpgWorkerRuntime } from './epg-worker-runtime';
import { runEpgFetch } from './epg-fetch-operation';
import { Worker } from 'worker_threads';
import {
    ElectronBridgeSecurityErrorCode,
    ElectronBridgeTrustOptions,
} from '@iptvnator/shared/interfaces';

export type EpgProgressStatus =
    'queued' | 'loading' | 'complete' | 'error' | 'cancelled';

export interface EpgProgressStats {
    totalChannels: number;
    totalPrograms: number;
}

export class EpgWorkerService {
    private readonly fetchedUrls = new Set<string>();
    private readonly workers = new Map<string, Worker>();
    private readonly inFlightFetches = new Map<string, Promise<void>>();
    private readonly inFlightSourceClears = new Map<string, Promise<void>>();

    private readonly runtime: EpgWorkerRuntime;

    constructor(
        private readonly loggerLabel = '[EPG Events]',
        private readonly fetchTimeoutMs = 5 * 60 * 1000
    ) {
        this.runtime = new EpgWorkerRuntime(loggerLabel, fetchTimeoutMs);
    }

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
        errorHost?: string,
        generation = epgSourceGeneration(url)
    ): void {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
            win.webContents.send('EPG_PROGRESS_UPDATE', {
                url,
                generation,
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
        url = url.trim();
        const generation = requestEpgSource(url);
        const clear = this.inFlightSourceClears.get(url);
        if (clear) {
            await clear.catch(() => undefined);
            if (generation !== epgSourceGeneration(url)) {
                this.sendProgressToRenderer(
                    url,
                    'cancelled',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    generation
                );
                return;
            }
            return this.fetchEpgFromUrl(url, options);
        }
        // A second request for an URL that is already being fetched must not
        // spawn a competing worker: both would parse and write the same EPG
        // data, and the late one would overwrite the early one's entry in
        // `workers`, leaking that worker. Share the in-flight promise instead.
        // Checked before the fetched-URL shortcut: a completed fetch is added
        // to `fetchedUrls` while its worker is still terminating, and callers
        // must keep awaiting that termination window.
        const inFlight = this.inFlightFetches.get(url);
        if (inFlight) {
            epgLogger.log(this.loggerLabel, 'Reusing in-flight EPG fetch');
            return inFlight;
        }

        if (this.fetchedUrls.has(url)) {
            epgLogger.log(
                this.loggerLabel,
                'Skipping already fetched EPG source'
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
        return runEpgFetch(url, options, {
            runtime: this.runtime,
            workers: this.workers,
            fetchedUrls: this.fetchedUrls,
            loggerLabel: this.loggerLabel,
            fetchTimeoutMs: this.fetchTimeoutMs,
            sendProgressToRenderer: this.sendProgressToRenderer.bind(this),
        });
    }

    async clearEpgData(): Promise<void> {
        return this.runtime.runClearWorker({
            timeoutLabel: 'EPG clear',
            exitLabel: 'Clear worker',
            readyMessage: { type: 'CLEAR_EPG' },
            completeWorkerLabel: 'completed clear',
            failedWorkerLabel: 'failed clear',
            erroredWorkerLabel: 'errored clear',
            onComplete: async (worker) => {
                epgLogger.log(this.loggerLabel, 'EPG data cleared via worker');
                this.fetchedUrls.clear();
                // Resolve only after every interrupted fetch worker has exited
                // too — they may still hold the SQLite lock the caller expects
                // to be free.
                const terminations = [...this.workers.values()].map(
                    (runningWorker) =>
                        this.runtime.terminateWorker(
                            runningWorker,
                            'fetch during clear'
                        )
                );
                this.workers.clear();
                terminations.push(
                    this.runtime.terminateWorker(worker, 'completed clear')
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

        retireEpgSource(normalizedSourceUrl);
        this.fetchedUrls.delete(normalizedSourceUrl);
        const previous = this.inFlightSourceClears.get(normalizedSourceUrl);
        const operation = previous
            ? previous
                  .catch(() => undefined)
                  .then(() => this.startSourceClear(normalizedSourceUrl))
            : this.startSourceClear(normalizedSourceUrl);
        const clear = operation.finally(() => {
            if (this.inFlightSourceClears.get(normalizedSourceUrl) === clear)
                this.inFlightSourceClears.delete(normalizedSourceUrl);
        });
        this.inFlightSourceClears.set(normalizedSourceUrl, clear);
        return clear;
    }

    private async startSourceClear(normalizedSourceUrl: string): Promise<void> {
        const inFlight = this.inFlightFetches.get(normalizedSourceUrl);
        const runningWorker = this.workers.get(normalizedSourceUrl);
        if (runningWorker) {
            this.workers.delete(normalizedSourceUrl);
            await this.runtime.terminateWorker(runningWorker, 'source clear');
        }
        // Error/timeout handlers may already have removed the worker from the
        // lookup, but its fetch promise still owns asynchronous termination.
        if (inFlight) await inFlight.catch(() => undefined);

        return this.runtime.runClearWorker({
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
                epgLogger.log(
                    this.loggerLabel,
                    'EPG data cleared for source via worker'
                );
                this.fetchedUrls.delete(normalizedSourceUrl);
                await this.runtime.terminateWorker(
                    worker,
                    'completed source clear'
                );
            },
        });
    }
}

export const epgWorkerService = new EpgWorkerService();
