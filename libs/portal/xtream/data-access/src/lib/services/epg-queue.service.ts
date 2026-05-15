import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import { XtreamApiService, XtreamCredentials } from './xtream-api.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';
import { createLogger } from '@iptvnator/portal/shared/util';

interface CacheEntry {
    data: EpgItem[];
    timestamp: number;
}

/**
 * Per-stream metadata supplied at enqueue time. The `epgChannelId` is the
 * key used to look the channel up in the locally-parsed XMLTV when the
 * Xtream provider returns no programs for that stream.
 */
export interface EpgQueueEntry {
    streamId: number;
    epgChannelId?: string | null;
}

/**
 * Throttled EPG request queue with concurrency control, inter-request
 * delay, and in-memory caching.  Prevents Xtream providers from
 * rate-limiting / banning the client when scrolling through large
 * channel lists.
 *
 * On each `enqueue()`, the service first batch-fetches the locally
 * parsed XMLTV current-program for every entry that has an
 * `epgChannelId` (one IPC, one SQL query). Hits are used immediately,
 * either as the answer (when `preferUploadedEpgOverXtream` is on) or as
 * a fallback when the per-stream Xtream API call returns no programs.
 *
 * Because the XMLTV pre-fetch is async, two overlapping `enqueue` calls
 * (e.g. fast viewport scroll) could otherwise interleave and let an
 * older call commit stale queue state. A generation counter gates every
 * shared-state write behind a "still latest" check so only the most
 * recent call's results are applied.
 */
@Injectable({ providedIn: 'root' })
export class EpgQueueService implements OnDestroy {
    private readonly apiService = inject(XtreamApiService);
    private readonly fallbackService = inject(XtreamXmltvFallbackService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly logger = createLogger('EpgQueueService');
    private readonly previewLimit = 3;

    private readonly cache = new Map<number, CacheEntry>();
    private queue: number[] = [];
    private readonly inFlight = new Set<number>();
    private readonly epgChannelByStreamId = new Map<number, string>();
    private readonly xmltvPreviewByStreamId = new Map<number, EpgItem>();
    private visibleSet = new Set<number>();
    private processing = false;
    private enqueueGeneration = 0;
    private readonly failureTimestamps = new Map<number, number>();

    private readonly maxConcurrency = 2;
    private readonly delayMs = 200;
    private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    private readonly failureCooldownMs = 60 * 1000;

    /** Emits EPG results as they arrive. */
    readonly epgResult$ = new Subject<{ streamId: number; items: EpgItem[] }>();

    getCached(streamId: number): EpgItem[] | null {
        const entry = this.cache.get(streamId);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.cacheTtlMs) {
            this.cache.delete(streamId);
            return null;
        }
        return entry.data;
    }

    private isFailureCoolingDown(streamId: number): boolean {
        const timestamp = this.failureTimestamps.get(streamId);
        if (timestamp == null) {
            return false;
        }

        if (Date.now() - timestamp > this.failureCooldownMs) {
            this.failureTimestamps.delete(streamId);
            return false;
        }

        return true;
    }

    private shouldFetch(streamId: number): boolean {
        return (
            this.getCached(streamId) === null &&
            !this.isFailureCoolingDown(streamId) &&
            !this.inFlight.has(streamId)
        );
    }

