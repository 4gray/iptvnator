import { signal } from '@angular/core';

export class DownloadListLoadState {
    private requestId = 0;
    private readonly loading = signal(false);
    private readonly loaded = signal(false);
    private readonly authoritative = signal(false);

    readonly isLoading = this.loading.asReadonly();
    readonly hasLoaded = this.loaded.asReadonly();
    readonly hasAuthoritativeList = this.authoritative.asReadonly();

    begin(): number {
        this.loading.set(true);
        this.authoritative.set(false);
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
        this.loaded.set(true);
    }

    finish(): void {
        this.loading.set(false);
    }
}
