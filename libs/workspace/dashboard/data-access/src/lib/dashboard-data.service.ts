import {
    Injectable,
    NgZone,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { firstValueFrom, startWith } from 'rxjs';
import {
    DatabaseService,
    GlobalRecentlyAddedKind,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    XTREAM_DATA_SOURCE,
    XtreamContentItem,
} from '@iptvnator/portal/xtream/data-access';
import {
    buildPlaylistRecentItems,
    Channel,
    M3uFavoriteChannel,
    Playlist,
    PortalAddedItem,
    PortalActivityItem,
    PlaylistMeta,
    PortalActivityType,
    PortalFavoriteItem,
    PortalRecentItem,
    stalkerItemMatchesId,
} from '@iptvnator/shared/interfaces';
import {
    buildStalkerFavoriteItems,
    getActivityTypeLabelKey,
    mapDbFavoriteToItem,
    mapDbRecentlyAddedToItem,
    mapDbRecentToItem,
    toDateTimestamp,
    toTimestamp,
} from './dashboard-mappers';
import {
    PORTAL_PLAYBACK_POSITIONS,
    WorkspaceNavigationTarget,
} from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    getGlobalFavoriteLink as getGlobalFavoriteLinkUtil,
    getGlobalFavoriteNavigationState as getGlobalFavoriteNavigationStateUtil,
    getPlaylistLink as getPlaylistLinkUtil,
    getRecentItemLink as getRecentItemLinkUtil,
    getRecentItemNavigationState as getRecentItemNavigationStateUtil,
    getRecentlyAddedLink as getRecentlyAddedLinkUtil,
    getRecentlyAddedNavigationState as getRecentlyAddedNavigationStateUtil,
    isTypeInKind as isTypeInKindUtil,
    type DashboardContentKind,
} from './dashboard-navigation.util';

export type { DashboardContentKind };

// Compound key for looking up a playback position by recent item — a single
// playlist can contain the same xtream-id for a VOD and an episode (rare,
// but the schema allows it), so contentType is part of the key.
function playbackPositionMapKey(
    playlistId: string,
    contentXtreamId: number,
    contentType: 'vod' | 'episode'
): string {
    return `${playlistId}::${contentXtreamId}::${contentType}`;
}

function seriesPlaybackPositionMapKey(
    playlistId: string,
    seriesXtreamId: number
): string {
    return `${playlistId}::${seriesXtreamId}`;
}

function newestPlaybackPosition(
    current: PlaybackPositionData | null | undefined,
    candidate: PlaybackPositionData | null | undefined
): PlaybackPositionData | null {
    if (!current) {
        return candidate ?? null;
    }
    if (!candidate) {
        return current;
    }
    return (candidate.updatedAt ?? '') > (current.updatedAt ?? '')
        ? candidate
        : current;
}

/** @deprecated Use {@link PortalRecentItem} from `@iptvnator/shared/interfaces` instead. */
export type GlobalRecentItem = PortalRecentItem;
/** @deprecated Use {@link PortalFavoriteItem} from `@iptvnator/shared/interfaces` instead. */
export type DashboardFavoriteItem = PortalFavoriteItem;
/** @deprecated Use {@link PortalAddedItem} from `@iptvnator/shared/interfaces` instead. */
export type DashboardRecentlyAddedItem = PortalAddedItem;
export type DashboardRecentlyAddedFilterKind = GlobalRecentlyAddedKind;

