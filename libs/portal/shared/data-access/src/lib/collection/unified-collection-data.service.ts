import { DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import {
    CollectionContentType,
    CollectionScope,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { createCollectionReloadIndicator } from './collection-reload-indicator';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';
import { UnifiedRecentDataService } from './unified-recent-data.service';

export type CollectionMode = 'favorites' | 'recent';

export interface CollectionLoadRequest {
    scope: CollectionScope;
    playlistId?: string;
    portalType?: string;
}

/**
 * Reads and writes the rows of one unified collection (a favorites or a
 * recently-viewed list) and owns their loading state. Not `providedIn:
 * 'root'`: `UnifiedCollectionPageComponent` provides it, so every mounted
 * page has its own; the page itself keeps only the view concerns on top of
 * this.
 */
@Injectable()
export class UnifiedCollectionDataService {
    private readonly favoritesData = inject(UnifiedFavoritesDataService);
    private readonly recentData = inject(UnifiedRecentDataService);
    private readonly reloadIndicator = createCollectionReloadIndicator(
        inject(DestroyRef)
    );

    /** First load with nothing on screen: the skeleton replaces the content. */
    readonly isLoading = signal(true);
    /**
     * A reload (scope switch, favorites reload) is in flight while the
     * previous items stay mounted. Never swaps to the skeleton, so a playing
     * channel and the focused toggle survive.
     */
    readonly isReloading = this.reloadIndicator.active;
    /** `isReloading` past its grace period: progress bar + dimming render. */
    readonly showReloadIndicator = this.reloadIndicator.visible;
    readonly allItems = signal<UnifiedCollectionItem[]>([]);
    readonly favoriteUidSet = signal<ReadonlySet<string>>(new Set<string>());

    private readonly request = signal<CollectionLoadRequest | null>(null);
    /**
     * The request that produced `allItems`. Actions on displayed rows (Clear,
     * drag reorder) must use it, not the scope toggle's current value: during
     * a reload the toggle already names the requested scope while the
     * previous rows are still on screen, and "This playlist" against global
     * rows would delete other playlists' favorites or write foreign URLs into
     * this playlist.
     */
    readonly loadedRequest: Signal<CollectionLoadRequest | null> =
        this.request.asReadonly();

    private requestId = 0;

    /**
     * Replace the collection with the rows the request resolves to. Returns
     * the loaded rows, or `null` when the load was superseded by a newer one
     * or failed — in both cases the caller must not post-process it.
     */
    async load(
        params: CollectionLoadRequest & { mode: CollectionMode }
    ): Promise<UnifiedCollectionItem[] | null> {
        const requestId = ++this.requestId;
        if (this.allItems().length === 0) {
            this.isLoading.set(true);
        } else {
            this.reloadIndicator.begin();
        }

        try {
            const items =
                params.mode === 'favorites'
                    ? await this.favoritesData.getFavorites(
                          params.scope,
                          params.playlistId,
                          params.portalType
                      )
                    : await this.recentData.getRecentItems(
                          params.scope,
                          params.playlistId,
                          params.portalType
                      );
            const favoriteUids =
                params.mode === 'favorites'
                    ? new Set(items.map((item) => item.uid))
                    : await this.loadFavoriteUidSet(params);
            if (requestId !== this.requestId) {
                return null;
            }
            this.allItems.set(items);
            this.request.set({
                scope: params.scope,
                playlistId: params.playlistId,
                portalType: params.portalType,
            });
            this.favoriteUidSet.set(favoriteUids);
            return items;
        } catch {
            if (requestId !== this.requestId) {
                return null;
            }
            this.allItems.set([]);
            return null;
        } finally {
            if (requestId === this.requestId) {
                this.isLoading.set(false);
                this.reloadIndicator.settle();
            }
        }
    }

    async removeItem(
        mode: CollectionMode,
        item: UnifiedCollectionItem
    ): Promise<void> {
        if (mode === 'favorites') {
            await this.favoritesData.removeFavorite(item);
            this.favoriteUidSet.update((favoriteUids) => {
                const nextFavoriteUids = new Set(favoriteUids);
                nextFavoriteUids.delete(item.uid);
                return nextFavoriteUids;
            });
        } else {
            await this.recentData.removeRecentItem(item);
        }
        this.allItems.update((items) =>
            items.filter((i) => i.uid !== item.uid)
        );
    }

    async toggleFavorite(item: UnifiedCollectionItem): Promise<void> {
        const nextFavoriteUids = new Set(this.favoriteUidSet());

        if (nextFavoriteUids.has(item.uid)) {
            await this.favoritesData.removeFavorite(item);
            nextFavoriteUids.delete(item.uid);
        } else {
            await this.favoritesData.addFavorite(item);
            nextFavoriteUids.add(item.uid);
        }

        this.favoriteUidSet.set(nextFavoriteUids);
    }

    async reorder(
        items: UnifiedCollectionItem[],
        request: CollectionLoadRequest
    ): Promise<void> {
        const nonLive = this.allItems().filter((i) => i.contentType !== 'live');
        this.allItems.set([...items, ...nonLive]);
        await this.favoritesData.reorder(items, request);
    }

    /** Drop every row of one type from the list, without persisting. */
    dropContentType(contentType: CollectionContentType): void {
        this.allItems.update((items) =>
            items.filter((item) => item.contentType !== contentType)
        );
    }

    clearFavorites(items: UnifiedCollectionItem[]): Promise<void> {
        return this.favoritesData.clearFavorites(items);
    }

    removeRecentItemsBatch(items: UnifiedCollectionItem[]): void {
        void this.recentData.removeRecentItemsBatch(items);
    }

    /** Move a just-played item back to the head of the recent list. */
    promoteRecentItem(item: UnifiedCollectionItem): void {
        this.allItems.update((items) => {
            const nextItems = [
                item,
                ...items.filter((candidate) => candidate.uid !== item.uid),
            ];
            return nextItems.sort(
                (a, b) =>
                    new Date(b.viewedAt ?? 0).getTime() -
                    new Date(a.viewedAt ?? 0).getTime()
            );
        });
    }

    private async loadFavoriteUidSet(
        params: CollectionLoadRequest
    ): Promise<ReadonlySet<string>> {
        try {
            const favorites = await this.favoritesData.getFavorites(
                params.scope,
                params.playlistId,
                params.portalType
            );
            return new Set(favorites.map((item) => item.uid));
        } catch {
            return new Set<string>();
        }
    }
}