    /**
     * Enqueue stream IDs for EPG fetching.
     *
     * Accepts the legacy `number[]` shape (without `epgChannelId`) for
     * backward compatibility — those entries skip the XMLTV fallback.
     */
    async enqueue(
        streams: ReadonlyArray<EpgQueueEntry | number>,
        visibleIds: Set<number>,
        credentials: XtreamCredentials
    ): Promise<void> {
        const generation = ++this.enqueueGeneration;

        const normalized: EpgQueueEntry[] = streams.map((entry) =>
            typeof entry === 'number' ? { streamId: entry } : { ...entry }
        );

        const streamsByEpgId = new Map<string, number[]>();
        for (const entry of normalized) {
            const id = entry.epgChannelId?.trim();
            if (!id) continue;
            const list = streamsByEpgId.get(id) ?? [];
            list.push(entry.streamId);
            streamsByEpgId.set(id, list);
        }

        // Make the latest viewport visible to any currently running queue
        // before the async XMLTV prefetch returns, so stale queued provider
        // requests are dropped immediately on fast scroll.
        this.visibleSet = new Set(visibleIds);
        this.queue = [];

        const batchResult = await this.fetchXmltvCurrentPure(
            Array.from(streamsByEpgId.keys())
        );

        if (generation !== this.enqueueGeneration) return;

        // Atomic commit block — no awaits below.
        this.pruneEphemeralMaps(this.visibleSet);

        for (const entry of normalized) {
            const id = entry.epgChannelId?.trim();
            if (id) {
                this.epgChannelByStreamId.set(entry.streamId, id);
            } else {
                this.epgChannelByStreamId.delete(entry.streamId);
            }
            this.xmltvPreviewByStreamId.delete(entry.streamId);
        }
        for (const [epgChannelId, item] of Object.entries(batchResult)) {
            const streams = streamsByEpgId.get(epgChannelId) ?? [];
            for (const streamId of streams) {
                this.xmltvPreviewByStreamId.set(streamId, item);
            }
        }

        const preferUploaded =
            this.settingsStore.preferUploadedEpgOverXtream?.() ?? false;

        const ids: number[] = [];
        for (const entry of normalized) {
            if (!this.shouldFetch(entry.streamId)) continue;

            if (preferUploaded) {
                const xmltv = this.xmltvPreviewByStreamId.get(entry.streamId);
                if (xmltv) {
                    this.recordSuccess(entry.streamId, [xmltv]);
                    continue;
                }
            }

            ids.push(entry.streamId);
        }

        this.queue = ids;

        if (!this.processing) {
            this.processQueue(credentials);
        }
    }

    /**
     * Pure XMLTV batch fetch. Runs the IPC and returns the result without
     * mutating any shared state — keeping the await out of the commit
     * path so an older overlapping enqueue cannot pollute the maps after
     * a newer one has already committed.
     */
    private async fetchXmltvCurrentPure(
        epgChannelIds: ReadonlyArray<string>
    ): Promise<Record<string, EpgItem>> {
        if (epgChannelIds.length === 0) return {};
        return this.fallbackService.getCurrentProgramsBatch(epgChannelIds);
    }

    private pruneEphemeralMaps(visibleIds: Set<number>): void {
        for (const id of [...this.epgChannelByStreamId.keys()]) {
            // getCached() honors TTL and lazily evicts expired entries;
            // a raw cache.has() would keep stale previews alive forever.
            if (!visibleIds.has(id) && this.getCached(id) === null) {
                this.epgChannelByStreamId.delete(id);
                this.xmltvPreviewByStreamId.delete(id);
            }
        }
    }

    private async processQueue(credentials: XtreamCredentials): Promise<void> {
        this.processing = true;

        while (this.queue.length > 0) {
            if (this.inFlight.size >= this.maxConcurrency) {
                await this.delay(this.delayMs);
                continue;
            }

            const streamId = this.queue.shift();
            if (streamId == null) {
                continue;
            }

            if (!this.visibleSet.has(streamId)) continue;
            if (!this.shouldFetch(streamId)) continue;

            this.inFlight.add(streamId);
            this.fetchEpg(credentials, streamId);

            await this.delay(this.delayMs);
        }

        this.processing = false;
    }

    private async fetchEpg(
        credentials: XtreamCredentials,
        streamId: number
    ): Promise<void> {
        try {
            const apiItems = await this.apiService.getShortEpg(
                credentials,
                streamId,
                this.previewLimit,
                { suppressErrorLog: true }
            );

            if (apiItems.length > 0) {
                this.recordSuccess(streamId, apiItems);
                return;
            }

            const xmltv = this.xmltvPreviewByStreamId.get(streamId);
            this.recordSuccess(streamId, xmltv ? [xmltv] : []);
        } catch (error) {
            this.failureTimestamps.set(streamId, Date.now());
            this.logger.error(
                `Failed to load EPG for stream ${streamId}`,
                error
            );
        } finally {
            this.inFlight.delete(streamId);
        }
    }

    private recordSuccess(streamId: number, items: EpgItem[]): void {
        const previous = this.cache.get(streamId)?.data;
        this.cache.set(streamId, { data: items, timestamp: Date.now() });
        this.failureTimestamps.delete(streamId);

        if (previous && previous.length === 0 && items.length === 0) {
            return;
        }
        this.epgResult$.next({ streamId, items });
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    ngOnDestroy(): void {
        this.epgResult$.complete();
    }
}
