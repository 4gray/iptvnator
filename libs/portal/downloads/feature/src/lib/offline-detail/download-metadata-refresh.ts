import {
    TMDB_DETAILS_CACHE_TTL_MS,
    type SettingsStore,
} from '@iptvnator/services';
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
    completedAttempt: boolean;
    shouldPersist: boolean;
    snapshot: DownloadMetadataSnapshot;
}

export const COMPLETED_METADATA_REFRESH_MAX_ENTRIES = 256;

interface CompletedMetadataRefresh {
    expiresAt: number;
    generation: number;
}

interface PersistMetadataRefreshInput {
    completedAttempt: boolean;
    generation: number;
    groupKey: string;
    language: string;
    persist(): Promise<{ success: boolean }>;
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

export function currentMetadataLanguage(
    settings: Pick<SettingsStore, 'language'>
): string {
    try {
        return settings.language().trim() || 'en';
    } catch {
        return 'en';
    }
}

export function needsMetadataRefresh(
    snapshot: DownloadMetadataSnapshot | undefined,
    language: string,
    completedSparseAttempt = false
): boolean {
    if (!snapshot || snapshot.language !== language) {
        return true;
    }
    if (isSparse(snapshot)) {
        return !completedSparseAttempt;
    }
    return !isFresh(snapshot);
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
        completedAttempt: refreshSucceeded,
        shouldPersist,
        snapshot: shouldPersist ? finalized : local,
    };
}

function completedRefreshKey(groupKey: string, language: string): string {
    return `${groupKey}\u0000${language}`;
}

export class CompletedMetadataRefreshThrottle {
    private readonly attempts = new Map<string, CompletedMetadataRefresh>();

    isCompleted(groupKey: string, language: string): boolean {
        const now = Date.now();
        this.deleteExpired(now);
        return this.attempts.has(completedRefreshKey(groupKey, language));
    }

    mark(groupKey: string, language: string, generation: number): void {
        const now = Date.now();
        const key = completedRefreshKey(groupKey, language);
        this.deleteExpired(now);
        this.attempts.delete(key);
        while (this.attempts.size >= COMPLETED_METADATA_REFRESH_MAX_ENTRIES) {
            const oldestKey = this.attempts.keys().next().value;
            if (oldestKey === undefined) break;
            this.attempts.delete(oldestKey);
        }
        this.attempts.set(key, {
            expiresAt: now + TMDB_DETAILS_CACHE_TTL_MS,
            generation,
        });
    }

    clear(groupKey: string, language: string, generation: number): void {
        const key = completedRefreshKey(groupKey, language);
        if (this.attempts.get(key)?.generation === generation) {
            this.attempts.delete(key);
        }
    }

    private deleteExpired(now: number): void {
        for (const [key, attempt] of this.attempts) {
            if (attempt.expiresAt < now) {
                this.attempts.delete(key);
            }
        }
    }
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

export class MetadataRefreshCoordinator {
    private readonly completed = new CompletedMetadataRefreshThrottle();
    private readonly writes = new LatestMetadataWriteGuard();

    begin(groupKey: string): number {
        return this.writes.begin(groupKey);
    }

    finish(groupKey: string, generation: number): void {
        this.writes.finish(groupKey, generation);
    }

    isCompleted(groupKey: string, language: string): boolean {
        return this.completed.isCompleted(groupKey, language);
    }

    async persistLatest({
        completedAttempt,
        generation,
        groupKey,
        language,
        persist,
    }: PersistMetadataRefreshInput): Promise<void> {
        if (!this.writes.isLatest(groupKey, generation)) return;
        if (completedAttempt) {
            this.completed.mark(groupKey, language, generation);
        }
        try {
            const result = await persist();
            if (!result.success && completedAttempt) {
                this.completed.clear(groupKey, language, generation);
            }
        } catch {
            if (completedAttempt) {
                this.completed.clear(groupKey, language, generation);
            }
        }
    }
}
