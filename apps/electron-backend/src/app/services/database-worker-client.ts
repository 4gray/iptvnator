import { app } from 'electron';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { getParentalLockActive } from './parental-lock-state';
import { Worker } from 'worker_threads';
import type {
    DbOperationEvent,
    DbWorkerMessage,
    DbWorkerOperation,
} from '../workers/database-worker.types';
import {
    isDbTraceEnabled,
    performanceCounters,
    roundTraceDuration,
    summarizeForTrace,
    trace,
} from './debug-trace';
import { PERFORMANCE_COUNTER } from './performance-counters';
import {
    DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE,
    readSqlStatementsMessageCount,
} from '../workers/database-worker-sql-statement-count';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';
import {
    DB_WORKER_CLOSE_TIMEOUT_MS,
    DB_WORKER_DRAIN_TIMEOUT_MS,
    waitForSettled,
    waitForWorkerExit,
} from './database-worker-drain';

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    onEvent?: (event: DbOperationEvent) => void;
    operation: DbWorkerOperation;
    startedAt: number;
};

type RequestOptions = {
    onEvent?: (event: DbOperationEvent) => void;
};

type CloseTimeouts = {
    /** Budget for requests already accepted to finish. */
    drainMs: number;
    /** Budget for the worker to close SQLite and exit on its own. */
    closeMs: number;
};

const noop = () => undefined;

function createWorkerError(error: {
    message: string;
    name?: string;
    stack?: string;
}): Error {
    const workerError = new Error(error.message);
    workerError.name = error.name || 'DatabaseWorkerError';
    workerError.stack = error.stack || workerError.stack;
    return workerError;
}

export class DatabaseWorkerClient {
    private worker: Worker | null = null;
    private readyPromise: Promise<void> | null = null;
    private readyResolve: (() => void) | null = null;
    private readyReject: ((reason?: unknown) => void) | null = null;
    private pendingRequests = new Map<string, PendingRequest>();
    /** Settles with each request, including ones still awaiting readiness. */
    private readonly acceptedRequests = new Set<Promise<unknown>>();
    private closing: Promise<void> | null = null;
    private closed = false;

    constructor(
        private readonly closeTimeouts: CloseTimeouts = {
            drainMs: DB_WORKER_DRAIN_TIMEOUT_MS,
            closeMs: DB_WORKER_CLOSE_TIMEOUT_MS,
        }
    ) {}

    request<TResult>(
        operation: DbWorkerOperation,
        payload: unknown,
        options?: RequestOptions
    ): Promise<TResult> {
        const result = this.dispatchRequest<TResult>(
            operation,
            payload,
            options
        );
        const settled = result.then(noop, noop);
        this.acceptedRequests.add(settled);
        void settled.then(() => this.acceptedRequests.delete(settled));
        return result;
    }

