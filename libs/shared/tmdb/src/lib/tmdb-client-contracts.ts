import {
    TmdbCacheEntry,
    TmdbCacheMediaType,
} from '@iptvnator/shared/interfaces';

/** Host-owned settings and storage; the metadata client has no framework/runtime dependency. */
export interface TmdbClientRuntime {
    isEnabled(): boolean;
    apiKey(): string;
    language(): string;
    appLanguage(): string;
}
export interface TmdbClientCache {
    get(
        type: TmdbCacheMediaType,
        key: string,
        language: string
    ): Promise<TmdbCacheEntry | null>;
    set(entry: TmdbCacheEntry): Promise<void>;
    isFresh(entry: TmdbCacheEntry | null, ttl: number): boolean;
}
