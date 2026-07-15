import { app } from 'electron';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import type {
    DbWorkerMessage,
    DbWorkerOperation,
} from '../workers/database-worker.types';
import { initDatabase } from '../database/connection';
import {
    isDbTraceEnabled,
    roundTraceDuration,
    summarizeForTrace,
    trace,
} from './debug-trace';
import { resolveWorkerRuntimeBootstrap } from '../workers/worker-runtime-paths';
import { createDatabaseWorkerError } from './database-worker-client.types';
import type {
    DatabaseRequestOptions,
    PendingDatabaseRequest,
} from './database-worker-client.types';

export class DatabaseWorkerClient {
    private worker: Worker | null = null;
    private readyPromise: Promise<void> | null = null;
    private readyResolve: (() => void) | null = null;
    private readyReject: ((reason?: unknown) => void) | null = null;
    private pendingRequests = new Map<string, PendingDatabaseRequest>();
    private shuttingDown = false;

    constructor(
        private readonly waitForDatabase: () => Promise<unknown> = () =>
            initDatabase()
    ) {}

    async request<TResult>(
        operation: DbWorkerOperation,
        payload: unknown,
        options?: DatabaseRequestOptions
    ): Promise<TResult> {
        this.assertAcceptingRequests();
        await this.waitForDatabase();
        this.assertAcceptingRequests();
        await this.ensureWorker();
        this.assertAcceptingRequests();

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

            this.worker?.postMessage({
                type: 'request',
                requestId,
                operation,
                payload,
            });
        });
    }

    async cancel(operationId: string): Promise<{ success: boolean }> {
        if (!operationId) {
            return { success: false };
        }

        this.assertAcceptingRequests();
        await this.waitForDatabase();
        this.assertAcceptingRequests();
        await this.ensureWorker();
        this.assertAcceptingRequests();
        this.worker?.postMessage({
            type: 'cancel',
            operationId,
        });

        return { success: true };
    }

    async shutdown(): Promise<void> {
        if (this.shuttingDown) {
            return;
        }

        this.shuttingDown = true;
        const shutdownError = new Error('Database worker shut down');
        this.readyReject?.(shutdownError);
        this.readyResolve = null;
        this.readyReject = null;
        this.readyPromise = null;
        this.rejectAllPending(shutdownError);

        if (!this.worker) {
            return;
        }

        const currentWorker = this.worker;
        this.worker = null;
        await currentWorker.terminate();
    }

    private async ensureWorker(): Promise<void> {
        this.assertAcceptingRequests();
        if (this.worker && this.readyPromise) {
            return this.readyPromise;
        }

        this.createWorker();
        await this.readyPromise;
        this.assertAcceptingRequests();
    }

    private createWorker(): void {
        this.assertAcceptingRequests();
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

            const worker = new Worker(workerURL, {
                workerData: {
                    nativeModuleSearchPaths: bootstrap.nativeModuleSearchPaths,
                },
            });
            this.worker = worker;
        } catch (error) {
            this.readyReject?.(error);
            this.resetWorkerState();
            throw error;
        }

        const worker = this.worker;
        worker.on('message', (message: DbWorkerMessage) => {
            if (this.worker === worker) this.handleMessage(message);
        });
        worker.on('error', (error) => {
            this.handleWorkerFailure(worker, error);
        });
        worker.on('exit', (code) => {
            this.handleWorkerExit(worker, code);
        });
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
            createDatabaseWorkerError(
                message.error ?? { message: 'Database worker request failed' }
            )
        );
    }

    private handleWorkerFailure(worker: Worker, error: Error): void {
        if (this.worker !== worker) return;
        if (isDbTraceEnabled()) {
            trace('db-worker', 'error', error);
        }

        if (this.readyReject) {
            this.readyReject(error);
        }

        this.resetWorkerState();
        this.rejectAllPending(error);
    }

    private handleWorkerExit(worker: Worker, code: number): void {
        if (this.shuttingDown || this.worker !== worker) {
            return;
        }

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

    private assertAcceptingRequests(): void {
        if (this.shuttingDown) {
            throw new Error('Database worker shut down');
        }
    }
}

export const databaseWorkerClient = new DatabaseWorkerClient();
