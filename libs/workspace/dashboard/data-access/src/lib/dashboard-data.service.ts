import { Injectable, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectActivePlaylist, selectAllPlaylistsMeta } from 'm3u-state';
import {
    DatabaseService,
    GlobalFavoriteItem as DbGlobalFavoriteItem,
    GlobalRecentItem as DbGlobalRecentItem,
} from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import {
    DashboardWidgetProvider,
    DashboardWidgetScopeSettings,
    createDefaultWidgetScope,
} from './dashboard-widget.model';

type RecentActivityType = 'live' | 'movie' | 'series';

export type DashboardContentKind = 'all' | 'channels' | 'vod' | 'series';

interface GlobalRecentItem {
    id: string | number;
    title: string;
    type: RecentActivityType;
    playlist_id: string;
    playlist_name?: string;
    viewed_at: string;
    category_id: string | number;
    xtream_id: string | number;
    poster_url?: string;
    source?: 'xtream' | 'stalker';
    stalker_item?: unknown;
}

export interface DashboardFavoriteItem {
    id: string | number;
    title: string;
    type: RecentActivityType;
    playlist_id: string;
    playlist_name?: string;
    added_at: string;
    category_id: string | number;
    xtream_id: string | number;
    poster_url?: string;
    source?: 'xtream' | 'stalker';
    stalker_item?: unknown;
}

