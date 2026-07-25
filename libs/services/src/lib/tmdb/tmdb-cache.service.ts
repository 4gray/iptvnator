import { Injectable } from '@angular/core';
import {
    TmdbCacheEntry,
    TmdbCacheMediaType,
    TmdbCacheStats,
} from '@iptvnator/shared/interfaces';

/** PWA in-memory cache ceiling — details payloads are a few KB each */
const MEMORY_CACHE_MAX_ENTRIES = 300;

/**
 * Environment-aware cache for TMDB lookups.
 *
 * - Electron: persists via the `tmdb_metadata` SQLite table (IPC bridge)
 * - PWA: session-scoped in-memory LRU map capped at
 *   {@link MEMORY_CACHE_MAX_ENTRIES} entries
 *
 * Freshness (TTL) is decided by the caller via {@link isFresh} so different
 * row kinds (details vs. negative match) can use different TTLs.
 */
@Injectable({ providedIn: 'root' })
export class TmdbCacheService {
    private readonly memoryCache = new Map<string, TmdbCacheEntry>();

    /**
     * Electron writes that have not landed yet. {@link clear} waits for
     * them, so a write already in flight cannot outlive the clear that
     * followed it — and, unlike re-clearing after the late write lands,
     * waiting cannot take rows written *after* the user cleared with it.
     */
    private readonly pendingWrites = new Set<Promise<unknown>>();

    /** Set for the duration of {@link clear}; writes queue behind it */
    private clearInFlight: Promise<unknown> | null = null;

    private get bridge() {
        // typeof checks guard against version skew: an older Electron shell
        // may not expose the TMDB cache methods yet
        return typeof window !== 'undefined' &&
            typeof window.electron?.dbGetTmdbMetadata === 'function' &&
            typeof window.electron?.dbSetTmdbMetadata === 'function'
            ? window.electron
            : null;
    }

    async get(
        mediaType: TmdbCacheMediaType,
        lookupKey: string,
        language: string
    ): Promise<TmdbCacheEntry | null> {
        const bridge = this.bridge;
        if (bridge) {
            try {
                return await bridge.dbGetTmdbMetadata(
                    mediaType,
                    lookupKey,
                    language
                );
            } catch (error) {
                console.warn('TMDB cache read failed:', error);
                return null;
            }
        }

        const key = this.memoryKey(mediaType, lookupKey, language);
        const entry = this.memoryCache.get(key);
        if (entry) {
            // LRU touch: Map preserves insertion order, so re-inserting
            // moves the entry to the "most recently used" end
            this.memoryCache.delete(key);
            this.memoryCache.set(key, entry);
        }
        return entry ?? null;
    }

    async set(entry: TmdbCacheEntry): Promise<void> {
        const bridge = this.bridge;
        if (bridge) {
            // A clear owns the table until it finishes. Dispatching now
            // would race the delete and lose a row the user never asked to
            // lose, so this write waits it out and lands after it.
            while (this.clearInFlight) {
                await this.clearInFlight;
            }

            // The IIFE also converts a synchronous throw from the bridge
            // into a rejection, so `set` never throws at its caller
            const write = (async () => {
                try {
                    await bridge.dbSetTmdbMetadata(this.stamp(entry));
                } catch (error) {
                    console.warn('TMDB cache write failed:', error);
                }
            })();
            this.pendingWrites.add(write);
            try {
                await write;
            } finally {
                this.pendingWrites.delete(write);
            }
            return;
        }

        const key = this.memoryKey(
            entry.mediaType,
            entry.lookupKey,
            entry.language
        );
        this.memoryCache.delete(key);
        this.memoryCache.set(key, this.stamp(entry));
        // delete-then-reinsert above means at most one entry over the cap
        if (this.memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
            const oldest = this.memoryCache.keys().next().value;
            if (oldest !== undefined) {
                this.memoryCache.delete(oldest);
            }
        }
    }

    /** Stamped at write time, not at call time — a write may have waited */
    private stamp(entry: TmdbCacheEntry): TmdbCacheEntry {
        return { ...entry, fetchedAt: new Date().toISOString() };
    }

    isFresh(entry: TmdbCacheEntry | null, ttlMs: number): boolean {
        if (!entry?.fetchedAt) {
            return false;
        }

        const fetchedAt = Date.parse(entry.fetchedAt);
        return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttlMs;
    }

    private memoryKey(
        mediaType: TmdbCacheMediaType,
        lookupKey: string,
        language: string
    ): string {
        return `${mediaType}:${language}:${lookupKey}`;
    }

    /**
     * Cache size for the settings panel. In the PWA the cache is the
     * session-scoped map, so the numbers describe that instead.
     */
    async getStats(): Promise<TmdbCacheStats | null> {
        const bridge = this.bridge;
        if (bridge) {
            if (!bridge.dbGetTmdbCacheStats) {
                // Version skew: this shell persists to SQLite but predates
                // the maintenance ops. The renderer map is empty in
                // Electron, so falling back to it would report a cache that
                // is anything but empty as having nothing in it.
                return null;
            }
            try {
                return await bridge.dbGetTmdbCacheStats();
            } catch (error) {
                // `null`, not zeros: reporting a failed read as an empty
                // cache would hide real rows and disable the Clear button
                console.warn('TMDB cache stats failed:', error);
                return null;
            }
        }

        // TextEncoder measures encoded bytes; String.length counts UTF-16
        // code units, which understates non-ASCII payloads and would
        // disagree with the SQLite BLOB byte count.
        const encoder = new TextEncoder();
        let bytes = 0;
        for (const entry of this.memoryCache.values()) {
            bytes += entry.payload ? encoder.encode(entry.payload).length : 0;
        }
        return { entries: this.memoryCache.size, bytes };
    }

    /**
     * Drops everything. Enrichment refetches on demand, so this only
     * costs the next few requests.
     */
    async clear(): Promise<number | null> {
        const bridge = this.bridge;
        const clearedFromMemory = this.memoryCache.size;
        this.memoryCache.clear();

        if (!bridge) {
            return clearedFromMemory;
        }

        const clearMetadata = bridge.dbClearTmdbMetadata;
        if (!clearMetadata) {
            // Same version skew as getStats(): the rows are in SQLite and
            // stay there, so reporting a successful clear would be a lie
            return null;
        }

        // Called through the bridge so the preload keeps its receiver
        const run = this.runClear(() => clearMetadata.call(bridge));
        this.clearInFlight = run;
        try {
            return await run;
        } finally {
            this.clearInFlight = null;
        }
    }

    /**
     * Everything between the writes already in flight and the delete. Held
     * in `clearInFlight` for its duration, which is what puts writes that
     * start meanwhile on the far side of the delete rather than under it.
     */
    private async runClear(
        clearMetadata: () => Promise<{ deleted: number } | undefined>
    ): Promise<number | null> {
        // Writes issued before the clear land first, so the delete takes
        // them too.
        if (this.pendingWrites.size > 0) {
            // Not Promise.allSettled: the web target compiles against
            // lib es2018. The writes swallow their own errors anyway.
            await Promise.all(
                [...this.pendingWrites].map((write) =>
                    write.then(
                        () => undefined,
                        () => undefined
                    )
                )
            );
        }

        try {
            const result = await clearMetadata();
            return result?.deleted ?? 0;
        } catch (error) {
            // `null` so the panel can say it failed and stay actionable
            console.warn('TMDB cache clear failed:', error);
            return null;
        }
    }
}
