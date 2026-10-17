import { Injectable } from '@angular/core';
import {
    normalizeXtreamPendingRestoreState,
    XtreamContentType,
    XtreamPendingRestoreState,
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
    readonly raw: string | null;
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
        const raw = localStorage.getItem(prefix + playlistId);
        if (!raw) return { raw, state: empty() };
        const parsed = JSON.parse(raw);
        if (
            parsed?.version !== 1 ||
            !Array.isArray(parsed.hiddenCategories) ||
            !Array.isArray(parsed.recentlyViewed)
        ) {
            throw new Error('Deferred catalog restore is unreadable.');
        }
        return { raw, state: normalizeXtreamPendingRestoreState(parsed) };
    }

    private write(playlistId: string, state: XtreamPendingRestoreState): void {
        const key = prefix + playlistId;
        const hasData =
            state.hiddenCategories.length || state.recentlyViewed.length;
        const encoded = hasData ? JSON.stringify({ version: 1, ...state }) : '';
        if (!encoded && !localStorage.getItem(key)) return;
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
        parked: XtreamPendingRestoreState,
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

    /** Park unavailable types BEFORE the caller applies/consumes its full restore. */
    prepare(
        playlistId: string,
        state: XtreamPendingRestoreState,
        available: readonly XtreamContentType[],
        currentIsResolved = false
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
            ...this.combined(previous, {
                hiddenCategories: state.hiddenCategories.filter(
                    (row) =>
                        !currentIsResolved &&
                        !available.some(
                            (type) => type === categoryType(row.categoryType)
                        )
                ),
                recentlyViewed: state.recentlyViewed.filter(
                    (row) =>
                        !currentIsResolved &&
                        !available.includes(row.contentType)
                ),
            }),
        };
        this.write(playlistId, parked);
        const ready = this.combined(
            {
                ...parked,
                hiddenCategories: parked.hiddenCategories.filter((row) =>
                    available.some(
                        (type) => type === categoryType(row.categoryType)
                    )
                ),
                recentlyViewed: parked.recentlyViewed.filter((row) =>
                    available.includes(row.contentType)
                ),
            },
            {
                hiddenCategories: state.hiddenCategories.filter(
                    (row) =>
                        currentIsResolved ||
                        available.some(
                            (type) => type === categoryType(row.categoryType)
                        )
                ),
                recentlyViewed: state.recentlyViewed.filter(
                    (row) =>
                        currentIsResolved || available.includes(row.contentType)
                ),
            }
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
        available: readonly XtreamContentType[]
    ): void {
        if (this.read(playlistId).raw !== snapshot.raw) return;
        this.write(playlistId, {
            ...snapshot.state,
            hiddenCategories: snapshot.state.hiddenCategories.filter(
                (row) =>
                    !available.some(
                        (type) => type === categoryType(row.categoryType)
                    )
            ),
            recentlyViewed: snapshot.state.recentlyViewed.filter(
                (row) => !available.includes(row.contentType)
            ),
        });
    }

    forExport(
        playlistId: string,
        current: CatalogState,
        restoreId?: string
    ): CatalogState {
        const stored = this.read(playlistId).state;
        const parked =
            restoreId && restoreId !== stored.favoritesRestoreId
                ? empty()
                : stored;
        return this.combined(parked, current);
    }

    clear(playlistId: string): void {
        this.write(playlistId, empty());
    }

    private ids(playlistId?: string): string[] {
        return playlistId
            ? [playlistId]
            : Array.from({ length: localStorage.length }, (_, index) =>
                  localStorage.key(index)
              )
                  .filter((key): key is string => !!key?.startsWith(prefix))
                  .map((key) => key.slice(prefix.length));
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
