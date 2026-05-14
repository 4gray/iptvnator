import { Injectable } from '@angular/core';
import {
    MediaStreamMetadata,
    MediaStreamMetadataProbeRequest,
} from 'shared-interfaces';

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = 'iptvnator-media-metadata-cache:';
const AVAILABLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type MediaMetadataElectronApi = {
    probeMediaStreamMetadata?: (
        url: string,
        headers?: Record<string, string>
    ) => Promise<MediaStreamMetadata>;
};

interface CachedMediaMetadata {
    version: number;
    storedAt: number;
    metadata: MediaStreamMetadata;
}

@Injectable({
    providedIn: 'root',
})
export class MediaMetadataService {
    private readonly cache = new Map<string, Promise<MediaStreamMetadata>>();

    probe(
        request: MediaStreamMetadataProbeRequest
    ): Promise<MediaStreamMetadata> {
        const url = request.url?.trim();
        if (!url || typeof window === 'undefined') {
            return Promise.resolve(this.unavailable('No stream URL to probe'));
        }

        const electron = window.electron as Window['electron'] &
            MediaMetadataElectronApi;

        if (!electron?.probeMediaStreamMetadata) {
            return Promise.resolve(
                this.unavailable('Media metadata probe is not available')
            );
        }

        const cachePayload = JSON.stringify({
            url,
            headers: request.headers ?? {},
        });
        const cached = this.cache.get(cachePayload);
        if (cached) {
            return cached;
        }

        const persisted = this.readPersistentCache(cachePayload);
        if (persisted) {
            const persistedPromise = Promise.resolve(persisted);
            this.cache.set(cachePayload, persistedPromise);
            return persistedPromise;
        }

        const probePromise = electron
            .probeMediaStreamMetadata(url, request.headers)
            .then((metadata) => {
                this.writePersistentCache(cachePayload, metadata);
                return metadata;
            })
            .catch((error) => {
                const metadata = this.unavailable(
                    error instanceof Error ? error.message : String(error)
                );
                this.writePersistentCache(cachePayload, metadata);
                return metadata;
            });

        this.cache.set(cachePayload, probePromise);
        return probePromise;
    }

    clearCache(): void {
        this.cache.clear();

        if (typeof localStorage === 'undefined') {
            return;
        }

        for (let index = localStorage.length - 1; index >= 0; index--) {
            const key = localStorage.key(index);
            if (key?.startsWith(CACHE_KEY_PREFIX)) {
                localStorage.removeItem(key);
            }
        }
    }

    private readPersistentCache(
        cachePayload: string
    ): MediaStreamMetadata | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }

        try {
            const raw = localStorage.getItem(
                this.toPersistentCacheKey(cachePayload)
            );
            if (!raw) {
                return null;
            }

            const cached = JSON.parse(raw) as CachedMediaMetadata;
            if (cached.version !== CACHE_VERSION || !cached.metadata) {
                return null;
            }

            const ttl = cached.metadata.available
                ? AVAILABLE_CACHE_TTL_MS
                : UNAVAILABLE_CACHE_TTL_MS;
            if (Date.now() - cached.storedAt > ttl) {
                localStorage.removeItem(
                    this.toPersistentCacheKey(cachePayload)
                );
                return null;
            }

            return cached.metadata;
        } catch {
            return null;
        }
    }

    private writePersistentCache(
        cachePayload: string,
        metadata: MediaStreamMetadata
    ): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        try {
            const cached: CachedMediaMetadata = {
                version: CACHE_VERSION,
                storedAt: Date.now(),
                metadata,
            };
            localStorage.setItem(
                this.toPersistentCacheKey(cachePayload),
                JSON.stringify(cached)
            );
        } catch {
            // Storage quota/privacy mode should not break playback.
        }
    }

    private toPersistentCacheKey(cachePayload: string): string {
        return `${CACHE_KEY_PREFIX}${this.hashCachePayload(cachePayload)}`;
    }

    private hashCachePayload(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(36);
    }

    private unavailable(reason: string): MediaStreamMetadata {
        return {
            available: false,
            audioLanguages: [],
            audioCodecs: [],
            subtitleLanguages: [],
            subtitleCodecs: [],
            reason,
        };
    }
}
