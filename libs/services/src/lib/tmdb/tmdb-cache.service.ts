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
        const stamped: TmdbCacheEntry = {
            ...entry,
            fetchedAt: new Date().toISOString(),
        };

        const bridge = this.bridge;
        if (bridge) {
            try {
                await bridge.dbSetTmdbMetadata(stamped);
            } catch (error) {
                console.warn('TMDB cache write failed:', error);
            }
            return;
        }

        const key = this.memoryKey(
            entry.mediaType,
            entry.lookupKey,
            entry.language
        );
        this.memoryCache.delete(key);
        this.memoryCache.set(key, stamped);
        // delete-then-reinsert above means at most one entry over the cap
        if (this.memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
            const oldest = this.memoryCache.keys().next().value;
            if (oldest !== undefined) {
                this.memoryCache.delete(oldest);
            }
        }
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
    async getStats(): Promise<TmdbCacheStats> {
        const bridge = this.bridge;
        if (bridge?.dbGetTmdbCacheStats) {
            try {
                return await bridge.dbGetTmdbCacheStats();
            } catch (error) {
                console.warn('TMDB cache stats failed:', error);
                return { entries: 0, bytes: 0 };
            }
        }

        let bytes = 0;
        for (const entry of this.memoryCache.values()) {
            bytes += entry.payload?.length ?? 0;
        }
        return { entries: this.memoryCache.size, bytes };
    }

    /**
     * Drops everything. Enrichment refetches on demand, so this only
     * costs the next few requests.
     */
    async clear(): Promise<number> {
        const bridge = this.bridge;
        this.memoryCache.clear();

        if (bridge?.dbClearTmdbMetadata) {
            try {
                const result = await bridge.dbClearTmdbMetadata();
                return result?.deleted ?? 0;
            } catch (error) {
                console.warn('TMDB cache clear failed:', error);
                return 0;
            }
        }

        return 0;
    }

}
