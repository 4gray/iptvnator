import { Injectable } from '@angular/core';
import { sourceProfileStorageKey } from './source-sync/source-profile-storage';
import {
    normalizeXtreamPendingRestoreState,
    XtreamContentType,
    XtreamPendingRestoreState,
    XtreamHistoryRecovery,
    XtreamBackupRecentlyViewedItem,
    createRandomId,
} from '@iptvnator/shared/interfaces';

const prefix = 'xtream-catalog-restore-';
const empty = (): XtreamPendingRestoreState => ({
    favorites: [],
    playbackPositions: [],
    hiddenCategories: [],
    recentlyViewed: [],
});
const categoryType = (type: string) => (type === 'movies' ? 'movie' : type);
function merge<T>(older: T[], current: T[], key: (item: T) => string): T[] {
    return Array.from(
        new Map(
            [...older, ...current].map((item) => [key(item), item])
        ).values()
    );
}
export interface DeferredCatalogSnapshot {
    readonly key: string;
    readonly raw: string | null;
    readonly generation: string | null;
    readonly state: XtreamPendingRestoreState;
}
type CatalogState = Pick<
    XtreamPendingRestoreState,
    'hiddenCategories' | 'recentlyViewed'
>;

/** Dormant catalog-dependent backup data is not an active/failed import gate. */
@Injectable({ providedIn: 'root' })
export class XtreamDeferredCatalogRestoreService {
    private read(playlistId: string): DeferredCatalogSnapshot {
        const key = sourceProfileStorageKey(prefix + playlistId);
        const raw = localStorage.getItem(key);
        if (!raw) return { key, raw, generation: null, state: empty() };
        const parsed = JSON.parse(raw);
        if (
            parsed?.version !== 1 ||
            !Array.isArray(parsed.hiddenCategories) ||
            !Array.isArray(parsed.recentlyViewed)
        ) {
            throw new Error('Deferred catalog restore is unreadable.');
        }
        return {
            key,
            raw,
            generation:
                typeof parsed.generation === 'string'
                    ? parsed.generation
                    : 'legacy',
            state: normalizeXtreamPendingRestoreState(parsed),
        };
    }

    private write(playlistId: string, state: XtreamPendingRestoreState): void {
        const key = sourceProfileStorageKey(prefix + playlistId);
        const hasData =
            state.hiddenCategories.length || state.recentlyViewed.length;
        const previousRaw = localStorage.getItem(key);
        if (!hasData && !previousRaw) return;
        const previous =
            hasData && previousRaw ? JSON.parse(previousRaw) : null;
        const generation = hasData
            ? previous?.favoritesRestoreId === state.favoritesRestoreId &&
              typeof previous?.generation === 'string'
                ? previous.generation
                : createRandomId()
            : null;
        const encoded = hasData
            ? JSON.stringify({ version: 1, generation, ...state })
            : '';
        localStorage.setItem(key, encoded);
        if (localStorage.getItem(key) !== encoded)
            throw new Error('Could not retain deferred catalog restore.');
        if (!encoded) {
            // A verified tombstone remains safe even if removal is unavailable.
            try {
                localStorage.removeItem(key);
            } catch {
                /* Keep the tombstone. */
            }
        }
    }

    private combined(
        parked: CatalogState,
        current: CatalogState
    ): CatalogState {
        return {
            hiddenCategories: merge(
                parked.hiddenCategories,
                current.hiddenCategories,
                (row) => `${row.categoryType}:${row.xtreamId}`
            ),
            recentlyViewed: merge(
                parked.recentlyViewed,
                current.recentlyViewed,
                (row) => `${row.contentType}:${row.xtreamId}`
            ),
        };
    }

    private filterCatalogs(
        state: CatalogState,
        available: readonly XtreamContentType[],
        include = true
    ): CatalogState {
        const types = new Set<string>(available);
        return {
            hiddenCategories: state.hiddenCategories.filter(
                (row) => types.has(categoryType(row.categoryType)) === include
            ),
            recentlyViewed: state.recentlyViewed.filter(
                (row) => types.has(row.contentType) === include
            ),
        };
    }

    /** Park unavailable types BEFORE the caller applies/consumes its full restore. */
    prepare(
        playlistId: string,
        state: XtreamPendingRestoreState,
        available: readonly XtreamContentType[],
        currentIsResolved = false,
        historyIsResolved = false
    ): { state: XtreamPendingRestoreState; snapshot: DeferredCatalogSnapshot } {
        const stored = this.read(playlistId).state;
        // An explicit new backup is authoritative, unlike a cache refresh/retry.
        const previous =
            state.favoritesRestoreId &&
            state.favoritesRestoreId !== stored.favoritesRestoreId
                ? empty()
                : stored;
        const parked: XtreamPendingRestoreState = {
            ...empty(),
            ...(state.favoritesRestoreId || previous.favoritesRestoreId
                ? {
                      favoritesRestoreId:
                          state.favoritesRestoreId ??
                          previous.favoritesRestoreId,
                  }
                : {}),
            ...this.combined(
                previous,
                currentIsResolved
                    ? empty()
                    : this.filterCatalogs(state, available, false)
            ),
        };
        if (historyIsResolved)
            parked.recentlyViewed = this.filterCatalogs(
                state,
                available,
                false
            ).recentlyViewed;
        this.write(playlistId, parked);
        const ready = this.combined(
            this.filterCatalogs(parked, available),
            currentIsResolved ? state : this.filterCatalogs(state, available)
        );
        return {
            state: { ...state, ...ready },
            snapshot: this.read(playlistId),
        };
    }