    private async dispatchRequest<TResult>(
        operation: DbWorkerOperation,
        payload: unknown,
        options?: RequestOptions
    ): Promise<TResult> {
        const worker = await this.ensureWorker();
        if (this.worker !== worker) {
            throw new Error('Database worker shut down or replaced');
        }

        const requestId = randomUUID();
        const startedAt = Date.now();

        if (isDbTraceEnabled()) {
            trace('db-request', 'dispatch', {
                operation,
                payload: summarizeForTrace(payload),
                requestId,
            });
        }

        return new Promise<TResult>((resolve, reject) => {
            this.pendingRequests.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                onEvent: options?.onEvent,
                operation,
                startedAt,
            });

            worker.postMessage({
                type: 'request',
                requestId,
                operation,
                payload,
            });
        });
    }

    /**
     * Flips the worker's parental lock filter. Awaits readiness so the
     * message is never lost to a worker that has not started, and is posted
     * on the request port so later reads observe it in order.
     */
    async setParentalLockState(active: boolean): Promise<void> {
        const worker = await this.ensureWorker();
        if (this.worker !== worker) {
            throw new Error('Database worker shut down or replaced');
        }
        worker.postMessage({
            type: 'parental-lock',
            active: active === true,
        });
    }

    async cancel(operationId: string): Promise<{ success: boolean }> {
        if (!operationId) {
            return { success: false };
        }

        const worker = await this.ensureWorker();
        if (this.worker !== worker) {
            throw new Error('Database worker shut down or replaced');
        }
        worker.postMessage({
            type: 'cancel',
            operationId,
        });

        return { success: true };
    }

    /**
     * Stops the worker at once, rejecting whatever it has not answered yet.
     * A later request starts a new worker.
     */
    async shutdown(): Promise<void> {
        const currentWorker = this.worker;
        this.detachWorker(new Error('Database worker shut down'));

        await currentWorker?.terminate();
    }

    /**
     * Closes the worker for good, for a process that is about to exit:
     * waits, within a bounded budget, for every request it already accepted
     * (a write sent just before quitting, or from the renderer's `pagehide`
     * while the drain runs), then lets the worker close SQLite before it is
     * terminated. Requests after that are rejected instead of starting a new
     * worker. Never rejects, and never waits past its budgets.
     */
    drainAndShutdown(): Promise<void> {
        this.closing ??= this.drainThenClose();
        return this.closing;
    }

    private async drainThenClose(): Promise<void> {
        await waitForSettled(this.acceptedRequests, this.closeTimeouts.drainMs);
        this.closed = true;
        const currentWorker = this.worker;
        this.detachWorker(new Error('Database worker shut down'));
        if (!currentWorker) {
            return;
        }

        currentWorker.postMessage({ type: 'close' });
        await waitForWorkerExit(currentWorker, this.closeTimeouts.closeMs);
        await currentWorker.terminate().catch(noop);
    }

    private async ensureWorker(): Promise<Worker> {
        // Closing for good: never start a worker the exiting process would
        // abandon mid-write.
        if (this.closed || (this.closing && !this.worker)) {
            throw new Error('Database worker shut down');
        }
        const worker = this.worker ?? this.createWorker();
        await this.readyPromise;
        return worker;
    }

    private createWorker(): Worker {
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: app.isPackaged,
            workerFilename: 'database.worker.js',
            developmentWorkerDir: path.join(__dirname, 'workers'),
            resourcesPath: (
                process as NodeJS.Process & { resourcesPath?: string }
            ).resourcesPath,
            appPath: app.getAppPath(),
        });

        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        try {
            const workerURL = pathToFileURL(bootstrap.workerPath);

            if (isDbTraceEnabled()) {
                trace('db-worker', 'create', {
                    nativeModuleSearchPaths:
                        bootstrap.nativeModuleSearchPaths?.length ?? 0,
                    workerPath: bootstrap.workerPath,
                });
            }

            this.worker = new Worker(workerURL, {
                workerData: {
                    nativeModuleSearchPaths: bootstrap.nativeModuleSearchPaths,
                    // Seeded here rather than requested afterwards, so a
                    // restarted worker never answers a read unfiltered while
                    // the lock state is still in flight.
                    parentalLockActive: getParentalLockActive(),
                },
            });
        } catch (error) {
            this.readyReject?.(error);
            this.resetWorkerState();
            throw error;
        }

        const currentWorker = this.worker;
        currentWorker.on('message', (message: DbWorkerMessage) => {
            if (this.worker === currentWorker) {
                this.handleMessage(message);
            }
        });
        currentWorker.on('error', (error) => {
            if (this.worker === currentWorker) {
                this.handleWorkerFailure(error);
            }
        });
        currentWorker.on('exit', (code) => {
            if (this.worker === currentWorker) {
                this.handleWorkerExit(code);
            }
        });
        return currentWorker;
    }

    private handleMessage(message: DbWorkerMessage): void {
        if (message.type === 'ready') {
            if (isDbTraceEnabled()) {
                trace('db-worker', 'ready');
            }
            this.readyResolve?.();
            this.readyResolve = null;
            this.readyReject = null;
            return;
        }

        if (message.type === 'event') {
            if (isDbTraceEnabled()) {
                trace('db-event', 'worker-event', {
                    event: message.event,
                    requestId: message.requestId,
                });
            }
            this.pendingRequests
                .get(message.requestId)
                ?.onEvent?.(message.event);
            return;
        }

        if (message.type === 'performance-cancel-received') {
            return;
        }

        if (message.type === DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE) {
            const count = readSqlStatementsMessageCount(message);
            if (count !== null) {
                performanceCounters.increment(
                    PERFORMANCE_COUNTER.SQL_STATEMENTS,
                    count
                );
            }
            return;
        }

        const pendingRequest = this.pendingRequests.get(message.requestId);
        if (!pendingRequest) {
            return;
        }

        this.pendingRequests.delete(message.requestId);

        if (message.success) {
            if (isDbTraceEnabled()) {
                trace('db-request', 'resolved', {
                    durationMs: roundTraceDuration(
                        Date.now() - pendingRequest.startedAt
                    ),
                    operation: pendingRequest.operation,
                    requestId: message.requestId,
                    result: summarizeForTrace(message.result),
                });
            }
            pendingRequest.resolve(message.result);
            return;
        }

        if (isDbTraceEnabled()) {
            trace('db-request', 'failed', {
                durationMs: roundTraceDuration(
                    Date.now() - pendingRequest.startedAt
                ),
                error: message.error,
                operation: pendingRequest.operation,
                requestId: message.requestId,
            });
        }

        pendingRequest.reject(
            createWorkerError(
                message.error ?? { message: 'Database worker request failed' }
            )
        );
    }

    private handleWorkerFailure(error: Error): void {
        if (isDbTraceEnabled()) {
            trace('db-worker', 'error', error);
        }

        if (this.readyReject) {
            this.readyReject(error);
        }

        this.resetWorkerState();
        this.rejectAllPending(error);
    }

    private handleWorkerExit(code: number): void {
        if (isDbTraceEnabled()) {
            trace('db-worker', 'exit', { code });
        }

        const error =
            code === 0
                ? new Error('Database worker exited unexpectedly')
                : new Error(`Database worker stopped with exit code ${code}`);

        if (this.readyReject) {
            this.readyReject(error);
        }

        this.resetWorkerState();
        this.rejectAllPending(error);
    }

    private detachWorker(error: Error): void {
        this.readyReject?.(error);
        this.resetWorkerState();
        this.rejectAllPending(error);
    }

    private resetWorkerState(): void {
        this.worker = null;
        this.readyPromise = null;
        this.readyResolve = null;
        this.readyReject = null;
    }

    private rejectAllPending(error: Error): void {
        const pendingRequests = [...this.pendingRequests.values()];
        this.pendingRequests.clear();

        pendingRequests.forEach((request) => {
            request.reject(error);
        });
    }
}

export const databaseWorkerClient = new DatabaseWorkerClient();
