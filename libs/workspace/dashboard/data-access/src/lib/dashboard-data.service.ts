import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import {
    PlaylistActions,
    selectActivePlaylist,
    selectAllPlaylistsMeta,
} from 'm3u-state';
import { DatabaseService } from 'services';
import {
    PlaylistMeta,
    PortalActivityType,
    PortalFavoriteItem,
    PortalRecentItem,
    stalkerItemMatchesId,
} from 'shared-interfaces';
import {
    buildStalkerFavoriteItems,
    buildStalkerRecentItems,
    getTypeLabel,
    mapDbFavoriteToItem,
    mapDbRecentToItem,
    toDateTimestamp,
    toTimestamp,
} from './dashboard-mappers';
import {
    getGlobalFavoriteNavigation,
    getRecentItemNavigation,
} from './dashboard-navigation.utils';
import {
    DashboardWidgetProvider,
    DashboardWidgetScopeSettings,
    createDefaultWidgetScope,
} from './dashboard-widget.model';

export type DashboardContentKind = 'all' | 'channels' | 'vod' | 'series';

/** @deprecated Use {@link PortalRecentItem} from `shared-interfaces` instead. */
export type GlobalRecentItem = PortalRecentItem;
/** @deprecated Use {@link PortalFavoriteItem} from `shared-interfaces` instead. */
export type DashboardFavoriteItem = PortalFavoriteItem;