@Injectable({ providedIn: 'root' })
export class DashboardDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly xtreamDataSource = inject(XTREAM_DATA_SOURCE);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly ngZone = inject(NgZone);
    private readonly translate = inject(TranslateService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly favoritesAutoRefreshEnabled = signal(false);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    private readonly xtreamGlobalRecentItems = signal<GlobalRecentItem[]>([]);
    private readonly xtreamRecentlyAddedItemsState = signal<
        DashboardRecentlyAddedItem[]
    >([]);
    private readonly xtreamGlobalFavorites = signal<DashboardFavoriteItem[]>(
        []
    );
    /**
     * Per-M3U-playlist favorites contributions, keyed by playlist ID.
     * Each playlist's contribution lands in the map as soon as ITS load
     * resolves, so the favorites rail flips on a playlist at a time
     * instead of waiting for the slowest of a Promise.all.
     */
    private readonly m3uPlaylistFavoritesMap = signal<
        Map<string, DashboardFavoriteItem[]>
    >(new Map());

    /**
     * Memoized parsed favorites per playlist. The fingerprint includes the
     * favorites JSON and the playlist's update timestamp so a cache hit
     * returns instantly and a refresh / favorites change naturally
     * invalidates without explicit busting. Avoids re-parsing the entire
     * (potentially 90K-channel) playlist payload on repeated dashboard
     * mounts.
     */
    private readonly m3uFavoritesCache = new Map<
        string,
        { fingerprint: string; items: DashboardFavoriteItem[] }
    >();

    private readonly m3uGlobalFavorites = computed<DashboardFavoriteItem[]>(
        () => {
            const map = this.m3uPlaylistFavoritesMap();
            const all: DashboardFavoriteItem[] = [];
            map.forEach((items) => {
                for (const item of items) {
                    all.push(item);
                }
            });
            return all;
        }
    );
    private readonly globalRecentLoadingState = signal(true);
    private readonly globalRecentLoadedState = signal(false);
    private readonly globalRecentDbLoadedState = signal(
        !this.hasPortalActivityStorage
    );
    private readonly globalFavoritesLoadingState = signal(true);
    private readonly globalFavoritesLoadedState = signal(false);
    private readonly xtreamGlobalFavoritesLoadedState = signal(false);
    private readonly playlistBackedGlobalFavoritesLoadedState = signal(false);
    private readonly xtreamRecentlyAddedLoadingState = signal(true);
    private readonly xtreamRecentlyAddedLoadedState = signal(false);
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    readonly playlistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly xtreamPlaylistCount = computed(
        () => this.playlists().filter((playlist) => !!playlist.serverUrl).length
    );
    readonly hasXtreamPlaylists = computed(
        () => this.xtreamPlaylistCount() > 0
    );
    readonly globalRecentLoading = this.globalRecentLoadingState.asReadonly();
    readonly globalRecentLoaded = this.globalRecentLoadedState.asReadonly();
    readonly globalFavoritesLoading =
        this.globalFavoritesLoadingState.asReadonly();
    readonly globalFavoritesLoaded =
        this.globalFavoritesLoadedState.asReadonly();
    readonly xtreamRecentlyAddedLoading =
        this.xtreamRecentlyAddedLoadingState.asReadonly();
    readonly xtreamRecentlyAddedLoaded =
        this.xtreamRecentlyAddedLoadedState.asReadonly();
    readonly xtreamRecentlyAddedItems =
        this.xtreamRecentlyAddedItemsState.asReadonly();

    private get hasPortalActivityStorage(): boolean {
        return this.runtime.supportsPortalActivityStorage;
    }

    readonly dashboardReady = computed(
        () =>
            this.playlistsLoaded() &&
            this.globalRecentLoaded() &&
            this.globalFavoritesLoaded() &&
            (!this.hasXtreamPlaylists() || this.xtreamRecentlyAddedLoaded())
    );

    private readonly playlistFavoritesReloadKey = computed(() => {
        if (!this.playlistsLoaded()) {
            return null;
        }

        return this.playlists()
            .map((playlist) =>
                [
                    playlist._id,
                    playlist.serverUrl
                        ? 'xtream'
                        : playlist.macAddress
                          ? 'stalker'
                          : 'm3u',
                    JSON.stringify(playlist.favorites ?? []),
                ].join('::')
            )
            .join('|');
    });

    readonly playlistBackedGlobalRecentItems = computed<GlobalRecentItem[]>(
        () => {
            this.languageTick();
            return buildPlaylistRecentItems(this.playlists(), {
                stalker: this.translateText(
                    'WORKSPACE.DASHBOARD.STALKER_PORTAL'
                ),
                m3u: this.translateText('WORKSPACE.DASHBOARD.M3U'),
            });
        }
    );

    readonly globalRecentItems = computed<GlobalRecentItem[]>(() =>
        [
            ...this.xtreamGlobalRecentItems(),
            ...this.playlistBackedGlobalRecentItems(),
        ]
            .sort(
                (a, b) =>
                    toDateTimestamp(b.viewed_at) - toDateTimestamp(a.viewed_at)
            )
            .slice(0, 200)
    );

    // Split the recent list by content type so the dashboard can render
    // movies/series ("Continue watching") separately from live channels
    // ("Live now on your favorites"). Two card formats — one rail each.
    readonly globalRecentVodItems = computed<GlobalRecentItem[]>(() =>
        this.globalRecentItems().filter(
            (item) => item.type === 'movie' || item.type === 'series'
        )
    );

    readonly globalRecentLiveItems = computed<GlobalRecentItem[]>(() =>
        this.globalRecentItems().filter((item) => item.type === 'live')
    );

    // Favorited live channels — the dashboard's "Live now" rail uses this
    // source only. Recently watched live channels have their own dashboard rail.
    readonly globalFavoriteLiveItems = computed<DashboardFavoriteItem[]>(() =>
        this.globalFavoriteItems().filter((item) => item.type === 'live')
    );

    // Playback positions, keyed by `${playlist_id}::${contentXtreamId}::${type}`.
    // Loaded lazily on dashboard mount (and refreshed when recent items
    // change) so the hero + Continue Watching cards can show "X min left"
    // and a progress bar. Live channels never have positions; M3U content
    // doesn't either. Map starts empty and degrades cleanly on missing data.
    private readonly playbackPositionsMap = signal<
        Map<string, PlaybackPositionData>
    >(new Map());
    private readonly playbackPositionsBySeriesMap = signal<
        Map<string, PlaybackPositionData>
    >(new Map());

    readonly playbackPositions$ = this.playbackPositionsMap.asReadonly();

    getPlaybackPositionForItem(
        item: PortalActivityItem
    ): PlaybackPositionData | null {
        if (item.type !== 'movie' && item.type !== 'series') {
            return null;
        }
        const xtreamId =
            typeof item.xtream_id === 'number'
                ? item.xtream_id
                : Number(item.xtream_id);
        if (!Number.isFinite(xtreamId)) {
            return null;
        }

        if (item.type === 'movie') {
            const key = playbackPositionMapKey(
                item.playlist_id,
                xtreamId,
                'vod'
            );
            return this.playbackPositionsMap().get(key) ?? null;
        }

        // Series recent_items rows carry either the series id (the series
        // landing page writes the series itself) or, for direct-play flows,
        // the episode id. Match both shapes through keyed maps so card renders
        // do not scan every saved playback position.
        const episodePosition =
            this.playbackPositionsMap().get(
                playbackPositionMapKey(item.playlist_id, xtreamId, 'episode')
            ) ?? null;
        const seriesPosition =
            this.playbackPositionsBySeriesMap().get(
                seriesPlaybackPositionMapKey(item.playlist_id, xtreamId)
            ) ?? null;
        return newestPlaybackPosition(episodePosition, seriesPosition);
    }

    /**
     * Refresh the in-memory positions map for every playlist that owns at
     * least one VOD/series recent item. Per-playlist bulk fetch is one IPC
     * round-trip each (vs N+1 per content item), so this stays cheap even
     * on heavy libraries.
     */
    async reloadPlaybackPositions(): Promise<void> {
        const playlistIds = new Set<string>();
        for (const item of this.globalRecentItems()) {
            if (item.type === 'movie' || item.type === 'series') {
                playlistIds.add(item.playlist_id);
            }
        }
        if (playlistIds.size === 0) {
            this.playbackPositionsMap.set(new Map());
            this.playbackPositionsBySeriesMap.set(new Map());
            return;
        }

        const next = new Map<string, PlaybackPositionData>();
        const nextBySeries = new Map<string, PlaybackPositionData>();
        for (const playlistId of playlistIds) {
            try {
                const positions =
                    await this.playbackPositions.getAllPlaybackPositions(
                        playlistId
                    );
                for (const position of positions) {
                    next.set(
                        playbackPositionMapKey(
                            playlistId,
                            position.contentXtreamId,
                            position.contentType
                        ),
                        position
                    );
                    if (
                        position.contentType === 'episode' &&
                        Number.isFinite(position.seriesXtreamId)
                    ) {
                        const seriesKey = seriesPlaybackPositionMapKey(
                            playlistId,
                            position.seriesXtreamId as number
                        );
                        nextBySeries.set(
                            seriesKey,
                            newestPlaybackPosition(
                                nextBySeries.get(seriesKey),
                                position
                            ) as PlaybackPositionData
                        );
                    }
                }
            } catch (err) {
                console.warn(
                    '[DashboardData] Failed to load playback positions for playlist',
                    playlistId,
                    err
                );
            }
        }

        this.ngZone.run(() => {
            this.playbackPositionsMap.set(next);
            this.playbackPositionsBySeriesMap.set(nextBySeries);
        });
    }

    readonly stalkerGlobalFavorites = computed<DashboardFavoriteItem[]>(() => {
        this.languageTick();
        return buildStalkerFavoriteItems(
            this.playlists(),
            this.translateText('WORKSPACE.DASHBOARD.STALKER_PORTAL')
        );
    });

    readonly globalFavoriteItems = computed(() =>
        [
            ...this.xtreamGlobalFavorites(),
            ...this.m3uGlobalFavorites(),
            ...this.stalkerGlobalFavorites(),
        ]
            .sort((a, b) => toTimestamp(b.added_at) - toTimestamp(a.added_at))
            .slice(0, 200)
    );

    private readonly recentPlaylistActivityTimestamps = computed(() => {
        const timestamps = new Map<string, number>();

        for (const item of this.globalRecentItems()) {
            const viewedAt = toDateTimestamp(item.viewed_at);
            const current = timestamps.get(item.playlist_id) ?? 0;

            if (viewedAt > current) {
                timestamps.set(item.playlist_id, viewedAt);
            }
        }

        return timestamps;
    });

    constructor() {
        effect(() => {
            this.playlistFavoritesReloadKey();
            if (
                !this.playlistsLoaded() ||
                !this.favoritesAutoRefreshEnabled()
            ) {
                return;
            }

            void this.reloadPlaylistBackedGlobalFavorites();
        });

        effect(() => {
            this.playlistsLoaded();
            this.finishInitialGlobalRecentLoadIfReady();
            this.finishInitialGlobalFavoritesLoadIfReady();
        });

        effect(() => {
            if (this.hasXtreamPlaylists()) {
                return;
            }

            this.ngZone.run(() => {
                this.xtreamRecentlyAddedItemsState.set([]);
                this.xtreamRecentlyAddedLoadingState.set(false);
                this.xtreamRecentlyAddedLoadedState.set(true);
            });
        });
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
            .sort((a, b) => {
                const activityDelta =
                    this.getPlaylistActivityTimestamp(b) -
                    this.getPlaylistActivityTimestamp(a);
                if (activityDelta !== 0) {
                    return activityDelta;
                }

                const metadataDelta =
                    this.getRecentTimestamp(b) - this.getRecentTimestamp(a);
                if (metadataDelta !== 0) {
                    return metadataDelta;
                }

                return a._id.localeCompare(b._id);
            })
            .slice(0, 12)
    );

    readonly quickRecent = computed(() => this.recentPlaylists().slice(0, 4));

    async reloadGlobalRecentItems(): Promise<void> {
        if (!this.globalRecentLoaded()) {
            this.globalRecentLoadingState.set(true);
        }

        if (!this.hasPortalActivityStorage) {
            const recentItems = await this.loadPwaXtreamGlobalRecentItems();
            this.ngZone.run(() =>
                this.xtreamGlobalRecentItems.set(recentItems)
            );
            this.globalRecentDbLoadedState.set(true);
            this.finishInitialGlobalRecentLoadIfReady();
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
        } finally {
            this.globalRecentDbLoadedState.set(true);
            this.finishInitialGlobalRecentLoadIfReady();
        }
    }

    async reloadGlobalFavorites(): Promise<void> {
        if (!this.globalFavoritesLoaded()) {
            this.globalFavoritesLoadingState.set(true);
            this.xtreamGlobalFavoritesLoadedState.set(false);
            this.playlistBackedGlobalFavoritesLoadedState.set(false);
        }

        const xtreamReload = this.reloadXtreamGlobalFavorites().finally(() => {
            this.ngZone.run(() =>
                this.xtreamGlobalFavoritesLoadedState.set(true)
            );
            this.finishInitialGlobalFavoritesLoadIfReady();
        });
        const m3uReload = this.reloadPlaylistBackedGlobalFavorites();

        await Promise.all([xtreamReload, m3uReload]);
        if (
            this.playlistsLoaded() &&
            !this.playlistBackedGlobalFavoritesLoadedState()
        ) {
            await this.reloadPlaylistBackedGlobalFavorites();
        }
        this.finishInitialGlobalFavoritesLoadIfReady();
        this.favoritesAutoRefreshEnabled.set(true);
    }

    async getGlobalRecentlyAddedItems(
        kind: DashboardRecentlyAddedFilterKind,
        limit = 200
    ): Promise<DashboardRecentlyAddedItem[]> {
        if (!this.hasPortalActivityStorage) {
            return [];
        }

        const items = await this.dbService.getGlobalRecentlyAdded(kind, limit);
        return items
            .map((item) => mapDbRecentlyAddedToItem(item))
            .sort((a, b) => toTimestamp(b.added_at) - toTimestamp(a.added_at));
    }

    async getXtreamRecentlyAddedItems(
        limit = 20
    ): Promise<DashboardRecentlyAddedItem[]> {
        if (!this.hasPortalActivityStorage) {
            return [];
        }

        const items = await this.dbService.getGlobalRecentlyAdded(
            'all',
            limit,
            'xtream'
        );
        return items
            .map((item) => mapDbRecentlyAddedToItem(item))
            .sort((a, b) => toTimestamp(b.added_at) - toTimestamp(a.added_at));
    }

    async reloadXtreamRecentlyAddedItems(limit = 20): Promise<void> {
        if (!this.xtreamRecentlyAddedLoaded()) {
            this.xtreamRecentlyAddedLoadingState.set(true);
        }

        if (!this.hasPortalActivityStorage) {
            this.ngZone.run(() => {
                this.xtreamRecentlyAddedItemsState.set([]);
                this.xtreamRecentlyAddedLoadingState.set(false);
                this.xtreamRecentlyAddedLoadedState.set(true);
            });
            return;
        }

        try {
            const items = await this.getXtreamRecentlyAddedItems(limit);
            this.ngZone.run(() =>
                this.xtreamRecentlyAddedItemsState.set(items)
            );
        } catch (err) {
            console.warn(
                '[DashboardData] Failed to reload Xtream recently added items',
                err
            );
            this.ngZone.run(() => this.xtreamRecentlyAddedItemsState.set([]));
        } finally {
            this.ngZone.run(() => {
                this.xtreamRecentlyAddedLoadingState.set(false);
                this.xtreamRecentlyAddedLoadedState.set(true);
            });
        }
    }

    private async reloadXtreamGlobalFavorites(): Promise<void> {
        if (!this.hasPortalActivityStorage) {
            const favorites = await this.loadPwaXtreamGlobalFavorites();
            this.ngZone.run(() => this.xtreamGlobalFavorites.set(favorites));
            return;
        }

        try {
            const favorites = await this.dbService.getAllGlobalFavorites();
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

    private async loadPwaXtreamGlobalRecentItems(): Promise<
        GlobalRecentItem[]
    > {
        const nested = await Promise.all(
            this.getXtreamPlaylists().map(async (playlist) => {
                const rows = await this.xtreamDataSource.getRecentItems(
                    playlist._id
                );
                return rows.map((item) =>
                    this.mapPwaXtreamRecentItem(item, playlist)
                );
            })
        );
        return nested.reduce<GlobalRecentItem[]>(
            (items, playlistItems) => items.concat(playlistItems),
            []
        );
    }

    private async loadPwaXtreamGlobalFavorites(): Promise<
        DashboardFavoriteItem[]
    > {
        const nested = await Promise.all(
            this.getXtreamPlaylists().map(async (playlist) => {
                const rows = await this.xtreamDataSource.getFavorites(
                    playlist._id
                );
                return rows.map((item) =>
                    this.mapPwaXtreamFavoriteItem(item, playlist)
                );
            })
        );
        return nested.reduce<DashboardFavoriteItem[]>(
            (items, playlistItems) => items.concat(playlistItems),
            []
        );
    }

    private getXtreamPlaylists(): PlaylistMeta[] {
        return this.playlists().filter(
            (playlist) => !!playlist.serverUrl && !playlist.macAddress
        );
    }

    private mapPwaXtreamRecentItem(
        item: XtreamContentItem,
        playlist: PlaylistMeta
    ): GlobalRecentItem {
        return {
            id: item.id,
            title: item.title,
            type: this.normalizeXtreamActivityType(item.type),
            playlist_id: playlist._id,
            playlist_name: playlist.title || 'Xtream',
            viewed_at: item.viewed_at ?? '',
            category_id: item.category_id,
            xtream_id: item.xtream_id,
            poster_url: item.poster_url,
            backdrop_url: item.backdrop_url ?? undefined,
            source: 'xtream',
        };
    }

    private mapPwaXtreamFavoriteItem(
        item: XtreamContentItem,
        playlist: PlaylistMeta
    ): DashboardFavoriteItem {
        return {
            id: item.id,
            title: item.title,
            type: this.normalizeXtreamActivityType(item.type),
            playlist_id: playlist._id,
            playlist_name: playlist.title || 'Xtream',
            added_at: item.added_at || item.added || new Date(0).toISOString(),
            category_id: item.category_id,
            xtream_id: item.xtream_id,
            poster_url: item.poster_url,
            backdrop_url: item.backdrop_url ?? undefined,
            source: 'xtream',
        };
    }

    private normalizeXtreamActivityType(type: string): PortalActivityType {
        if (type === 'live' || type === 'series') {
            return type;
        }
        return 'movie';
    }

    private async reloadPlaylistBackedGlobalFavorites(): Promise<void> {
        const loaded = await this.refreshPlaylistBackedGlobalFavorites();
        if (!loaded) {
            return;
        }

        this.ngZone.run(() =>
            this.playlistBackedGlobalFavoritesLoadedState.set(true)
        );
        this.finishInitialGlobalFavoritesLoadIfReady();
    }

    private async refreshPlaylistBackedGlobalFavorites(): Promise<boolean> {
        if (!this.playlistsLoaded()) {
            return false;
        }

        await this.reloadM3uGlobalFavorites();
        return true;
    }

    private async reloadM3uGlobalFavorites(): Promise<void> {
        const m3uPlaylists = this.playlists().filter(
            (playlist) =>
                !playlist.serverUrl &&
                !playlist.macAddress &&
                Array.isArray(playlist.favorites) &&
                playlist.favorites.some(
                    (favorite): favorite is string =>
                        typeof favorite === 'string' &&
                        favorite.trim().length > 0
                )
        );

        const validIds = new Set(m3uPlaylists.map((p) => p._id));

        // Drop entries for M3U playlists no longer in the eligible set
        // (removed playlists or playlists whose favorites were cleared).
        this.ngZone.run(() => {
            this.m3uPlaylistFavoritesMap.update((prev) => {
                let next: Map<string, DashboardFavoriteItem[]> | null = null;
                for (const id of prev.keys()) {
                    if (!validIds.has(id)) {
                        next ??= new Map(prev);
                        next.delete(id);
                    }
                }
                return next ?? prev;
            });
        });
        for (const id of Array.from(this.m3uFavoritesCache.keys())) {
            if (!validIds.has(id)) {
                this.m3uFavoritesCache.delete(id);
            }
        }

        if (m3uPlaylists.length === 0) {
            return;
        }

        // Stream per-playlist results into the map as each load resolves.
        // The favorites rail re-renders incrementally — a slow playlist no
        // longer pins the rest behind a Promise.all on the slowest one.
        await Promise.all(
            m3uPlaylists.map(async (playlist) => {
                let items: DashboardFavoriteItem[];
                try {
                    items = await this.loadM3uPlaylistFavorites(playlist);
                } catch (err) {
                    console.warn(
                        '[DashboardData] Failed to load M3U favorites for playlist',
                        playlist._id,
                        err
                    );
                    items = [];
                }

                this.ngZone.run(() => {
                    this.m3uPlaylistFavoritesMap.update((prev) => {
                        const next = new Map(prev);
                        next.set(playlist._id, items);
                        return next;
                    });
                });
            })
        );
    }

    private finishInitialGlobalFavoritesLoadIfReady(): void {
        if (
            !this.playlistsLoaded() ||
            !this.xtreamGlobalFavoritesLoadedState() ||
            !this.playlistBackedGlobalFavoritesLoadedState()
        ) {
            return;
        }

        this.ngZone.run(() => {
            this.globalFavoritesLoadedState.set(true);
            this.globalFavoritesLoadingState.set(false);
        });
    }

    private finishInitialGlobalRecentLoadIfReady(): void {
        if (!this.playlistsLoaded() || !this.globalRecentDbLoadedState()) {
            return;
        }

        this.ngZone.run(() => {
            this.globalRecentLoadedState.set(true);
            this.globalRecentLoadingState.set(false);
        });
    }

    isTypeInKind(
        type: PortalActivityType,
        kind: DashboardContentKind
    ): boolean {
        return isTypeInKindUtil(type, kind);
    }

    getPlaylistLink(playlist: PlaylistMeta): string[] {
        return getPlaylistLinkUtil(playlist);
    }

    getPlaylistProvider(playlist: PlaylistMeta): string {
        this.languageTick();

        if (playlist.serverUrl) {
            return this.translateText('WORKSPACE.DASHBOARD.XTREAM');
        }

        if (playlist.macAddress) {
            return this.translateText('WORKSPACE.DASHBOARD.STALKER');
        }

        return this.translateText('WORKSPACE.DASHBOARD.M3U');
    }

    getRecentItemProviderLabel(item: GlobalRecentItem): string {
        this.languageTick();

        if (item.source === 'stalker') {
            return this.translateText('WORKSPACE.DASHBOARD.STALKER');
        }
        if (item.source === 'xtream') {
            return this.translateText('WORKSPACE.DASHBOARD.XTREAM');
        }
        if (item.source === 'm3u') {
            return this.translateText('WORKSPACE.DASHBOARD.M3U');
        }
        return this.translateText('WORKSPACE.DASHBOARD.PROVIDER');
    }

    getRecentItemTypeLabel(item: GlobalRecentItem): string {
        this.languageTick();
        return this.translateText(getActivityTypeLabelKey(item.type));
    }

    getRecentItemLink(item: GlobalRecentItem): string[] {
        return getRecentItemLinkUtil(item);
    }

    getRecentItemNavigationState(
        item: GlobalRecentItem
    ): WorkspaceNavigationTarget['state'] {
        return getRecentItemNavigationStateUtil(item);
    }

    async removeGlobalRecentItem(item: GlobalRecentItem): Promise<void> {
        if (item.source === 'xtream') {
            if (this.hasPortalActivityStorage) {
                await this.dbService.removeRecentItem(
                    item.id as number,
                    item.playlist_id
                );
            } else {
                await this.xtreamDataSource.removeRecentItem(
                    item.id as number,
                    item.playlist_id
                );
            }
            await this.reloadGlobalRecentItems();
            return;
        }

        if (item.source === 'stalker') {
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.removeFromPortalRecentlyViewed(
                    item.playlist_id,
                    item.id
                )
            );

            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: item.playlist_id,
                        recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                    } as unknown as PlaylistMeta,
                }) as any
            );
            return;
        }

        if (item.source === 'm3u') {
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.removeFromM3uRecentlyViewed(
                    item.playlist_id,
                    String(item.xtream_id ?? item.id)
                )
            );

            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: item.playlist_id,
                        recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                    } as unknown as PlaylistMeta,
                }) as any
            );
        }
    }

    getFavoriteItemProviderLabel(item: DashboardFavoriteItem): string {
        return this.getActivityItemProviderLabel(item);
    }

    getRecentlyAddedItemProviderLabel(
        item: DashboardRecentlyAddedItem
    ): string {
        return this.getActivityItemProviderLabel(item);
    }

    private getActivityItemProviderLabel(
        item: Pick<PortalActivityItem, 'source'>
    ): string {
        this.languageTick();

        if (item.source === 'stalker') {
            return this.translateText('WORKSPACE.DASHBOARD.STALKER');
        }
        if (item.source === 'xtream') {
            return this.translateText('WORKSPACE.DASHBOARD.XTREAM');
        }
        if (item.source === 'm3u') {
            return this.translateText('WORKSPACE.DASHBOARD.M3U');
        }
        return this.translateText('WORKSPACE.DASHBOARD.PROVIDER');
    }

    getFavoriteItemTypeLabel(item: DashboardFavoriteItem): string {
        return this.getActivityItemTypeLabel(item);
    }

    getRecentlyAddedItemTypeLabel(item: DashboardRecentlyAddedItem): string {
        return this.getActivityItemTypeLabel(item);
    }

    private getActivityItemTypeLabel(
        item: Pick<PortalActivityItem, 'type'>
    ): string {
        this.languageTick();
        return this.translateText(getActivityTypeLabelKey(item.type));
    }

    getGlobalFavoriteLink(item: DashboardFavoriteItem): string[] {
        return getGlobalFavoriteLinkUtil(item);
    }

    getGlobalFavoriteNavigationState(
        item: DashboardFavoriteItem
    ): WorkspaceNavigationTarget['state'] {
        return getGlobalFavoriteNavigationStateUtil(item);
    }

    getRecentlyAddedLink(item: DashboardRecentlyAddedItem): string[] {
        return getRecentlyAddedLinkUtil(item);
    }

    getRecentlyAddedNavigationState(
        item: DashboardRecentlyAddedItem
    ): WorkspaceNavigationTarget['state'] {
        return getRecentlyAddedNavigationStateUtil(item);
    }

    async removeGlobalFavorite(item: DashboardFavoriteItem): Promise<void> {
        if (item.source === 'xtream') {
            if (this.hasPortalActivityStorage) {
                await this.dbService.removeFromFavorites(
                    item.id as number,
                    item.playlist_id
                );
            } else {
                await this.xtreamDataSource.removeFavorite(
                    item.id as number,
                    item.playlist_id
                );
            }
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

        if (item.source === 'm3u') {
            const playlist = await firstValueFrom(
                this.playlistsService.getPlaylistById(item.playlist_id)
            );
            const currentFavorites = Array.isArray(playlist?.favorites)
                ? playlist.favorites.filter(
                      (favorite): favorite is string =>
                          typeof favorite === 'string'
                  )
                : [];
            const filteredFavorites = currentFavorites.filter(
                (favorite) => favorite !== String(item.id)
            );

            await firstValueFrom(
                this.playlistsService.setFavorites(
                    item.playlist_id,
                    filteredFavorites
                )
            );
            await this.reloadGlobalFavorites();
        }
    }

    formatTimestamp(value?: string | number): string {
        this.languageTick();

        const timestamp = toTimestamp(value);
        if (!timestamp) {
            return this.translateText('WORKSPACE.DASHBOARD.NOT_YET_SYNCED');
        }

        return new Date(timestamp).toLocaleString(this.getLocale());
    }

    private async loadM3uPlaylistFavorites(
        playlistMeta: PlaylistMeta
    ): Promise<DashboardFavoriteItem[]> {
        // Cache fingerprint covers what affects the result: the favorites
        // list itself and the playlist's update timestamp (changes mean
        // channels may have been added/removed by a refresh).
        const fingerprint = this.buildM3uFavoritesFingerprint(playlistMeta);
        const cached = this.m3uFavoritesCache.get(playlistMeta._id);
        if (cached && cached.fingerprint === fingerprint) {
            return cached.items;
        }

        const fastPathItems =
            await this.loadM3uPlaylistFavoritesFromResolvedChannels(
                playlistMeta,
                fingerprint
            );
        if (fastPathItems !== null) {
            return fastPathItems;
        }

        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(playlistMeta._id)
        )) as Playlist & {
            playlist?: {
                items?: Channel[];
            };
        };
        const favorites = Array.isArray(playlist?.favorites)
            ? playlist.favorites.filter(
                  (favorite): favorite is string =>
                      typeof favorite === 'string' && favorite.trim().length > 0
              )
            : [];

        if (favorites.length === 0) {
            this.m3uFavoritesCache.set(playlistMeta._id, {
                fingerprint,
                items: [],
            });
            return [];
        }

        const items: Channel[] = Array.isArray(playlist?.playlist?.items)
            ? (playlist.playlist.items as Channel[])
            : [];
        const fallbackTimestamp =
            this.getM3uFavoriteTimestamp(playlistMeta) ??
            new Date(0).toISOString();
        const favoritePositions = new Map<string, number>();

        favorites.forEach((favorite, index) => {
            if (!favoritePositions.has(favorite)) {
                favoritePositions.set(favorite, index);
            }
        });

        const computedItems = items.reduce<DashboardFavoriteItem[]>(
            (acc, channel) => {
                const channelId = String(channel.id ?? '').trim();
                const channelUrl = String(channel.url ?? '').trim();
                const channelIdFavoritePosition =
                    favoritePositions.get(channelId);
                const channelUrlFavoritePosition =
                    favoritePositions.get(channelUrl);
                const matchedFavoriteId =
                    channelIdFavoritePosition !== undefined &&
                    (channelUrlFavoritePosition === undefined ||
                        channelIdFavoritePosition <= channelUrlFavoritePosition)
                        ? channelId
                        : channelUrlFavoritePosition !== undefined
                          ? channelUrl
                          : null;

                if (!matchedFavoriteId) {
                    return acc;
                }

                acc.push(
                    this.createM3uFavoriteItem(
                        playlistMeta,
                        matchedFavoriteId,
                        channel,
                        fallbackTimestamp
                    )
                );
                return acc;
            },
            []
        );

        this.m3uFavoritesCache.set(playlistMeta._id, {
            fingerprint,
            items: computedItems,
        });
        return computedItems;
    }

    private async loadM3uPlaylistFavoritesFromResolvedChannels(
        playlistMeta: PlaylistMeta,
        fingerprint: string
    ): Promise<DashboardFavoriteItem[] | null> {
        let resolvedChannels: M3uFavoriteChannel[] | null;
        try {
            resolvedChannels = await firstValueFrom(
                this.playlistsService.getM3uFavoriteChannels(playlistMeta._id)
            );
        } catch (err) {
            console.warn(
                '[DashboardData] Failed to load resolved M3U favorites, falling back to full playlist payload',
                err
            );
            return null;
        }

        if (resolvedChannels === null) {
            return null;
        }

        const fallbackTimestamp =
            this.getM3uFavoriteTimestamp(playlistMeta) ??
            new Date(0).toISOString();
        const items = resolvedChannels.slice().map((favorite) =>
            this.createM3uFavoriteItem(
                playlistMeta,
                favorite.favoriteId,
                favorite.channel,
                fallbackTimestamp
            )
        );

        this.m3uFavoritesCache.set(playlistMeta._id, {
            fingerprint,
            items,
        });
        return items;
    }

    private createM3uFavoriteItem(
        playlistMeta: PlaylistMeta,
        favoriteId: string,
        channel: Channel,
        fallbackTimestamp: string
    ): DashboardFavoriteItem {
        const channelId = String(channel.id ?? '').trim();

        return {
            id: favoriteId,
            title:
                channel.name?.trim() ||
                channel.tvg?.name?.trim() ||
                channelId ||
                favoriteId,
            type: 'live',
            playlist_id: playlistMeta._id,
            playlist_name: playlistMeta.title || playlistMeta.filename || 'M3U',
            added_at: fallbackTimestamp,
            category_id: 'live',
            xtream_id: favoriteId,
            poster_url: channel.tvg?.logo || undefined,
            epg_lookup_key:
                channel.tvg?.id?.trim() ||
                channel.tvg?.name?.trim() ||
                channel.name?.trim() ||
                undefined,
            source: 'm3u',
        };
    }

    private buildM3uFavoritesFingerprint(playlist: PlaylistMeta): string {
        // updateDate changes on refresh (channel list may have changed);
        // favorites JSON changes on add/remove. Together they cover every
        // way the result could differ.
        const favoritesPart = JSON.stringify(playlist.favorites ?? []);
        const updatePart = String(
            playlist.updateDate ?? playlist.importDate ?? ''
        );
        return `${updatePart}::${favoritesPart}`;
    }

    private getM3uFavoriteTimestamp(playlist: PlaylistMeta): string | null {
        if (playlist.updateDate) {
            return new Date(playlist.updateDate).toISOString();
        }

        return typeof playlist.importDate === 'string'
            ? playlist.importDate
            : null;
    }

    private getPlaylistActivityTimestamp(item: PlaylistMeta): number {
        return this.recentPlaylistActivityTimestamps().get(item._id) ?? 0;
    }

    private getRecentTimestamp(item: PlaylistMeta): number {
        return toTimestamp(item.updateDate) || toTimestamp(item.importDate);
    }

    private getLocale(): string | undefined {
        return (
            this.translate.currentLang ||
            this.translate.defaultLang ||
            undefined
        );
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