interface DashboardNavigationTarget {
    link: string[];
    state?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class DashboardDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);

    private readonly xtreamGlobalRecentItems = signal<GlobalRecentItem[]>([]);
    private readonly xtreamGlobalFavorites = signal<DashboardFavoriteItem[]>(
        []
    );
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    readonly activePlaylist = this.store.selectSignal(selectActivePlaylist);

    readonly stalkerGlobalRecentItems = computed<GlobalRecentItem[]>(() =>
        this.buildStalkerGlobalRecentItems(this.playlists())
    );

    readonly globalRecentItems = computed<GlobalRecentItem[]>(() =>
        [...this.xtreamGlobalRecentItems(), ...this.stalkerGlobalRecentItems()]
            .sort(
                (a, b) =>
                    this.toDateTimestamp(b.viewed_at) -
                    this.toDateTimestamp(a.viewed_at)
            )
            .slice(0, 200)
    );

    readonly stalkerGlobalFavorites = computed<DashboardFavoriteItem[]>(() =>
        this.buildStalkerGlobalFavorites(this.playlists())
    );

    readonly globalFavoriteItems = computed(() =>
        [...this.xtreamGlobalFavorites(), ...this.stalkerGlobalFavorites()]
            .sort(
                (a, b) =>
                    this.toTimestamp(b.added_at) - this.toTimestamp(a.added_at)
            )
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
                this.mapGlobalRecent(item)
            );
            this.xtreamGlobalRecentItems.set(normalized);
        } catch {
            this.xtreamGlobalRecentItems.set([]);
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
                this.mapGlobalFavorite(item)
            );
            this.xtreamGlobalFavorites.set(normalized);
        } catch {
            this.xtreamGlobalFavorites.set([]);
        }
    }

    isTypeInKind(
        type: RecentActivityType,
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
        return this.getTypeLabel(item.type);
    }

    getRecentItemLink(item: GlobalRecentItem): string[] {
        return this.getRecentItemNavigation(item).link;
    }

    getRecentItemNavigationState(
        item: GlobalRecentItem
    ): Record<string, unknown> | undefined {
        return this.getRecentItemNavigation(item).state;
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
        return this.getTypeLabel(item.type);
    }

    getGlobalFavoriteLink(item: DashboardFavoriteItem): string[] {
        return this.getGlobalFavoriteNavigation(item).link;
    }

    getGlobalFavoriteNavigationState(
        item: DashboardFavoriteItem
    ): Record<string, unknown> | undefined {
        return this.getGlobalFavoriteNavigation(item).state;
    }

    formatTimestamp(value?: string | number): string {
        const timestamp = this.toTimestamp(value);
        if (!timestamp) {
            return 'Not yet synced';
        }

        return new Date(timestamp).toLocaleString();
    }

    private mapGlobalFavorite(
        item: DbGlobalFavoriteItem
    ): DashboardFavoriteItem {
        return {
            id: item.id,
            title: item.title,
            type: this.normalizeType(item.type),
            playlist_id: item.playlist_id,
            playlist_name: item.playlist_name,
            added_at: this.normalizeDateString(item.added_at),
            category_id: item.category_id,
            xtream_id: item.xtream_id,
            poster_url: item.poster_url,
            source: 'xtream',
        };
    }

    private mapGlobalRecent(item: DbGlobalRecentItem): GlobalRecentItem {
        return {
            id: item.id,
            title: item.title,
            type: this.normalizeType(item.type),
            playlist_id: item.playlist_id,
            playlist_name: item.playlist_name,
            viewed_at: this.normalizeDateString(item.viewed_at),
            category_id: item.category_id,
            xtream_id: item.xtream_id,
            poster_url: item.poster_url,
            source: 'xtream',
        };
    }

    private buildStalkerGlobalRecentItems(
        playlists: PlaylistMeta[]
    ): GlobalRecentItem[] {
        const items = playlists
            .filter((playlist) => Boolean(playlist.macAddress))
            .reduce<GlobalRecentItem[]>((acc, playlist) => {
                const recentItems = Array.isArray(
                    (playlist as { recentlyViewed?: unknown[] }).recentlyViewed
                )
                    ? ((playlist as { recentlyViewed?: unknown[] })
                          .recentlyViewed ?? [])
                    : [];

                const mapped = recentItems.map((rawItem, index: number) => {
                    const item = (rawItem ?? {}) as Record<string, unknown>;
                    const categoryId = String(item.category_id ?? '');
                    const id = String(
                        item.id ??
                            item.stream_id ??
                            item.series_id ??
                            item.movie_id ??
                            `${playlist._id}-${index}`
                    );
                    const title = String(
                        item.title ?? item.o_name ?? item.name ?? 'Unknown'
                    );
                    const posterUrl = String(
                        item.cover ?? item.logo ?? item.poster_url ?? ''
                    );

                    return {
                        id,
                        title,
                        type: this.normalizeStalkerType(item),
                        playlist_id: playlist._id,
                        playlist_name: playlist.title || 'Stalker Portal',
                        viewed_at: this.normalizeDateString(item.added_at),
                        category_id: categoryId,
                        xtream_id: id,
                        poster_url: posterUrl,
                        source: 'stalker' as const,
                        stalker_item: rawItem,
                    };
                });

                acc.push(...mapped);
                return acc;
            }, []);

        return items.sort(
            (a, b) =>
                this.toDateTimestamp(b.viewed_at) -
                this.toDateTimestamp(a.viewed_at)
        );
    }

    private buildStalkerGlobalFavorites(
        playlists: PlaylistMeta[]
    ): DashboardFavoriteItem[] {
        const items = playlists
            .filter((playlist) => Boolean(playlist.macAddress))
            .reduce<DashboardFavoriteItem[]>((acc, playlist) => {
                const favorites = Array.isArray(playlist.favorites)
                    ? playlist.favorites
                    : [];

                const mapped = favorites.map((item, index) => {
                    const categoryId = String((item as any)?.category_id ?? '');
                    const type = this.normalizeStalkerType(item);
                    const id = String(
                        (item as any)?.id ??
                            (item as any)?.stream_id ??
                            (item as any)?.series_id ??
                            (item as any)?.movie_id ??
                            `${playlist._id}-${index}`
                    );

                    return {
                        id,
                        title:
                            (item as any)?.title ??
                            (item as any)?.o_name ??
                            (item as any)?.name ??
                            'Unknown',
                        type,
                        playlist_id: playlist._id,
                        playlist_name: playlist.title || 'Stalker Portal',
                        added_at: this.normalizeDateString(
                            (item as any)?.added_at
                        ),
                        category_id: categoryId,
                        xtream_id: id,
                        poster_url:
                            (item as any)?.cover ??
                            (item as any)?.logo ??
                            (item as any)?.poster_url ??
                            '',
                        source: 'stalker' as const,
                        stalker_item: item,
                    };
                });

                acc.push(...mapped);
                return acc;
            }, []);

        return items.sort(
            (a, b) =>
                this.toTimestamp(b.added_at) - this.toTimestamp(a.added_at)
        );
    }

    private normalizeStalkerType(item: unknown): RecentActivityType {
        const categoryId = String(
            (item as any)?.category_id ?? ''
        ).toLowerCase();
        const streamType = String(
            (item as any)?.stream_type ?? ''
        ).toLowerCase();

        if (categoryId === 'itv' || streamType === 'live') {
            return 'live';
        }

        if (
            categoryId === 'series' ||
            (item as any)?.is_series === true ||
            (item as any)?.is_series === 1 ||
            (item as any)?.is_series === '1'
        ) {
            return 'series';
        }

        return 'movie';
    }

    private getRecentItemNavigation(
        item: GlobalRecentItem
    ): DashboardNavigationTarget {
        if (item.source === 'stalker') {
            return {
                link: ['/workspace', 'stalker', item.playlist_id, 'recent'],
                state: {
                    openRecentItem: this.buildStalkerStateItem(
                        item.stalker_item,
                        item
                    ),
                },
            };
        }

        return {
            ...this.buildXtreamNavigationTarget({
                playlistId: item.playlist_id,
                type: item.type,
                categoryId: item.category_id,
                itemId: item.xtream_id,
                title: item.title,
                imageUrl: item.poster_url,
            }),
        };
    }

    private getGlobalFavoriteNavigation(
        item: DashboardFavoriteItem
    ): DashboardNavigationTarget {
        if (item.source === 'stalker') {
            return {
                link: ['/workspace', 'stalker', item.playlist_id, 'favorites'],
                state: {
                    openFavoriteItem: this.buildStalkerStateItem(
                        item.stalker_item,
                        item
                    ),
                },
            };
        }

        return {
            ...this.buildXtreamNavigationTarget({
                playlistId: item.playlist_id,
                type: item.type,
                categoryId: item.category_id,
                itemId: item.xtream_id,
                title: item.title,
                imageUrl: item.poster_url,
            }),
        };
    }

    private buildXtreamNavigationTarget(params: {
        playlistId: string;
        type: RecentActivityType;
        categoryId: string | number;
        itemId: string | number;
        title?: string;
        imageUrl?: string;
    }): DashboardNavigationTarget {
        const link = this.buildXtreamItemLink(params);
        const routeType = this.toXtreamRouteType(params.type);
        if (routeType !== 'live') {
            return { link };
        }

        const streamId = Number(this.toPathSegment(params.itemId));
        if (!Number.isFinite(streamId) || streamId <= 0) {
            return { link };
        }

        return {
            link,
            state: {
                openXtreamLiveItemId: streamId,
                openXtreamLiveTitle: params.title || '',
                openXtreamLivePoster: params.imageUrl || '',
            },
        };
    }

    private buildXtreamItemLink(params: {
        playlistId: string;
        type: RecentActivityType;
        categoryId: string | number;
        itemId: string | number;
    }): string[] {
        const routeType = this.toXtreamRouteType(params.type);
        const categoryId = this.toPathSegment(params.categoryId);
        const itemId = this.toPathSegment(params.itemId);

        if (routeType === 'live') {
            return categoryId
                ? [
                      '/workspace',
                      'xtreams',
                      params.playlistId,
                      'live',
                      categoryId,
                  ]
                : ['/workspace', 'xtreams', params.playlistId, 'live'];
        }

        if (categoryId && itemId) {
            return [
                '/workspace',
                'xtreams',
                params.playlistId,
                routeType,
                categoryId,
                itemId,
            ];
        }

        if (categoryId) {
            return [
                '/workspace',
                'xtreams',
                params.playlistId,
                routeType,
                categoryId,
            ];
        }

        return ['/workspace', 'xtreams', params.playlistId, routeType];
    }

    private buildStalkerStateItem(
        rawItem: unknown,
        fallback: {
            id: string | number;
            title: string;
            type: RecentActivityType;
            poster_url?: string;
        }
    ) {
        const normalizedCategory = this.toStalkerCategoryId(
            (rawItem as any)?.category_id ?? fallback.type
        );
        const normalizedRaw = rawItem
            ? {
                  ...(rawItem as Record<string, unknown>),
                  category_id: normalizedCategory,
              }
            : null;

        if (normalizedRaw) {
            return normalizedRaw;
        }

        const title = fallback.title || 'Unknown';
        return {
            id: String(fallback.id ?? ''),
            title,
            name: title,
            o_name: title,
            category_id: normalizedCategory,
            cover: fallback.poster_url || '',
            logo: fallback.poster_url || '',
        };
    }

    private toXtreamRouteType(
        type: RecentActivityType
    ): 'live' | 'vod' | 'series' {
        if (type === 'movie') {
            return 'vod';
        }
        return type;
    }

    private toStalkerCategoryId(value: unknown): 'vod' | 'series' | 'itv' {
        const normalized = String(value ?? '').toLowerCase();
        if (normalized === 'series') {
            return 'series';
        }
        if (normalized === 'itv' || normalized === 'live') {
            return 'itv';
        }
        return 'vod';
    }

    private toPathSegment(value: string | number): string {
        const segment = String(value ?? '').trim();
        return segment;
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

    private normalizeType(value: string): RecentActivityType {
        return value === 'live' || value === 'series' ? value : 'movie';
    }

    private getTypeLabel(
        type: RecentActivityType
    ): 'Live' | 'Movie' | 'Series' {
        if (type === 'live') {
            return 'Live';
        }

        if (type === 'series') {
            return 'Series';
        }

        return 'Movie';
    }

    private normalizeDateString(value: unknown): string {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return '';
            }
            const ms = value > 10_000_000_000 ? value : value * 1000;
            return new Date(ms).toISOString();
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (/^\d+$/.test(trimmed)) {
                const numeric = Number(trimmed);
                if (Number.isFinite(numeric)) {
                    const ms =
                        numeric > 10_000_000_000 ? numeric : numeric * 1000;
                    return new Date(ms).toISOString();
                }
            }

            const parsed = Date.parse(trimmed);
            if (!Number.isNaN(parsed)) {
                return new Date(parsed).toISOString();
            }
        }

        return '';
    }

    private getRecentTimestamp(item: PlaylistMeta): number {
        return (
            this.toTimestamp(item.updateDate) ||
            this.toTimestamp(item.importDate)
        );
    }

    private toDateTimestamp(value: unknown): number {
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value <= 0) {
                return 0;
            }
            return value > 10_000_000_000 ? value : value * 1000;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (/^\d+$/.test(trimmed)) {
                const numeric = Number(trimmed);
                if (Number.isFinite(numeric) && numeric > 0) {
                    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
                }
                return 0;
            }

            const parsed = Date.parse(trimmed);
            return Number.isNaN(parsed) ? 0 : parsed;
        }

        return 0;
    }

    private toTimestamp(value?: string | number): number {
        if (typeof value === 'number') {
            return value;
        }

        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? 0 : parsed;
        }

        return 0;
    }
}
