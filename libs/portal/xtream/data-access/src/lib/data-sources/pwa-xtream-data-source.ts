import { inject, Injectable, Injector } from '@angular/core';
import {
    ALL_CATEGORIES_WITHHELD,
    foldSearchText,
    ContentMetadataPatch,
    Playlist,
    PlaybackPositionData,
    XtreamPendingRestoreState,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    CategoryType,
    StreamType,
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import {
    DbCategoryType,
    IXtreamDataSource,
    XtreamCollectionRef,
    ProgressCallback,
    XtreamOperationOptions,
    XtreamCategoryFromDb,
    XtreamContentItem,
    XtreamPlaylistData,
} from './xtream-data-source.interface';

import {
    CollectionKey,
    deduplicateRecentItems,
    StoredRecentItem,
    collectionKey,
    typedCollectionRef,
    itemCollectionKey,
    findCollectionItems,
    normalizeFavoriteStorage,
    normalizeRecentStorage,
} from './pwa-collection-identity';

/**
 * LocalStorage keys for PWA persistence
 */
const STORAGE_KEYS = {
    COLLECTION_ITEMS: 'xtream-collection-items',
    FAVORITES: 'xtream-favorites',
    RECENT_ITEMS: 'xtream-recent-items',
    PLAYLISTS: 'xtream-playlists',
    PLAYBACK_POSITIONS: 'xtream-playback-positions',
};

interface XtreamCachedContentItem {
    readonly added?: string;
    readonly backdrop_url?: string | null;
    readonly category_id?: string | number;
    readonly cover?: string;
    readonly cover_big?: string;
    readonly id?: number | string;
    readonly last_modified?: string;
    readonly movie_image?: string;
    readonly name?: string;
    readonly poster?: string;
    readonly poster_url?: string;
    readonly rating?: string | number;
    readonly series_id?: number;
    readonly stream_display_name?: string;
    readonly stream_id?: number;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly type?: string;
    readonly viewed_at?: string;
    readonly xtream_id?: number | string;
}

type StoredXtreamPlaylistData = Omit<XtreamPlaylistData, 'password'> & {
    readonly password?: string;
};

/**
 * PWA implementation of the Xtream data source.
 * Uses API-only strategy: always fetch from API, no database caching.
 * Favorites and recently viewed are stored in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class PwaXtreamDataSource implements IXtreamDataSource {
    private readonly apiService = inject(XtreamApiService);
    private readonly injector = inject(Injector);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly logger = createLogger('PwaXtreamDataSource');
    private readonly contentTypes = ['live', 'movie', 'series'] as const;

    // In-memory cache for the current session
    private categoryCache = new Map<string, XtreamCategory[]>();
    private contentCache = new Map<string, XtreamCachedContentItem[]>();
    private playlistPasswords = new Map<string, string>();

    // =========================================================================
    // Playlist Operations (localStorage)
    // =========================================================================

    async getPlaylist(playlistId: string): Promise<XtreamPlaylistData | null> {
        const currentPlaylist =
            await this.getPlaylistFromCurrentMetadata(playlistId);
        if (currentPlaylist) {
            return currentPlaylist;
        }

        const playlists = this.getPlaylistsFromStorage();
        const playlist = playlists.find((p) => p.id === playlistId);
        return playlist?.password ? playlist : null;
    }

    async createPlaylist(playlist: XtreamPlaylistData): Promise<void> {
        this.rememberPlaylistPassword(playlist);
        const playlists = this.getPlaylistsFromStorage();
        playlists.push(playlist);
        this.savePlaylistsToStorage(playlists);
    }

    async updatePlaylist(
        playlistId: string,
        updates: Partial<XtreamPlaylistData>
    ): Promise<void> {
        if (updates.password) {
            this.playlistPasswords.set(playlistId, updates.password);
        }

        const playlists = this.getPlaylistsFromStorage();
        const index = playlists.findIndex((p) => p.id === playlistId);
        if (index !== -1) {
            playlists[index] = { ...playlists[index], ...updates };
            this.savePlaylistsToStorage(playlists);
        }
    }

    async rememberServerTimezone(
        playlistId: string,
        credentials: XtreamCredentials,
        serverTimezone: string
    ): Promise<void> {
        try {
            // `transformPlaylistMeta` runs the read and the write inside
            // one IndexedDB readwrite cursor transaction, so the
            // connection check below cannot be overtaken by an edit.
            const playlistsService = this.injector.get(PlaylistsService);
            const written = await firstValueFrom(
                playlistsService.transformPlaylistMeta(playlistId, (row) =>
                    row.serverUrl !== credentials.serverUrl ||
                    row.username !== credentials.username ||
                    row.password !== credentials.password ||
                    row.serverTimezone === serverTimezone
                        ? null
                        : { ...row, serverTimezone }
                )
            );
            if (written) {
                await this.updatePlaylist(playlistId, { serverTimezone });
            }
        } catch (error) {
            this.logger.error('Failed to persist the portal timezone', error);
        }
    }

    async deletePlaylist(playlistId: string): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        const filtered = playlists.filter((p) => p.id !== playlistId);
        this.savePlaylistsToStorage(filtered);

        // Also clear favorites and recent items for this playlist
        this.clearCollectionItemsForPlaylist(playlistId);
        this.clearFavoritesForPlaylist(playlistId);
        this.clearRecentItemsForPlaylist(playlistId);
        this.clearPlaybackPositionsForPlaylist(playlistId);

        // Clear cache
        this.clearCacheForPlaylist(playlistId);
    }

    private getPlaylistsFromStorage(): XtreamPlaylistData[] {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
            const playlists = data
                ? (JSON.parse(data) as StoredXtreamPlaylistData[])
                : [];

            return playlists.map((playlist) =>
                this.fromStoredPlaylist(playlist)
            );
        } catch {
            return [];
        }
    }

    private savePlaylistsToStorage(playlists: XtreamPlaylistData[]): void {
        const persistedPlaylists = playlists.map((playlist) =>
            this.toStoredPlaylist(playlist)
        );
        localStorage.setItem(
            STORAGE_KEYS.PLAYLISTS,
            JSON.stringify(persistedPlaylists)
        );
    }

    private async getPlaylistFromCurrentMetadata(
        playlistId: string
    ): Promise<XtreamPlaylistData | null> {
        try {
            const playlistsService = this.injector.get(PlaylistsService);
            const playlist = await firstValueFrom(
                playlistsService.getPlaylistById(playlistId)
            );
            const xtreamPlaylist = this.toXtreamPlaylistData(playlist);

            if (xtreamPlaylist) {
                this.upsertPlaylistInStorage(xtreamPlaylist);
            }

            return xtreamPlaylist;
        } catch {
            return null;
        }
    }

    private toXtreamPlaylistData(
        playlist: Playlist | null | undefined
    ): XtreamPlaylistData | null {
        if (
            !playlist?._id ||
            !playlist.serverUrl ||
            !playlist.username ||
            !playlist.password
        ) {
            return null;
        }

        return {
            id: playlist._id,
            name: playlist.title,
            title: playlist.title,
            updateDate: playlist.updateDate,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            type: 'xtream',
            userAgent: playlist.userAgent,
            referrer: playlist.referrer,
            origin: playlist.origin,
            serverTimezone: playlist.serverTimezone,
        };
    }

    private upsertPlaylistInStorage(playlist: XtreamPlaylistData): void {
        this.rememberPlaylistPassword(playlist);

        const playlists = this.getPlaylistsFromStorage();
        const index = playlists.findIndex((item) => item.id === playlist.id);

        if (index === -1) {
            this.savePlaylistsToStorage([...playlists, playlist]);
            return;
        }

        playlists[index] = playlist;
        this.savePlaylistsToStorage(playlists);
    }

    private toStoredPlaylist(
        playlist: XtreamPlaylistData
    ): StoredXtreamPlaylistData {
        return {
            id: playlist.id,
            name: playlist.name,
            title: playlist.title,
            updateDate: playlist.updateDate,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            type: playlist.type,
            userAgent: playlist.userAgent,
            referrer: playlist.referrer,
            origin: playlist.origin,
            serverTimezone: playlist.serverTimezone,
        };
    }

    private fromStoredPlaylist(
        playlist: StoredXtreamPlaylistData
    ): XtreamPlaylistData {
        const legacyPassword =
            typeof playlist.password === 'string' ? playlist.password : '';
        if (legacyPassword) {
            this.playlistPasswords.set(playlist.id, legacyPassword);
        }

        return {
            id: playlist.id,
            name: playlist.name,
            title: playlist.title,
            updateDate: playlist.updateDate,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: this.playlistPasswords.get(playlist.id) ?? legacyPassword,
            type: playlist.type,
            userAgent: playlist.userAgent,
            referrer: playlist.referrer,
            origin: playlist.origin,
            serverTimezone: playlist.serverTimezone,
        };
    }

    private rememberPlaylistPassword(playlist: XtreamPlaylistData): void {
        if (playlist.password) {
            this.playlistPasswords.set(playlist.id, playlist.password);
        }
    }

    // =========================================================================
    // Category Operations (API + in-memory cache)
    // =========================================================================

    async hasCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<boolean> {
        const cacheKey = `${playlistId}-${type}-categories`;
        return this.categoryCache.has(cacheKey);
    }

    async getCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType,
        options?: XtreamOperationOptions
    ): Promise<XtreamCategory[]> {
        const cacheKey = `${playlistId}-${type}-categories`;

        // Check in-memory cache first
        const cachedCategories = this.categoryCache.get(cacheKey);
        if (cachedCategories) {
            return this.withoutLockedCategories(
                playlistId,
                type,
                cachedCategories
            );
        }

        // Fetch from API
        options?.onPhaseChange?.('loading-categories');
        const categories = await this.apiService.getCategories(
            credentials,
            type
        );

        // Cache in memory
        this.categoryCache.set(cacheKey, categories);

        return this.withoutLockedCategories(playlistId, type, categories);
    }

    /**
     * Parental lock (PWA): there is no SQLite worker to filter reads, so the
     * withheld categories are dropped here, at the same boundary the
     * Electron source reads them through.
     */
    private withheldCategoryIds(
        playlistId: string,
        type: CategoryType | StreamType
    ): ReadonlySet<string> {
        if (!this.parentalLock.active()) {
            return new Set();
        }
        if (this.parentalLock.withholdsEverything?.()) {
            return ALL_CATEGORIES_WITHHELD;
        }
        const dbType =
            type === 'vod' || type === 'movie'
                ? 'movies'
                : type === 'series'
                  ? 'series'
                  : 'live';
        return new Set(
            this.parentalLock
                .lockedXtreamIds(playlistId, dbType)
                .map((id) => String(id))
        );
    }

    private withoutLockedCategories(
        playlistId: string,
        type: CategoryType,
        categories: XtreamCategory[]
    ): XtreamCategory[] {
        const withheld = this.withheldCategoryIds(playlistId, type);
        return withheld.size === 0
            ? categories
            : categories.filter(
                  (category) =>
                      !withheld.has(canonicalCategoryId(category.category_id))
              );
    }

    private withoutLockedContent<T extends { category_id?: string | number }>(
        playlistId: string,
        type: StreamType,
        items: T[]
    ): T[] {
        const withheld = this.withheldCategoryIds(playlistId, type);
        return withheld.size === 0
            ? items
            : items.filter(
                  (item) => !withheld.has(canonicalCategoryId(item.category_id))
              );
    }

    /**
     * The raw category list in the SQLite wire shape, locked ones included:
     * the lock editor's candidates. Hidden/shown is not tracked in the PWA,
     * so every row reports `hidden: false`. Reads the session cache and
     * falls back to the API with the stored credentials on a cold session.
     */
    async getAllCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        const categoryType: CategoryType = type === 'movies' ? 'vod' : type;
        const cacheKey = `${playlistId}-${categoryType}-categories`;
        let categories = this.categoryCache.get(cacheKey);
        if (!categories) {
            const playlist = await this.getPlaylist(playlistId);
            if (!playlist) {
                return [];
            }
            categories = await this.apiService.getCategories(
                {
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                },
                categoryType
            );
            this.categoryCache.set(cacheKey, categories);
        }
        const locked = new Set(
            this.parentalLock.lockedXtreamIds(playlistId, type)
        );
        const rows: XtreamCategoryFromDb[] = [];
        for (const category of categories) {
            const xtreamId = Number(category.category_id);
            if (!Number.isFinite(xtreamId)) {
                continue;
            }
            rows.push({
                id: xtreamId,
                name: category.category_name,
                playlist_id: playlistId,
                type,
                xtream_id: xtreamId,
                hidden: false,
                locked: locked.has(xtreamId),
            });
        }
        return rows;
    }

    async getCachedCategories(
        playlistId: string,
        type: CategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        void playlistId;
        void type;
        return [];
    }

    async saveCategories(
        playlistId: string,
        categories: XtreamCategory[],
        type: DbCategoryType
    ): Promise<void> {
        // In PWA mode, we just cache in memory
        const cacheKey = `${playlistId}-${type}-categories`;
        this.categoryCache.set(cacheKey, categories);
    }

    async updateCategoryVisibility(
        categoryIds: number[],
        hidden: boolean
    ): Promise<void> {
        void categoryIds;
        void hidden;
        // Category visibility is not supported in PWA mode
        this.logger.warn('Category visibility not supported in PWA mode');
    }

    // =========================================================================
    // Content/Stream Operations (API + in-memory cache)
    // =========================================================================

    async hasContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<boolean> {
        const cacheKey = `${playlistId}-${type}-content`;
        return this.contentCache.has(cacheKey);
    }

    async getContent(
        playlistId: string,
        credentials: XtreamCredentials,
        type: StreamType,
        onProgress?: (count: number) => void,
        onTotal?: (total: number) => void,
        options?: XtreamOperationOptions
    ): Promise<
        | XtreamLiveStream[]
        | XtreamVodStream[]
        | XtreamSerieItem[]
        | XtreamContentItem[]
    > {
        const cacheKey = `${playlistId}-${type}-content`;

        // Check in-memory cache first
        const cachedContent = this.contentCache.get(cacheKey);
        if (cachedContent) {
            return this.withoutLockedContent(
                playlistId,
                type,
                cachedContent
            ) as XtreamLiveStream[] | XtreamVodStream[] | XtreamSerieItem[];
        }

        // Fetch from API
        options?.onPhaseChange?.(
            type === 'live'
                ? 'loading-live'
                : type === 'movie'
                  ? 'loading-movies'
                  : 'loading-series'
        );
        const content = this.normalizeContentItems(
            await this.apiService.getStreams(credentials, type),
            type
        );

        // Report total and progress (PWA doesn't have incremental save, so report all at once)
        if (onTotal) {
            onTotal(content.length);
        }
        if (onProgress) {
            onProgress(content.length);
        }

        // Cache in memory
        this.contentCache.set(cacheKey, content);

        return this.withoutLockedContent(playlistId, type, content);
    }

    async getCachedContent(
        playlistId: string,
        type: StreamType
    ): Promise<XtreamContentItem[]> {
        void playlistId;
        void type;
        return [];
    }

    async saveContent(
        playlistId: string,
        streams:
            | XtreamLiveStream[]
            | XtreamVodStream[]
            | XtreamSerieItem[]
            | XtreamContentItem[],
        type: 'live' | 'movie' | 'series',
        onProgress?: ProgressCallback,
        options?: XtreamOperationOptions
    ): Promise<number> {
        void options;
        // In PWA mode, we just cache normalized API items in memory.
        const cacheKey = `${playlistId}-${type}-content`;
        const normalizedStreams = this.normalizeContentItems(streams, type);
        this.contentCache.set(cacheKey, normalizedStreams);

        if (onProgress) {
            onProgress(normalizedStreams.length);
        }

        return normalizedStreams.length;
    }

    private normalizeContentItems(
        streams:
            | XtreamLiveStream[]
            | XtreamVodStream[]
            | XtreamSerieItem[]
            | XtreamContentItem[],
        type: 'live' | 'movie' | 'series'
    ): XtreamContentItem[] {
        return streams.map((item) =>
            this.normalizeContentItem(item as XtreamCachedContentItem, type)
        );
    }

    private normalizeContentItem(
        item: XtreamCachedContentItem,
        type: 'live' | 'movie' | 'series'
    ): XtreamContentItem {
        const xtreamId = this.getItemIdentity(item, type);
        const title = item.title ?? item.name ?? item.stream_display_name ?? '';
        const posterUrl =
            item.poster_url ??
            item.stream_icon ??
            item.cover ??
            item.cover_big ??
            item.movie_image ??
            item.poster ??
            '';

        return {
            ...item,
            added: item.added ?? item.last_modified ?? '',
            category_id: item.category_id ?? '',
            id: xtreamId,
            name: item.name ?? title,
            poster_url: posterUrl,
            rating: String(item.rating ?? ''),
            title,
            type,
            xtream_id: xtreamId,
        } as XtreamContentItem;
    }

    private getItemIdentity(
        item: XtreamCachedContentItem,
        type?: 'live' | 'movie' | 'series'
    ): number {
        const preferredId =
            item.xtream_id ??
            (type === 'series' ? item.series_id : item.stream_id) ??
            item.stream_id ??
            item.series_id ??
            item.id;
        const numericId = Number(preferredId);
        return Number.isFinite(numericId) && numericId > 0 ? numericId : -1;
    }

    // =========================================================================
    // Search Operations (in-memory filter)
    // =========================================================================

    async searchContent(
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ): Promise<XtreamContentItem[]> {
        void excludeHidden;
        const results: XtreamCachedContentItem[] = [];
        const searchLower = foldSearchText(searchTerm);

        for (const type of types) {
            const cacheKey = `${playlistId}-${type}-content`;
            // Same lock boundary as the catalog read: a search must not
            // surface rows the category list withholds.
            const content = this.withoutLockedContent(
                playlistId,
                type as StreamType,
                this.contentCache.get(cacheKey) || []
            );

            const filtered = content.filter((item) => {
                const title =
                    item.name || item.title || item.stream_display_name || '';
                return foldSearchText(title).includes(searchLower);
            });

            results.push(...filtered);
        }

        return results as XtreamContentItem[];
    }

    // =========================================================================
    // Favorites Operations (localStorage)
    // =========================================================================

    async getFavorites(playlistId: string): Promise<XtreamContentItem[]> {
        let allFavorites = this.getFavoritesFromStorage();
        let playlistFavorites = allFavorites[playlistId] || [];
        let contentById = await this.getCollectionItemsWithHydration(
            playlistId,
            playlistFavorites
        );

        allFavorites = this.getFavoritesFromStorage();
        playlistFavorites = allFavorites[playlistId] || [];
        contentById = this.getCollectionItemsById(
            playlistId,
            playlistFavorites
        );
        const migrated = playlistFavorites.map((id) => {
            const item = contentById.get(id);
            return item ? (itemCollectionKey(item) ?? id) : id;
        });
        if (migrated.some((id, index) => id !== playlistFavorites[index])) {
            allFavorites[playlistId] = [...new Set(migrated)];
            this.saveFavoritesToStorage(allFavorites);
        }
        this.persistCollectionSnapshots(playlistId, contentById);
        return [
            ...new Map(
                Array.from(contentById.values()).map((item) => [
                    itemCollectionKey(item),
                    item,
                ])
            ).values(),
        ];
    }

    async addFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return;
        }

        await this.getFavorites(playlistId);
        const allFavorites = this.getFavoritesFromStorage();
        if (!allFavorites[playlistId]) {
            allFavorites[playlistId] = [];
        }
        if (!allFavorites[playlistId].includes(normalizedContentId)) {
            allFavorites[playlistId].push(normalizedContentId);
        }
        this.saveFavoritesToStorage(allFavorites);
        this.saveCollectionItemSnapshot(
            playlistId,
            normalizedContentId,
            backdropUrl
        );
    }

    async removeFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<void> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return;
        }

        await this.getFavorites(playlistId);
        const allFavorites = this.getFavoritesFromStorage();
        if (allFavorites[playlistId]) {
            allFavorites[playlistId] = allFavorites[playlistId].filter(
                (id) => id !== normalizedContentId
            );
        }
        this.saveFavoritesToStorage(allFavorites);
    }

    async isFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<boolean> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return false;
        }

        await this.getFavorites(playlistId);
        const allFavorites = this.getFavoritesFromStorage();
        return (allFavorites[playlistId] || []).includes(normalizedContentId);
    }

    private getFavoritesFromStorage(): Record<string, CollectionKey[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
            return normalizeFavoriteStorage(data ? JSON.parse(data) : {});
        } catch {
            return {};
        }
    }

    private saveFavoritesToStorage(
        favorites: Record<string, CollectionKey[]>
    ): void {
        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    }

    private clearFavoritesForPlaylist(playlistId: string): void {
        const allFavorites = this.getFavoritesFromStorage();
        delete allFavorites[playlistId];
        this.saveFavoritesToStorage(allFavorites);
    }

    // =========================================================================
    // Playback Position Operations (localStorage)
    // =========================================================================

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (!allPositions[playlistId]) {
            allPositions[playlistId] = [];
        }

        // Remove existing entry if present
        allPositions[playlistId] = allPositions[playlistId].filter(
            (p) =>
                !(
                    p.contentXtreamId === data.contentXtreamId &&
                    p.contentType === data.contentType
                )
        );

        // Add new entry
        allPositions[playlistId].push({
            ...data,
            updatedAt: new Date().toISOString(),
        });

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return (
            playlistPositions.find(
                (p) =>
                    p.contentXtreamId === contentXtreamId &&
                    p.contentType === contentType
            ) || null
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return playlistPositions.filter(
            (p) =>
                p.contentType === 'episode' &&
                p.seriesXtreamId === seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        // Sort by updatedAt descending
        playlistPositions.sort(
            (a, b) =>
                new Date(b.updatedAt ?? 0).getTime() -
                new Date(a.updatedAt ?? 0).getTime()
        );

        return limit ? playlistPositions.slice(0, limit) : playlistPositions;
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        return allPositions[playlistId] || [];
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (allPositions[playlistId]) {
            allPositions[playlistId] = allPositions[playlistId].filter(
                (p) =>
                    !(
                        p.contentXtreamId === contentXtreamId &&
                        p.contentType === contentType
                    )
            );
            this.savePlaybackPositionsToStorage(allPositions);
        }
    }

    async savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        // One blob read + one write for the whole batch — the blob holds
        // every playlist's positions, so per-item saves would re-serialize
        // it N times.
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] ?? [];
        const updatedAt = new Date().toISOString();

        const replacedKeys = new Set(
            items.map((item) => `${item.contentType}_${item.contentXtreamId}`)
        );
        allPositions[playlistId] = [
            ...playlistPositions.filter(
                (p) =>
                    !replacedKeys.has(`${p.contentType}_${p.contentXtreamId}`)
            ),
            ...items.map((item) => ({ ...item, updatedAt })),
        ];

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId];
        if (!playlistPositions) {
            return;
        }

        const removedKeys = new Set(
            items.map((item) => `${item.contentType}_${item.contentXtreamId}`)
        );
        allPositions[playlistId] = playlistPositions.filter(
            (p) => !removedKeys.has(`${p.contentType}_${p.contentXtreamId}`)
        );

        this.savePlaybackPositionsToStorage(allPositions);
    }

    private getPlaybackPositionsFromStorage(): Record<
        string,
        PlaybackPositionData[]
    > {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.PLAYBACK_POSITIONS);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private savePlaybackPositionsToStorage(
        positions: Record<string, PlaybackPositionData[]>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.PLAYBACK_POSITIONS,
            JSON.stringify(positions)
        );
    }

    private clearPlaybackPositionsForPlaylist(playlistId: string): void {
        const allPositions = this.getPlaybackPositionsFromStorage();
        delete allPositions[playlistId];
        this.savePlaybackPositionsToStorage(allPositions);
    }

    // =========================================================================
    // Recently Viewed Operations (localStorage)
    // =========================================================================

    async getRecentItems(playlistId: string): Promise<XtreamContentItem[]> {
        let allRecent = this.getRecentItemsFromStorage();
        let playlistRecent = allRecent[playlistId] || [];
        let contentById = await this.getCollectionItemsWithHydration(
            playlistId,
            playlistRecent.map((item) => item.id)
        );
        allRecent = this.getRecentItemsFromStorage();
        playlistRecent = allRecent[playlistId] || [];
        contentById = this.getCollectionItemsById(
            playlistId,
            playlistRecent.map((item) => item.id)
        );
        const migrated = deduplicateRecentItems(
            playlistRecent.map((entry) => {
                const item = contentById.get(entry.id);
                return item
                    ? { ...entry, id: itemCollectionKey(item) ?? entry.id }
                    : entry;
            })
        );
        if (
            migrated.length !== playlistRecent.length ||
            migrated.some(
                (entry, index) => entry.id !== playlistRecent[index].id
            )
        ) {
            allRecent[playlistId] = migrated;
            this.saveRecentItemsToStorage(allRecent);
        }
        this.persistCollectionSnapshots(playlistId, contentById);
        const results: (XtreamContentItem & { viewed_at: string })[] = [];
        const migratedContent = this.getCollectionItemsById(
            playlistId,
            migrated.map((item) => item.id)
        );
        for (const recentEntry of migrated) {
            const item = migratedContent.get(recentEntry.id);
            if (!item) {
                continue;
            }

            results.push({
                ...item,
                backdrop_url: recentEntry.backdropUrl ?? item.backdrop_url,
                viewed_at: recentEntry.viewedAt,
            });
        }

        // Sort by viewed_at descending
        results.sort(
            (a, b) =>
                new Date(b.viewed_at).getTime() -
                new Date(a.viewed_at).getTime()
        );

        return results as XtreamContentItem[];
    }

    async addRecentItem(
        contentId: XtreamCollectionRef,
        playlistId: string,
        _backdropUrl?: string
    ): Promise<void> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return;
        }
        const normalizedBackdropUrl = _backdropUrl?.trim();

        await this.getRecentItems(playlistId);
        const allRecent = this.getRecentItemsFromStorage();
        if (!allRecent[playlistId]) {
            allRecent[playlistId] = [];
        }

        // Remove existing entry if present
        allRecent[playlistId] = allRecent[playlistId].filter(
            (r) => r.id !== normalizedContentId
        );

        // Add new entry at the beginning
        allRecent[playlistId].unshift({
            id: normalizedContentId,
            viewedAt: new Date().toISOString(),
            ...(normalizedBackdropUrl
                ? { backdropUrl: normalizedBackdropUrl }
                : {}),
        });

        // Keep only last 50 items
        allRecent[playlistId] = allRecent[playlistId].slice(0, 50);

        this.saveRecentItemsToStorage(allRecent);
        this.saveCollectionItemSnapshot(
            playlistId,
            normalizedContentId,
            normalizedBackdropUrl
        );
    }

    async removeRecentItem(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<void> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return;
        }

        await this.getRecentItems(playlistId);
        const allRecent = this.getRecentItemsFromStorage();
        if (allRecent[playlistId]) {
            allRecent[playlistId] = allRecent[playlistId].filter(
                (r) => r.id !== normalizedContentId
            );
        }
        this.saveRecentItemsToStorage(allRecent);
    }

    async clearRecentItems(playlistId: string): Promise<void> {
        this.clearRecentItemsForPlaylist(playlistId);
    }

    private getRecentItemsFromStorage(): Record<string, StoredRecentItem[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.RECENT_ITEMS);
            return normalizeRecentStorage(data ? JSON.parse(data) : {});
        } catch {
            return {};
        }
    }

    private saveRecentItemsToStorage(
        recentItems: Record<string, StoredRecentItem[]>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.RECENT_ITEMS,
            JSON.stringify(recentItems)
        );
    }

    private clearRecentItemsForPlaylist(playlistId: string): void {
        const allRecent = this.getRecentItemsFromStorage();
        delete allRecent[playlistId];
        this.saveRecentItemsToStorage(allRecent);
    }

    private getCollectionItemsFromStorage(): Record<
        string,
        Record<string, XtreamContentItem>
    > {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.COLLECTION_ITEMS);
            const parsed = data ? JSON.parse(data) : {};
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            return parsed as Record<string, Record<string, XtreamContentItem>>;
        } catch {
            return {};
        }
    }

    private saveCollectionItemsToStorage(
        items: Record<string, Record<string, XtreamContentItem>>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.COLLECTION_ITEMS,
            JSON.stringify(items)
        );
    }

    private clearCollectionItemsForPlaylist(playlistId: string): void {
        const allItems = this.getCollectionItemsFromStorage();
        delete allItems[playlistId];
        this.saveCollectionItemsToStorage(allItems);
    }

    private persistCollectionSnapshots(
        playlistId: string,
        items: Map<CollectionKey, XtreamContentItem>
    ): void {
        if (!items.size) return;
        const allItems = this.getCollectionItemsFromStorage();
        const snapshots = allItems[playlistId] ?? {};
        for (const item of items.values()) {
            const key = itemCollectionKey(item);
            if (key === null) continue;
            snapshots[key] = {
                ...item,
                backdrop_url: item.backdrop_url ?? snapshots[key]?.backdrop_url,
            };
        }
        this.saveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: snapshots,
        });
    }

    private saveCollectionItemSnapshot(
        playlistId: string,
        contentId: CollectionKey,
        backdropUrl?: string
    ): void {
        const item = this.findCachedContentItemById(playlistId, contentId);
        if (!item) {
            return;
        }

        const normalizedBackdropUrl = backdropUrl?.trim();
        const allItems = this.getCollectionItemsFromStorage();
        const playlistItems = allItems[playlistId] ?? {};
        playlistItems[String(contentId)] = {
            ...item,
            ...(normalizedBackdropUrl && !item.backdrop_url
                ? { backdrop_url: normalizedBackdropUrl }
                : {}),
        };
        this.saveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: playlistItems,
        });
    }

    private setCollectionItemBackdropIfMissing(
        playlistId: string,
        contentId: CollectionKey,
        backdropUrl: string
    ): void {
        const allItems = this.getCollectionItemsFromStorage();
        const playlistItems = allItems[playlistId];
        const item = playlistItems?.[String(contentId)];
        if (!item || item.backdrop_url) {
            return;
        }

        this.saveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: {
                ...playlistItems,
                [String(contentId)]: {
                    ...item,
                    backdrop_url: backdropUrl,
                },
            },
        });
    }

    private getCollectionItemsById(
        playlistId: string,
        ids: readonly CollectionKey[]
    ): Map<CollectionKey, XtreamContentItem> {
        if (!ids.length) return new Map();
        const cached: XtreamContentItem[] = [];
        for (const type of this.contentTypes) {
            const content =
                this.contentCache.get(`${playlistId}-${type}-content`) ?? [];
            for (const item of content) cached.push(item as XtreamContentItem);
        }
        return findCollectionItems(
            ids,
            cached,
            this.getCollectionItemsFromStorage()[playlistId] ?? {},
            this.contentTypes.every((type) =>
                this.contentCache.has(`${playlistId}-${type}-content`)
            )
        );
    }

    private async resolveCollectionKey(
        playlistId: string,
        ref: XtreamCollectionRef
    ): Promise<CollectionKey | null> {
        const key = collectionKey(ref);
        if (typeof key !== 'number') return key;
        const items = await this.getCollectionItemsWithHydration(playlistId, [
            key,
        ]);
        const item = items.get(key);
        return item ? itemCollectionKey(item) : null;
    }

    private async getCollectionItemsWithHydration(
        playlistId: string,
        ids: readonly CollectionKey[]
    ): Promise<Map<CollectionKey, XtreamContentItem>> {
        const contentById = this.getCollectionItemsById(playlistId, ids);
        const missingIds = ids.filter((id) => !contentById.has(id));
        if (missingIds.length === 0) {
            return contentById;
        }

        await this.hydrateStoredCollectionContent(playlistId, missingIds);
        return this.getCollectionItemsById(playlistId, ids);
    }

    private findCachedContentItemById(
        playlistId: string,
        contentId: CollectionKey
    ): XtreamContentItem | null {
        return (
            this.getCollectionItemsById(playlistId, [contentId]).get(
                contentId
            ) ?? null
        );
    }

    private async hydrateStoredCollectionContent(
        playlistId: string,
        ids: readonly CollectionKey[]
    ): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        const missingTypes = this.contentTypes.filter(
            (type) =>
                !this.contentCache.has(`${playlistId}-${type}-content`) &&
                ids.some(
                    (id) =>
                        typeof id === 'number' ||
                        typedCollectionRef(id)?.type === type
                )
        );
        if (missingTypes.length === 0) {
            return;
        }

        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) {
            return;
        }

        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };

        await Promise.all(
            missingTypes.map(async (type) => {
                try {
                    await this.getContent(playlistId, credentials, type);
                } catch (error) {
                    this.logger.warn(
                        'Failed to hydrate stored PWA Xtream collection content',
                        { playlistId, type, error }
                    );
                }
            })
        );
    }

    // =========================================================================
    // Content Lookup
    // =========================================================================

    async getContentByXtreamId(
        xtreamId: number,
        playlistId: string,
        contentType?: 'live' | 'movie' | 'series'
    ): Promise<XtreamContentItem | null> {
        const types = contentType
            ? [contentType]
            : (['live', 'movie', 'series'] as const);

        for (const type of types) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            const found = content.find((item) => {
                const itemXtreamId = this.getItemIdentity(item, type);
                return itemXtreamId === xtreamId;
            });

            if (found) {
                return found as XtreamContentItem;
            }
        }

        return null;
    }

    /**
     * Only the backdrop is retained here. The identity fields exist to spare
     * a later reader from rebuilding a weaker TMDB query than the detail view
     * used, and that reader is the dashboard reading a persisted `content`
     * row — which the PWA has no equivalent of. Its catalog lives in a
     * session-scoped cache that is rebuilt from the API on every load, so a
     * stored id would never outlive the detail view that resolved it. PWA
     * lookups stay on the documented title-only fallback.
     */
    async setContentMetadataIfMissing(
        contentId: XtreamCollectionRef,
        playlistId: string,
        patch: ContentMetadataPatch
    ): Promise<void> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        const normalizedBackdropUrl = patch.backdropUrl?.trim();
        if (normalizedContentId == null || !normalizedBackdropUrl) {
            return;
        }

        for (const type of this.contentTypes) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey);
            if (!content) {
                continue;
            }

            this.contentCache.set(
                cacheKey,
                content.map((item) => {
                    const itemId = this.getItemIdentity(item, type);
                    if (
                        collectionKey({ id: itemId, type }) !==
                            normalizedContentId ||
                        item.backdrop_url
                    ) {
                        return item;
                    }

                    return {
                        ...item,
                        backdrop_url: normalizedBackdropUrl,
                    };
                })
            );
        }

        this.setCollectionItemBackdropIfMissing(
            playlistId,
            normalizedContentId,
            normalizedBackdropUrl
        );

        const allRecent = this.getRecentItemsFromStorage();
        const playlistRecent = allRecent[playlistId];
        if (!playlistRecent) {
            return;
        }

        this.saveRecentItemsToStorage({
            ...allRecent,
            [playlistId]: playlistRecent.map((item) => {
                if (item.id !== normalizedContentId || item.backdropUrl) {
                    return item;
                }

                return {
                    ...item,
                    backdropUrl: normalizedBackdropUrl,
                };
            }),
        });
    }

    private findContentIdentity(playlistId: string, key: CollectionKey) {
        const ref = typedCollectionRef(key);
        if (ref) return { contentType: ref.type, xtreamId: ref.id };
        const item = this.findCachedContentItemById(playlistId, key);
        const identity = item
            ? typedCollectionRef({ id: item.xtream_id, type: item.type })
            : null;
        return identity
            ? { contentType: identity.type, xtreamId: identity.id }
            : null;
    }

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    async clearPlaylistContent(
        playlistId: string
    ): Promise<XtreamPendingRestoreState> {
        // Resolve only unambiguous legacy references before producing typed backup data.
        await this.getFavorites(playlistId);
        await this.getRecentItems(playlistId);
        const favorites = this.getFavoritesFromStorage();
        const recentItems = this.getRecentItemsFromStorage();
        const playbackPositions =
            await this.getAllPlaybackPositions(playlistId);

        const typedFavorites = (favorites[playlistId] || [])
            .map((xtreamId) => this.findContentIdentity(playlistId, xtreamId))
            .filter(
                (
                    value
                ): value is {
                    contentType: 'live' | 'movie' | 'series';
                    xtreamId: number;
                } => value !== null
            );

        const typedRecentlyViewed = (recentItems[playlistId] || [])
            .map((item) => {
                const identity = this.findContentIdentity(playlistId, item.id);

                if (!identity) {
                    return null;
                }

                return {
                    ...identity,
                    viewedAt: item.viewedAt,
                };
            })
            .filter(
                (
                    value
                ): value is {
                    contentType: 'live' | 'movie' | 'series';
                    xtreamId: number;
                    viewedAt: string;
                } => value !== null
            );

        // Clear in-memory cache
        this.clearCacheForPlaylist(playlistId);

        return {
            hiddenCategories: [],
            favorites: typedFavorites,
            recentlyViewed: typedRecentlyViewed,
            playbackPositions,
        };
    }

    async restoreUserData(
        playlistId: string,
        restoreState: XtreamPendingRestoreState,
        options?: XtreamOperationOptions
    ): Promise<void> {
        void options;
        // Restore favorites
        const favorites = this.getFavoritesFromStorage();
        favorites[playlistId] = restoreState.favorites
            .map((item) =>
                collectionKey({ id: item.xtreamId, type: item.contentType })
            )
            .filter((key): key is CollectionKey => key !== null);
        this.saveFavoritesToStorage(favorites);

        // Restore recent items
        const recentItems = this.getRecentItemsFromStorage();
        recentItems[playlistId] = [];
        for (const item of restoreState.recentlyViewed) {
            const id = collectionKey({
                id: item.xtreamId,
                type: item.contentType,
            });
            if (id !== null)
                recentItems[playlistId].push({ id, viewedAt: item.viewedAt });
        }
        this.saveRecentItemsToStorage(recentItems);

        // Restore playback positions
        this.clearPlaybackPositionsForPlaylist(playlistId);
        const playbackPositions = this.getPlaybackPositionsFromStorage();
        playbackPositions[playlistId] = restoreState.playbackPositions.map(
            (position) => ({
                ...position,
                updatedAt: position.updatedAt ?? new Date().toISOString(),
            })
        );
        this.savePlaybackPositionsToStorage(playbackPositions);
    }

    // =========================================================================
    // Cache Management
    // =========================================================================

    /**
     * Clear in-memory cache entries for a specific playlist.
     * Called by the store when switching playlists to prevent stale data bleed.
     */
    clearSessionCache(playlistId: string): void {
        this.clearCacheForPlaylist(playlistId);
    }

    private clearCacheForPlaylist(playlistId: string): void {
        const keysToDelete: string[] = [];

        this.categoryCache.forEach((_, key) => {
            if (key.startsWith(playlistId)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach((key) => this.categoryCache.delete(key));

        const contentKeysToDelete: string[] = [];
        this.contentCache.forEach((_, key) => {
            if (key.startsWith(playlistId)) {
                contentKeysToDelete.push(key);
            }
        });
        contentKeysToDelete.forEach((key) => this.contentCache.delete(key));
    }

    /**
     * Clear all in-memory caches
     */
    clearAllCaches(): void {
        this.categoryCache.clear();
        this.contentCache.clear();
    }
}

/**
 * The lock store keys provider category ids as numbers (the lock editor
 * converts with `Number`), so a noncanonical provider id such as `"001"`
 * must be compared as `"1"`. Non-numeric and empty ids stay as they are.
 */
function canonicalCategoryId(id: string | number | null | undefined): string {
    const raw = String(id ?? '').trim();
    const numeric = Number(raw);
    return raw !== '' && Number.isFinite(numeric) ? String(numeric) : raw;
}
