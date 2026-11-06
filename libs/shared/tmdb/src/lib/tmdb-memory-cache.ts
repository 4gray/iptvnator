import {
    TmdbCacheEntry,
    TmdbCacheMediaType,
} from '@iptvnator/shared/interfaces';
import { TmdbClientCache } from './tmdb-client-contracts';

/** Bounded, session-only cache for hosts without the desktop persistence bridge. */
export class TmdbMemoryCache implements TmdbClientCache {
    private readonly entries = new Map<string, TmdbCacheEntry>();
    constructor(private readonly limit = 120) {}
    async get(type: TmdbCacheMediaType, key: string, language: string) {
        const id = JSON.stringify([type, key, language]);
        const entry = this.entries.get(id);
        if (entry) {
            this.entries.delete(id);
            this.entries.set(id, entry);
        }
        return entry ?? null;
    }
    async set(entry: TmdbCacheEntry) {
        const id = JSON.stringify([
            entry.mediaType,
            entry.lookupKey,
            entry.language,
        ]);
        this.entries.delete(id);
        this.entries.set(id, { ...entry, fetchedAt: new Date().toISOString() });
        if (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
    }
    isFresh(entry: TmdbCacheEntry | null, ttl: number) {
        return (
            !!entry?.fetchedAt && Date.now() - Date.parse(entry.fetchedAt) < ttl
        );
    }
}
