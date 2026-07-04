import { Injectable } from '@angular/core';
import { TmdbCacheEntry, TmdbMediaType } from '@iptvnator/shared/interfaces';

/**
 * Environment-aware cache for TMDB lookups.
 *
 * - Electron: persists via the `tmdb_metadata` SQLite table (IPC bridge)
 * - PWA: session-scoped in-memory map (phase 1 baseline)
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
        mediaType: TmdbMediaType,
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

        return (
            this.memoryCache.get(
                this.memoryKey(mediaType, lookupKey, language)
            ) ?? null
        );
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

        this.memoryCache.set(
            this.memoryKey(entry.mediaType, entry.lookupKey, entry.language),
            stamped
        );
    }

    isFresh(entry: TmdbCacheEntry | null, ttlMs: number): boolean {
        if (!entry?.fetchedAt) {
            return false;
        }

        const fetchedAt = Date.parse(entry.fetchedAt);
        return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttlMs;
    }

    private memoryKey(
        mediaType: TmdbMediaType,
        lookupKey: string,
        language: string
    ): string {
        return `${mediaType}:${language}:${lookupKey}`;
    }
}