    /** Consume only applied catalog data, never a concurrently replaced record. */
    complete(
        playlistId: string,
        snapshot: DeferredCatalogSnapshot,
        available: readonly XtreamContentType[],
        consumedHistory?: {
            identities: readonly {
                contentType: XtreamContentType;
                xtreamId: number;
            }[];
            afterClearHistory?: readonly XtreamBackupRecentlyViewedItem[];
        }
    ): void {
        const current = this.read(playlistId);
        if (current.key !== snapshot.key || current.raw !== snapshot.raw)
            return;
        const remaining = this.filterCatalogs(snapshot.state, available, false);
        const consumed = new Set(
            consumedHistory?.identities.map(
                (row) => `${row.contentType}:${row.xtreamId}`
            )
        );
        // A sticky cleared flag only invalidates pre-clear entries. The native
        // journal can contain newer watches whose content is missing again.
        const afterClear = consumedHistory?.afterClearHistory;
        const afterClearById =
            afterClear &&
            new Map(
                afterClear.map((row) => [
                    `${row.contentType}:${row.xtreamId}`,
                    row,
                ])
            );
        remaining.recentlyViewed = remaining.recentlyViewed
            .filter((row) => {
                const key = `${row.contentType}:${row.xtreamId}`;
                return (
                    !consumed.has(key) &&
                    (!afterClearById || afterClearById.has(key))
                );
            })
            .map(
                (row) =>
                    afterClearById?.get(`${row.contentType}:${row.xtreamId}`) ??
                    row
            );
        this.write(playlistId, { ...snapshot.state, ...remaining });
    }

    forExport(
        playlistId: string,
        current: CatalogState,
        restoreId?: string,
        recovery?: Pick<
            XtreamHistoryRecovery,
            'contentTypes' | 'removed' | 'cleared'
        > & {
            currentCategories?: XtreamPendingRestoreState['hiddenCategories'];
            snapshot?: XtreamPendingRestoreState['catalogSnapshot'];
        }
    ): CatalogState {
        const snapshot = this.read(playlistId);
        const stored = snapshot.state;
        if (
            !recovery?.snapshot ||
            recovery.snapshot.key !== snapshot.key ||
            recovery.snapshot.generation !== snapshot.generation
        )
            recovery = undefined;
        const parked =
            restoreId && restoreId !== stored.favoritesRestoreId
                ? empty()
                : stored;
        const remaining = {
            ...parked,
            recentlyViewed: this.filterCatalogs(
                parked,
                recovery?.contentTypes ?? [],
                false
            ).recentlyViewed,
        };
        const currentIds = new Set(
            recovery?.currentCategories?.map(
                (row) => `${row.categoryType}:${row.xtreamId}`
            )
        );
        remaining.hiddenCategories = remaining.hiddenCategories.filter(
            (row) => !currentIds.has(`${row.categoryType}:${row.xtreamId}`)
        );
        remaining.recentlyViewed = recovery?.cleared
            ? []
            : remaining.recentlyViewed.filter(
                  (row) =>
                      !recovery?.removed?.some(
                          (removed) =>
                              removed.contentType === row.contentType &&
                              removed.xtreamId === row.xtreamId
                      )
              );
        return this.combined(remaining, current);
    }

    getSnapshot(playlistId: string): DeferredCatalogSnapshot {
        return this.read(playlistId);
    }

    clear(playlistId: string): void {
        this.write(playlistId, empty());
    }

    private ids(playlistId?: string): string[] {
        const scopedPrefix = sourceProfileStorageKey(prefix);
        return playlistId
            ? [playlistId]
            : Array.from({ length: localStorage.length }, (_, index) =>
                  localStorage.key(index)
              )
                  .filter(
                      (key): key is string => !!key?.startsWith(scopedPrefix)
                  )
                  .map((key) => key.slice(scopedPrefix.length));
    }

    clearAll(): void {
        for (const id of this.ids()) this.clear(id);
    }

    /** Explicit history clearing must not resurrect dormant history later. */
    clearHistory(playlistId?: string): void {
        for (const id of this.ids(playlistId))
            this.write(id, { ...this.read(id).state, recentlyViewed: [] });
    }
}

export {
    prepareLegacyCatalogHistoryRecovery,
    readCatalogRecoveryVisibility,
    captureCatalogCacheRecoveryState,
    exportCatalogRecoveryState,
    beginCatalogHistoryRecovery,
    clearCatalogHistoryRecovery,
    completeCatalogHistoryRecovery,
    readCatalogHistoryRecovery,
} from './xtream-catalog-history-recovery';

export { resolveAvailableCatalogs } from './xtream-catalog-availability';
