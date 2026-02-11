import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { EpgItem } from 'shared-interfaces';
import { XtreamApiService, XtreamCredentials } from './xtream-api.service';

interface CacheEntry {
    data: EpgItem[];
    timestamp: number;
}

/**
 * Throttled EPG request queue with concurrency control, inter-request
 * delay, and in-memory caching.  Prevents Xtream providers from
 * rate-limiting / banning the client when scrolling through large
 * channel lists.
 */
@Injectable({ providedIn: 'root' })
export class EpgQueueService implements OnDestroy {
    private readonly apiService = inject(XtreamApiService);

    private readonly cache = new Map<number, CacheEntry>();
    private queue: number[] = [];
    private readonly inFlight = new Set<number>();
    private visibleSet = new Set<number>();
    private processing = false;

    private readonly maxConcurrency = 2;
    private readonly delayMs = 200;
    private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

    /** Emits EPG results as they arrive. */
    readonly epgResult$ = new Subject<{ streamId: number; items: EpgItem[] }>();

    /** Return cached EPG items if still valid, otherwise null. */
    getCached(streamId: number): EpgItem[] | null {
        const entry = this.cache.get(streamId);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.cacheTtlMs) {
            this.cache.delete(streamId);
            return null;
        }
        return entry.data;
    }

    /**
     * Enqueue stream IDs for EPG fetching.
     *
     * - IDs already cached or in-flight are skipped.
     * - The internal queue is replaced so that stale IDs (no longer in
     *   `visibleIds`) are dropped on next dequeue.
     */
    enqueue(
        streamIds: number[],
        visibleIds: Set<number>,
        credentials: XtreamCredentials
    ): void {
        this.visibleSet = visibleIds;

        const toFetch = streamIds.filter(
            (id) =>
                !this.getCached(id) &&
                !this.inFlight.has(id)
        );

        // Replace the queue – any previously queued but now-invisible IDs
        // will be skipped during processing via the visibleSet check.
        this.queue = toFetch;

        if (!this.processing) {
            this.processQueue(credentials);
        }
    }

    private async processQueue(credentials: XtreamCredentials): Promise<void> {
        this.processing = true;

        while (this.queue.length > 0) {
            // Wait until a concurrency slot is available
            if (this.inFlight.size >= this.maxConcurrency) {
                await this.delay(this.delayMs);
                continue;
            }

            const streamId = this.queue.shift()!;

            // Drop stale entries that are no longer visible
            if (!this.visibleSet.has(streamId)) continue;

            // Skip if it got cached while queued (e.g. duplicate)
            if (this.getCached(streamId)) continue;

            this.inFlight.add(streamId);
            this.fetchEpg(credentials, streamId);

            // Space out requests
            await this.delay(this.delayMs);
        }

        this.processing = false;
    }

    private async fetchEpg(
        credentials: XtreamCredentials,
        streamId: number
    ): Promise<void> {
        try {
            const items = await this.apiService.getShortEpg(
                credentials,
                streamId,
                1
            );
            this.cache.set(streamId, {
                data: items,
                timestamp: Date.now(),
            });
            this.epgResult$.next({ streamId, items });
        } catch (error) {
            console.error(
                `EpgQueueService: failed to load EPG for stream ${streamId}:`,
                error
            );
        } finally {
            this.inFlight.delete(streamId);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    ngOnDestroy(): void {
        this.epgResult$.complete();
    }
}
