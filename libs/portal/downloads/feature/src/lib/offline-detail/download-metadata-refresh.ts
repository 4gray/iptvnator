import { TMDB_DETAILS_CACHE_TTL_MS } from '@iptvnator/services';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';

export const TMDB_REFRESH_STATE = {
    DISABLED: 'disabled',
    FAILED: 'failed',
    SUCCEEDED: 'succeeded',
} as const;

export type TmdbRefreshState =
    (typeof TMDB_REFRESH_STATE)[keyof typeof TMDB_REFRESH_STATE];

export interface TmdbRefreshResult {
    snapshot: DownloadMetadataSnapshot;
    state: TmdbRefreshState;
}

interface FinalizeMetadataRefreshInput {
    language: string;
    local: DownloadMetadataSnapshot;
    providerSucceeded: boolean;
    snapshot: DownloadMetadataSnapshot;
    tmdbState: TmdbRefreshState;
}

export interface FinalizedMetadataRefresh {
    shouldPersist: boolean;
    snapshot: DownloadMetadataSnapshot;
}

function isSparse(snapshot: DownloadMetadataSnapshot): boolean {
    return !snapshot.plot || (!snapshot.posterUrl && !snapshot.backdropUrl);
}

function isFresh(snapshot: DownloadMetadataSnapshot): boolean {
    const enrichedAt = Date.parse(snapshot.enrichedAt ?? '');
    const age = Date.now() - enrichedAt;
    return (
        Number.isFinite(enrichedAt) &&
        age >= 0 &&
        age <= TMDB_DETAILS_CACHE_TTL_MS
    );
}

export function needsMetadataRefresh(
    snapshot: DownloadMetadataSnapshot | undefined,
    language: string
): boolean {
    return (
        !snapshot ||
        snapshot.language !== language ||
        isSparse(snapshot) ||
        !isFresh(snapshot)
    );
}

export function withoutMetadataFreshness(
    snapshot: DownloadMetadataSnapshot
): DownloadMetadataSnapshot {
    const pending = { ...snapshot };
    delete pending.enrichedAt;
    return pending;
}

function sortedValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortedValue);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
            result[key] = sortedValue((value as Record<string, unknown>)[key]);
            return result;
        }, {});
}

function materiallyEqual(
    left: DownloadMetadataSnapshot,
    right: DownloadMetadataSnapshot
): boolean {
    const leftFields = { ...left };
    const rightFields = { ...right };
    delete leftFields.enrichedAt;
    delete rightFields.enrichedAt;
    return (
        JSON.stringify(sortedValue(leftFields)) ===
        JSON.stringify(sortedValue(rightFields))
    );
}

function preserveAttemptIdentity(
    snapshot: DownloadMetadataSnapshot,
    local: DownloadMetadataSnapshot
): DownloadMetadataSnapshot {
    const preserved = { ...snapshot, language: local.language };
    return local.enrichedAt === undefined
        ? withoutMetadataFreshness(preserved)
        : { ...preserved, enrichedAt: local.enrichedAt };
}

export function finalizeMetadataRefresh({
    language,
    local,
    providerSucceeded,
    snapshot,
    tmdbState,
}: FinalizeMetadataRefreshInput): FinalizedMetadataRefresh {
    const refreshSucceeded =
        tmdbState === TMDB_REFRESH_STATE.SUCCEEDED ||
        (tmdbState === TMDB_REFRESH_STATE.DISABLED && providerSucceeded);
    const finalized = refreshSucceeded
        ? { ...snapshot, language, enrichedAt: new Date().toISOString() }
        : preserveAttemptIdentity(snapshot, local);
    const shouldPersist =
        refreshSucceeded || !materiallyEqual(local, finalized);
    return {
        shouldPersist,
        snapshot: shouldPersist ? finalized : local,
    };
}

export class LatestMetadataWriteGuard {
    private generation = 0;
    private readonly latestByKey = new Map<string, number>();

    begin(key: string): number {
        const generation = ++this.generation;
        this.latestByKey.set(key, generation);
        return generation;
    }

    isLatest(key: string, generation: number): boolean {
        return this.latestByKey.get(key) === generation;
    }

    finish(key: string, generation: number): void {
        if (this.isLatest(key, generation)) {
            this.latestByKey.delete(key);
        }
    }
}
