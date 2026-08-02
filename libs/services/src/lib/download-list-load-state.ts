import { signal } from '@angular/core';

export class DownloadListLoadState {
    private requestId = 0;
    private settledRequestId = 0;
    private readonly settlementWaiters = new Map<number, () => void>();
    private readonly loading = signal(false);
    private readonly loaded = signal(false);
    private readonly authoritative = signal(false);

    readonly isLoading = this.loading.asReadonly();
    readonly hasLoaded = this.loaded.asReadonly();
    readonly hasAuthoritativeList = this.authoritative.asReadonly();

    begin(): number {
        this.loading.set(true);
        return ++this.requestId;
    }

    isLatest(requestId: number): boolean {
        return requestId === this.requestId;
    }

    markSucceeded(): void {
        this.authoritative.set(true);
        this.loaded.set(true);
    }

    markFailed(): void {
        this.authoritative.set(false);
        this.loaded.set(true);
    }

    async finishOrJoinLatest(requestId: number): Promise<void> {
        if (!this.isLatest(requestId)) {
            await this.waitForSettlementAtOrAfter(requestId);
            return;
        }

        this.loading.set(false);
        this.settledRequestId = requestId;
        for (const [minimumRequestId, resolve] of this.settlementWaiters) {
            if (minimumRequestId <= requestId) {
                this.settlementWaiters.delete(minimumRequestId);
                resolve();
            }
        }
    }

    private waitForSettlementAtOrAfter(requestId: number): Promise<void> {
        if (this.settledRequestId >= requestId) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.settlementWaiters.set(requestId, resolve);
        });
    }
}
