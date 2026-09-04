import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import {
    buildXtreamEpgMappingKey,
    EpgItem,
    windowEpgItemsAtProviderClock,
} from '@iptvnator/shared/interfaces';
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
    /** Owning playlist — required to resolve manual EPG mappings. */
    playlistId?: string | null;
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
    /** Bumped by invalidate() so a stale in-flight result is discarded. */
    private readonly invalidationEpoch = new Map<number, number>();
    private readonly epgChannelByStreamId = new Map<number, string>();
    private readonly xmltvPreviewByStreamId = new Map<number, EpgItem>();
    private visibleSet = new Set<number>();
    private processing = false;
    private enqueueGeneration = 0;
    private readonly failureTimestamps = new Map<number, number>();
    /** Display offset every per-stream memory below was recorded under. */
    private stateOffsetMinutes = this.epgOffsetMinutes();

    private readonly maxConcurrency = 2;
    private readonly delayMs = 200;
    private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    private readonly failureCooldownMs = 60 * 1000;

    /** Emits EPG results as they arrive. */
    readonly epgResult$ = new Subject<{ streamId: number; items: EpgItem[] }>();

    getCached(streamId: number): EpgItem[] | null {
        this.retireStateOfPreviousOffset();
        const entry = this.cache.get(streamId);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.cacheTtlMs) {
            this.cache.delete(streamId);
            return null;
        }
        return entry.data;
    }

    private epgOffsetMinutes(): number {
        return this.settingsStore.resolvedEpgOffsetMinutes();
    }

    /**
     * Every per-stream memory here — cut windows, cached empty results and
     * failure cooldowns — answers "what is on at the provider clock", so a
     * changed display offset retires all of it at once instead of letting
     * one map or another keep steering the reload. Run on every entry point
     * (`enqueue`, `getCached`, `fetchEpg`); in-flight requests are retired by
     * `fetchEpg` itself when they land.
     */
    private retireStateOfPreviousOffset(): void {
        const current = this.epgOffsetMinutes();
        if (current === this.stateOffsetMinutes) {
            return;
        }
        this.stateOffsetMinutes = current;
        this.cache.clear();
        this.failureTimestamps.clear();
    }

    /**
     * Drop every cached artifact for a stream so the next enqueue refetches
     * it. Used when a manual EPG mapping for the stream changes, since the
     * cached preview/resolution was computed for the previous mapping.
     *
     * Also bumps an invalidation epoch and clears `inFlight`: a request that
     * was already running when the mapping changed carries the pre-change
     * resolution, so its result is discarded (epoch mismatch in `fetchEpg`)
     * and clearing `inFlight` lets the immediate re-enqueue schedule a fresh
     * fetch through the mapping-aware `enqueue()` path.
     */
    invalidate(streamId: number): void {
        this.cache.delete(streamId);
        this.failureTimestamps.delete(streamId);
        this.epgChannelByStreamId.delete(streamId);
        this.xmltvPreviewByStreamId.delete(streamId);
        this.inFlight.delete(streamId);
        this.invalidationEpoch.set(
            streamId,
            (this.invalidationEpoch.get(streamId) ?? 0) + 1
        );
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
        this.retireStateOfPreviousOffset();
        const generation = ++this.enqueueGeneration;

        const normalized: EpgQueueEntry[] = streams.map((entry) =>
            typeof entry === 'number' ? { streamId: entry } : { ...entry }
        );

        // Resolve manual EPG mappings before building the per-EPG-id index.
        // When the user has right-clicked a channel and created a mapping,
        // the stored key is the playlist-scoped Xtream key, not the
        // provider's epg_channel_id.  By resolving upfront we get the
        // correct EPG channel ID for the XMLTV batch call that follows.
        // Guarded so environments without the bridge (PWA) skip the await
        // entirely and the enqueue keeps its original microtask timing.
        if (typeof window.electron?.getEpgMappingsBatch === 'function') {
            await this.resolveManualMappings(normalized);
        }

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

    /**
     * Resolve manual EPG mappings for the queued entries.
     *
     * The user may have opened the mapping dialog (right-click → "Map EPG")
     * from any channel list; the stored key is the playlist-scoped Xtream
     * key, which does not match the provider's epg_channel_id, so the batch
     * IPC handler's resolveChannelIds() would miss it.  We resolve here,
     * upfront, so the XMLTV batch call later uses the *mapped* epgChannelId
     * — the actual EPG channel that carries the XMLTV data. A mapping also
     * supplies an epgChannelId to entries whose provider did not send one.
     */
    private async resolveManualMappings(
        entries: EpgQueueEntry[]
    ): Promise<void> {
        const getEpgMappingsBatch =
            typeof window.electron?.getEpgMappingsBatch === 'function'
                ? window.electron.getEpgMappingsBatch
                : null;
        if (!getEpgMappingsBatch) {
            return;
        }

        const keyByStreamId = new Map<number, string>();
        for (const entry of entries) {
            if (!entry.playlistId) continue;
            keyByStreamId.set(
                entry.streamId,
                buildXtreamEpgMappingKey(entry.playlistId, entry.streamId)
            );
        }
        if (keyByStreamId.size === 0) {
            return;
        }

        try {
            // One IPC round-trip for the whole viewport — a per-entry
            // lookup would put O(N) IPC calls on every scroll event.
            const mappings = await getEpgMappingsBatch([
                ...keyByStreamId.values(),
            ]);
            for (const entry of entries) {
                const key = keyByStreamId.get(entry.streamId);
                const mapped = key ? mappings[key]?.trim() : undefined;
                if (mapped) {
                    this.logger.info(
                        `Mapped stream ${entry.streamId}: ${entry.epgChannelId ?? '(none)'} → ${mapped}`
                    );
                    entry.epgChannelId = mapped;
                }
            }
        } catch {
            // Mapping lookup failure is non-fatal; keep the original
            // epgChannelId values and proceed.
        }
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
        const startEpoch = this.invalidationEpoch.get(streamId) ?? 0;
        const isStale = (): boolean =>
            (this.invalidationEpoch.get(streamId) ?? 0) !== startEpoch;
        // Captured before the request so the result can be told apart from
        // the offset current when it lands.
        this.retireStateOfPreviousOffset();
        const offsetMinutes = this.epgOffsetMinutes();
        const outcome = await this.requestPreviewWindow(
            credentials,
            streamId,
            offsetMinutes
        );
        try {
            // A mapping change during the request invalidated this result.
            if (isStale()) {
                return;
            }

            // The setting changed while the request was on the wire, so this
            // window — or its failure — belongs to the previous provider
            // clock. The reload the change triggered skipped the stream
            // because it was in flight, so retire the request whatever its
            // outcome and fetch again if the row is still visible.
            if (offsetMinutes !== this.epgOffsetMinutes()) {
                this.supersedeForOffsetChange(
                    credentials,
                    streamId,
                    startEpoch
                );
                return;
            }

            if ('error' in outcome) {
                this.failureTimestamps.set(streamId, Date.now());
                this.logger.error(
                    `Failed to load EPG for stream ${streamId}`,
                    outcome.error
                );
                return;
            }

            if (outcome.items.length > 0) {
                this.recordSuccess(streamId, outcome.items);
                return;
            }

            const xmltv = this.xmltvPreviewByStreamId.get(streamId);
            this.recordSuccess(streamId, xmltv ? [xmltv] : []);
        } finally {
            // Only release the in-flight marker if this request still owns it.
            // When invalidate() cleared it mid-flight, a later re-enqueue may
            // already have started a new request for the same stream; an
            // unconditional delete here would drop that request's marker and
            // let a third concurrent fetch start.
            if (!isStale()) {
                this.inFlight.delete(streamId);
            }
        }
    }

    /**
     * The provider round-trip for one stream, settled into a value so the
     * caller decides once — for success and failure alike — whether the
     * result is still wanted. Without an offset the cheap short EPG is
     * enough; with one, the short EPG cannot reach the programme on air
     * (it starts at the provider's own "now"), so the same window is cut
     * from the full guide at the provider clock
     * (`windowEpgItemsAtProviderClock`).
     */
    private async requestPreviewWindow(
        credentials: XtreamCredentials,
        streamId: number,
        offsetMinutes: number
    ): Promise<{ items: EpgItem[] } | { error: unknown }> {
        try {
            if (offsetMinutes === 0) {
                return {
                    items: await this.apiService.getShortEpg(
                        credentials,
                        streamId,
                        this.previewLimit,
                        { suppressErrorLog: true }
                    ),
                };
            }
            return {
                items: windowEpgItemsAtProviderClock(
                    await this.apiService.getFullEpg(credentials, streamId, {
                        suppressErrorLog: true,
                    }),
                    offsetMinutes,
                    this.previewLimit
                ),
            };
        } catch (error) {
            return { error };
        }
    }

    /**
     * Retire the in-flight request of `streamId` whose window predates an
     * offset change and queue a fresh fetch. Bumping the epoch first makes the
     * old request's `finally` leave the marker alone, so the replacement it
     * starts here cannot lose its own in-flight marker.
     */
    private supersedeForOffsetChange(
        credentials: XtreamCredentials,
        streamId: number,
        epoch: number
    ): void {
        this.invalidationEpoch.set(streamId, epoch + 1);
        this.inFlight.delete(streamId);
        if (!this.visibleSet.has(streamId) || this.queue.includes(streamId)) {
            return;
        }
        this.queue.push(streamId);
        if (!this.processing) {
            this.processQueue(credentials);
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
