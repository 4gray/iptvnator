import { signal } from '@angular/core';

interface QueuedDownloadListLoad {
    readonly operation: () => Promise<void>;
    readonly promise: Promise<void>;
    readonly resolve: () => void;
    readonly reject: (reason?: unknown) => void;
}

export class DownloadListLoadState {
    private activeLoad?: Promise<void>;
    private queuedLoad?: QueuedDownloadListLoad;
    private readonly loading = signal(false);
    private readonly loaded = signal(false);
    private readonly authoritative = signal(false);

    readonly isLoading = this.loading.asReadonly();
    readonly hasLoaded = this.loaded.asReadonly();
    readonly hasAuthoritativeList = this.authoritative.asReadonly();

    markSucceeded(): void {
        this.authoritative.set(true);
        this.loaded.set(true);
    }

    markFailed(): void {
        this.authoritative.set(false);
        this.loaded.set(true);
    }

    run(operation: () => Promise<void>): Promise<void> {
        if (!this.activeLoad) {
            return this.start(operation);
        }

        if (!this.queuedLoad) {
            this.queuedLoad = this.createQueuedLoad(operation);
        }
        return this.queuedLoad.promise;
    }

    private start(operation: () => Promise<void>): Promise<void> {
        this.loading.set(true);
        const activeLoad = operation();
        this.activeLoad = activeLoad;
        void activeLoad.then(
            () => this.finish(activeLoad),
            () => this.finish(activeLoad)
        );
        return activeLoad;
    }

    private finish(activeLoad: Promise<void>): void {
        if (this.activeLoad !== activeLoad) {
            return;
        }

        this.activeLoad = undefined;
        const queuedLoad = this.queuedLoad;
        this.queuedLoad = undefined;
        if (!queuedLoad) {
            this.loading.set(false);
            return;
        }

        const nextLoad = this.start(queuedLoad.operation);
        void nextLoad.then(queuedLoad.resolve, queuedLoad.reject);
    }

    private createQueuedLoad(
        operation: () => Promise<void>
    ): QueuedDownloadListLoad {
        let resolve!: () => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<void>((promiseResolve, promiseReject) => {
            resolve = promiseResolve;
            reject = promiseReject;
        });
        return { operation, promise, resolve, reject };
    }
}
