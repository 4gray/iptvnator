import { epgLogger } from '../util/epg-logger';
import {
    epgSourceGeneration,
    requestEpgSource,
    retireEpgSource,
    retireAllEpgSources,
} from './epg-source-generation';
import { BrowserWindow } from 'electron';
import { EpgWorkerRuntime } from './epg-worker-runtime';
import { runEpgFetch } from './epg-fetch-operation';
import { EpgFetchQueue } from './epg-fetch-queue';
import {
    DENY_ALL_EPG_LOCAL_SOURCES,
    EPG_LOCAL_SOURCE_REFUSED_MESSAGE,
    EpgLocalSourceAuthorizer,
} from './epg-local-source-authorizer';
import { resolveLocalEpgSourcePath } from '../util/epg-local-source-path';
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
    private readonly fetchQueue = new EpgFetchQueue();
    private readonly workers = new Map<string, Worker>();
    private readonly inFlightFetches = new Map<string, Promise<void>>();
    private readonly inFlightSourceClears = new Map<string, Promise<void>>();

    private readonly workerFetches = new Map<string, Promise<void>>();
    private globalClear: Promise<void> | undefined;

    waitForGlobalClear(): Promise<void> | undefined {
        return this.globalClear;
    }

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
        if (!this.globalClear) this.fetchedUrls.add(url);
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
        options: ElectronBridgeTrustOptions = {},
        force = false
    ): Promise<void> {
        url = url.trim();
        const generation = requestEpgSource(url);
        const clear = this.globalClear ?? this.inFlightSourceClears.get(url);
        if (clear) {
            await clear.catch(() => undefined);
            if (this.cancelIfRetired(url, generation)) return;
            return this.fetchEpgFromUrl(url, options, force);
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
            if (
                force &&
                this.workerFetches.has(url) &&
                !this.workers.has(url)
            ) {
                // Terminal progress has already been delivered. Sharing this
                // shutdown-only promise would strand the new request at queued.
                await inFlight.catch(() => undefined);
                if (this.cancelIfRetired(url, generation)) return;
                return this.fetchEpgFromUrl(url, options, force);
            }
            epgLogger.log(this.loggerLabel, 'Reusing in-flight EPG fetch');
            return inFlight;
        }

        if (force) this.fetchedUrls.delete(url);
        if (this.fetchedUrls.has(url)) {
            epgLogger.log(
                this.loggerLabel,
                'Skipping already fetched EPG source'
            );
            return;
        }

        const fetchPromise = this.startFetch(url, options, generation).finally(
            () => {
                if (this.inFlightFetches.get(url) === fetchPromise)
                    this.inFlightFetches.delete(url);
            }
        );
        this.inFlightFetches.set(url, fetchPromise);
        return fetchPromise;
    }

    /**
     * Gate for local XMLTV files; `epg.events.ts` installs the persisted,
     * prompting authorizer at registration. Until then every local path is
     * refused, so a missing wiring fails closed rather than open.
     */
    localSourceAuthorizer: EpgLocalSourceAuthorizer =
        DENY_ALL_EPG_LOCAL_SOURCES;

    private cancelIfRetired(url: string, generation: number): boolean {
        if (generation === epgSourceGeneration(url)) return false;
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
        return true;
    }

    private async startFetch(
        url: string,
        options: ElectronBridgeTrustOptions,
        generation: number
    ): Promise<void> {
        // The renderer's options must not be able to unlock the worker's
        // local branch: the flag is set here, only for an allowed path.
        const { allowLocalFile: _rendererFlag, ...trustOptions } =
            options as ElectronBridgeTrustOptions & {
                allowLocalFile?: unknown;
            };
        let workerOptions: ElectronBridgeTrustOptions & {
            allowLocalFile?: boolean;
        } = trustOptions;
        const localPath = resolveLocalEpgSourcePath(url);
        if (localPath) {
            const allowed =
                await this.localSourceAuthorizer.ensureAllowed(localPath);
            // The prompt can stay open for a while; a source retired
            // meanwhile (settings save, reconciliation) must end as
            // cancelled rather than start an import the clear then awaits.
            if (this.cancelIfRetired(url, generation)) return;
            if (!allowed) {
                epgLogger.log(
                    this.loggerLabel,
                    'Local EPG file was not allowed by the user'
                );
                this.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    EPG_LOCAL_SOURCE_REFUSED_MESSAGE
                );
                // A refusal is a failed fetch, not a completed one: the
                // renderer's fetch result and EPG availability must not
                // claim the file was read.
                throw new Error(EPG_LOCAL_SOURCE_REFUSED_MESSAGE);
            }
            workerOptions = { ...trustOptions, allowLocalFile: true };
        }
        return this.fetchQueue.run(() =>
            this.startWorkerFetch(url, workerOptions, generation)
        );
    }

    private async startWorkerFetch(
        url: string,
        workerOptions: ElectronBridgeTrustOptions,
        generation: number
    ): Promise<void> {
        if (this.cancelIfRetired(url, generation)) return;
        // A prior terminal fetch can settle even after its shutdown failed.
        // Retry that shutdown before admitting another SQLite writer.
        let shutdown = this.runtime.drainTerminations();
        while (shutdown) {
            try {
                await shutdown;
            } catch (error) {
                if (this.cancelIfRetired(url, generation)) return;
                this.sendProgressToRenderer(
                    url,
                    'error',
                    undefined,
                    error instanceof Error ? error.message : String(error)
                );
                throw error;
            }
            if (this.cancelIfRetired(url, generation)) return;
            shutdown = this.runtime.drainTerminations();
        }
        const workerFetch = runEpgFetch(url, workerOptions, {
            runtime: this.runtime,
            workers: this.workers,
            fetchedUrls: this.fetchedUrls,
            loggerLabel: this.loggerLabel,
            fetchTimeoutMs: this.fetchTimeoutMs,
            sendProgressToRenderer: this.sendProgressToRenderer.bind(this),
        }).finally(() => {
            if (this.workerFetches.get(url) === workerFetch)
                this.workerFetches.delete(url);
        });
        this.workerFetches.set(url, workerFetch);
        return workerFetch;
    }

    clearEpgData(): Promise<void> {
        retireAllEpgSources();
        this.fetchedUrls.clear();
        if (this.globalClear) return this.globalClear;
        // Snapshot existing source clears: later ones wait for this barrier.
        const sourceClears = [...this.inFlightSourceClears.values()];
        const operation = Promise.resolve().then(async () => {
            // Termination must succeed before deleting data. Keep failed workers
            // tracked so a subsequent clear can retry stopping them.
            await this.runtime.stopAllWorkers(this.workers.values());
            await Promise.all(
                [...this.workerFetches.values()].map((fetch) =>
                    fetch.catch(() => undefined)
                )
            );
            await Promise.all(
                sourceClears.map((clear) => clear.catch(() => undefined))
            );
            await this.runtime.stopAllWorkers([]);
            this.inFlightFetches.clear();
            this.workers.clear();
            await this.runtime.runClearWorker({
                timeoutLabel: 'EPG clear',
                exitLabel: 'Clear worker',
                readyMessage: { type: 'CLEAR_EPG' },
                completeWorkerLabel: 'completed clear',
                failedWorkerLabel: 'failed clear',
                erroredWorkerLabel: 'errored clear',
                onComplete: async (worker) => {
                    this.fetchedUrls.clear();
                    await this.runtime.stopAllWorkers([worker]);
                },
            });
        });
        const clear = operation.finally(() => {
            if (this.globalClear === clear) this.globalClear = undefined;
        });
        this.globalClear = clear;
        return clear;
    }

    async clearEpgDataForSource(sourceUrl: string): Promise<void> {
        const normalizedSourceUrl = sourceUrl.trim();
        if (!normalizedSourceUrl) {
            return;
        }

        retireEpgSource(normalizedSourceUrl);
        this.fetchedUrls.delete(normalizedSourceUrl);
        const previous = this.inFlightSourceClears.get(normalizedSourceUrl);
        const barriers = [previous, this.globalClear].filter(
            (operation): operation is Promise<void> => !!operation
        );
        const operation = barriers.length
            ? Promise.all(
                  barriers.map((barrier) => barrier.catch(() => undefined))
              ).then(() => this.startSourceClear(normalizedSourceUrl))
            : this.startSourceClear(normalizedSourceUrl);
        const clear = operation.finally(() => {
            if (this.inFlightSourceClears.get(normalizedSourceUrl) === clear)
                this.inFlightSourceClears.delete(normalizedSourceUrl);
        });
        this.inFlightSourceClears.set(normalizedSourceUrl, clear);
        return clear;
    }

    private async startSourceClear(normalizedSourceUrl: string): Promise<void> {
        const inFlight = this.workerFetches.get(normalizedSourceUrl);
        const runningWorker = this.workers.get(normalizedSourceUrl);
        if (runningWorker) {
            await this.runtime.stopAllWorkers([runningWorker]);
            this.workers.delete(normalizedSourceUrl);
        }
        // Error/timeout handlers may already have removed the worker from the
        // lookup, but its fetch promise still owns asynchronous termination.
        if (inFlight) await inFlight.catch(() => undefined);
        this.inFlightFetches.delete(normalizedSourceUrl);

        // A settled fetch/clear can still own a failed shutdown. Recheck after
        // each wait so another termination cannot be overtaken by this writer.
        let shutdown = this.runtime.drainTerminations();
        while (shutdown) {
            await shutdown;
            shutdown = this.runtime.drainTerminations();
        }
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
                await this.runtime.stopAllWorkers([worker]);
            },
        });
    }
}

export const epgWorkerService = new EpgWorkerService();