@Injectable({ providedIn: 'root' })
export class DashboardDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly ngZone = inject(NgZone);

    private readonly xtreamGlobalRecentItems = signal<GlobalRecentItem[]>([]);
    private readonly xtreamGlobalFavorites = signal<DashboardFavoriteItem[]>(
        []
    );
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    readonly activePlaylist = this.store.selectSignal(selectActivePlaylist);

    readonly stalkerGlobalRecentItems = computed<GlobalRecentItem[]>(() =>
        buildStalkerRecentItems(this.playlists())
    );

    readonly globalRecentItems = computed<GlobalRecentItem[]>(() =>
        [...this.xtreamGlobalRecentItems(), ...this.stalkerGlobalRecentItems()]
            .sort(
                (a, b) =>
                    toDateTimestamp(b.viewed_at) - toDateTimestamp(a.viewed_at)
            )
            .slice(0, 200)
    );

    readonly stalkerGlobalFavorites = computed<DashboardFavoriteItem[]>(() =>
        buildStalkerFavoriteItems(this.playlists())
    );

    readonly globalFavoriteItems = computed(() =>
        [...this.xtreamGlobalFavorites(), ...this.stalkerGlobalFavorites()]
            .sort((a, b) => toTimestamp(b.added_at) - toTimestamp(a.added_at))
            .slice(0, 200)
    );

    constructor() {
        if (window.electron) {
            void this.reloadGlobalRecentItems();
            void this.reloadGlobalFavorites();
        }
    }

    readonly stats = computed(() => {
        const items = this.playlists();
        return {
            total: items.length,
            xtream: items.filter((item) => !!item.serverUrl).length,
            stalker: items.filter((item) => !!item.macAddress).length,
            m3u: items.filter((item) => !item.serverUrl && !item.macAddress)
                .length,
        };
    });

    readonly recentPlaylists = computed(() =>
        [...this.playlists()]
            .sort(
                (a, b) =>
                    this.getRecentTimestamp(b) - this.getRecentTimestamp(a)
            )
            .slice(0, 12)
    );

    readonly quickRecent = computed(() => this.recentPlaylists().slice(0, 4));

    async reloadGlobalRecentItems(): Promise<void> {
        if (!window.electron) {
            this.xtreamGlobalRecentItems.set([]);
            return;
        }

        try {
            const recentItems = await this.dbService.getGlobalRecentlyViewed();
            const normalized = recentItems.map((item) =>
                mapDbRecentToItem(item)
            );
            this.ngZone.run(() => this.xtreamGlobalRecentItems.set(normalized));
        } catch (err) {
            console.warn(
                '[DashboardData] Failed to reload global recent items',
                err
            );
            this.ngZone.run(() => this.xtreamGlobalRecentItems.set([]));
        }
    }

    async reloadGlobalFavorites(): Promise<void> {
        if (!window.electron) {
            this.xtreamGlobalFavorites.set([]);
            return;
        }

        try {
            const favorites = await this.dbService.getGlobalFavorites();
            const normalized = favorites.map((item) =>
                mapDbFavoriteToItem(item)
            );
            this.ngZone.run(() => this.xtreamGlobalFavorites.set(normalized));
        } catch (err) {
            console.warn(
                '[DashboardData] Failed to reload global favorites',
                err
            );
            this.ngZone.run(() => this.xtreamGlobalFavorites.set([]));
        }
    }

    isTypeInKind(
        type: PortalActivityType,
        kind: DashboardContentKind
    ): boolean {
        if (kind === 'all') {
            return true;
        }
        if (kind === 'channels') {
            return type === 'live';
        }
        if (kind === 'vod') {
            return type === 'movie';
        }
        return type === 'series';
    }

    matchesScope(
        playlistId: string,
        source: 'xtream' | 'stalker' | 'm3u' | undefined,
        scope?: DashboardWidgetScopeSettings
    ): boolean {
        const normalizedScope = this.normalizeScope(scope);
        const provider = this.getProviderFromSource(
            source,
            this.getPlaylistProviderType(playlistId)
        );
        const providerAllowed =
            normalizedScope.providers.length === 0 ||
            normalizedScope.providers.includes(provider);
        if (!providerAllowed) {
            return false;
        }

        if (normalizedScope.playlistIds.length === 0) {
            return true;
        }

        return normalizedScope.playlistIds.includes(playlistId);
    }

    getPlaylistProviderType(playlistId: string): DashboardWidgetProvider {
        const playlist = this.playlists().find(
            (item) => item._id === playlistId
        );
        if (!playlist) {
            return 'm3u';
        }

        if (playlist.serverUrl) {
            return 'xtream';
        }

        if (playlist.macAddress) {
            return 'stalker';
        }

        return 'm3u';
    }

    getPlaylistLink(playlist: PlaylistMeta): string[] {
        if (playlist.serverUrl) {
            return ['/workspace', 'xtreams', playlist._id, 'vod'];
        }

        if (playlist.macAddress) {
            return ['/workspace', 'stalker', playlist._id, 'vod'];
        }

        return ['/workspace', 'playlists', playlist._id];
    }

    getPlaylistProvider(playlist: PlaylistMeta): 'Xtream' | 'Stalker' | 'M3U' {
        if (playlist.serverUrl) {
            return 'Xtream';
        }

        if (playlist.macAddress) {
            return 'Stalker';
        }

        return 'M3U';
    }

    getRecentItemProviderLabel(item: GlobalRecentItem): string {
        if (item.source === 'stalker') {
            return 'Stalker';
        }
        if (item.source === 'xtream') {
            return 'Xtream';
        }
        return 'Provider';
    }

    getRecentItemTypeLabel(item: GlobalRecentItem): string {
        return getTypeLabel(item.type);
    }

    getRecentItemLink(item: GlobalRecentItem): string[] {
        return getRecentItemNavigation(item).link;
    }

    getRecentItemNavigationState(
        item: GlobalRecentItem
    ): Record<string, unknown> | undefined {
        return getRecentItemNavigation(item).state;
    }

    async removeGlobalRecentItem(item: GlobalRecentItem): Promise<void> {
        if (item.source === 'xtream') {
            await this.dbService.removeRecentItem(
                item.id as number,
                item.playlist_id
            );
            await this.reloadGlobalRecentItems();
            return;
        }

        if (item.source === 'stalker') {
            const playlist = this.playlists().find(
                (p) => p._id === item.playlist_id
            );
            if (!playlist) return;

            const currentRecent = Array.isArray(
                (playlist as { recentlyViewed?: unknown[] }).recentlyViewed
            )
                ? [
                      ...((playlist as { recentlyViewed?: unknown[] })
                          .recentlyViewed ?? []),
                  ]
                : [];

            const itemMatchStr = String(item.id);
            const filteredRecent = currentRecent.filter(
                (raw, index) =>
                    !stalkerItemMatchesId(
                        raw,
                        itemMatchStr,
                        playlist._id,
                        index
                    )
            );

            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: item.playlist_id,
                        recentlyViewed: filteredRecent,
                    } as unknown as PlaylistMeta,
                }) as any
            );
        }
    }

    getFavoriteItemProviderLabel(item: DashboardFavoriteItem): string {
        if (item.source === 'stalker') {
            return 'Stalker';
        }
        if (item.source === 'xtream') {
            return 'Xtream';
        }
        return 'Provider';
    }

    getFavoriteItemTypeLabel(item: DashboardFavoriteItem): string {
        return getTypeLabel(item.type);
    }

    getGlobalFavoriteLink(item: DashboardFavoriteItem): string[] {
        return getGlobalFavoriteNavigation(item).link;
    }

    getGlobalFavoriteNavigationState(
        item: DashboardFavoriteItem
    ): Record<string, unknown> | undefined {
        return getGlobalFavoriteNavigation(item).state;
    }

    async removeGlobalFavorite(item: DashboardFavoriteItem): Promise<void> {
        if (item.source === 'xtream') {
            await this.dbService.removeFromFavorites(
                item.id as number,
                item.playlist_id
            );
            await this.reloadGlobalFavorites();
            return;
        }

        if (item.source === 'stalker') {
            const playlist = this.playlists().find(
                (p) => p._id === item.playlist_id
            );
            if (!playlist) return;

            const currentFavorites = Array.isArray(playlist.favorites)
                ? [...playlist.favorites]
                : [];
            const itemMatchStr = String(item.id);

            const filteredFavorites = currentFavorites.filter(
                (raw, index) =>
                    !stalkerItemMatchesId(
                        raw,
                        itemMatchStr,
                        playlist._id,
                        index
                    )
            );

            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: item.playlist_id,
                        favorites: filteredFavorites,
                    } as unknown as PlaylistMeta,
                }) as any
            );
        }
    }

    formatTimestamp(value?: string | number): string {
        const timestamp = toTimestamp(value);
        if (!timestamp) {
            return 'Not yet synced';
        }

        return new Date(timestamp).toLocaleString();
    }

    private normalizeScope(
        scope?: DashboardWidgetScopeSettings
    ): DashboardWidgetScopeSettings {
        const fallback = createDefaultWidgetScope();
        return {
            providers: [...(scope?.providers ?? fallback.providers)],
            playlistIds: [...(scope?.playlistIds ?? fallback.playlistIds)],
        };
    }

    private getProviderFromSource(
        source: 'xtream' | 'stalker' | 'm3u' | undefined,
        fallback: DashboardWidgetProvider
    ): DashboardWidgetProvider {
        if (source === 'xtream' || source === 'stalker' || source === 'm3u') {
            return source;
        }

        return fallback;
    }

    private getRecentTimestamp(item: PlaylistMeta): number {
        return toTimestamp(item.updateDate) || toTimestamp(item.importDate);
    }
}
