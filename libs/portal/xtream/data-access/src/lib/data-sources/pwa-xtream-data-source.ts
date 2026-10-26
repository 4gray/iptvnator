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
import {
    ParentalLockService,
    PlaylistsService,
    USER_DATA_STORAGE,
    XTREAM_USER_DATA_KEYS,
    writeXtreamUserDataMap,
} from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import {
    DbCategoryType,
    XTREAM_CONTENT_TYPES,
    IXtreamDataSource,
    XtreamCollectionRef,
    ProgressCallback,
    XtreamOperationOptions,
    XtreamCategoryFromDb,
    XtreamContentItem,
    XtreamPlayedContent,
    XtreamPlaylistData,
} from './xtream-data-source.interface';

import {
    CollectionKey,
    cachedContentIdentity,
    type CollectionIdentity,
    collectionRefIdentity,
    collectionKey,
    typedCollectionRef,
    itemCollectionKey,
    findCollectionItems,
    normalizeCollectionIdentity,
} from './pwa-collection-identity';
import { PwaCollectionStorage } from './pwa-collection-storage';
import { PwaCollectionCatalog } from './pwa-collection-catalog';
import type { XtreamCachedContentItem } from './pwa-cached-content';

/**
 * Storage keys for PWA persistence
 */
const STORAGE_KEYS = {
    PLAYLISTS: 'xtream-playlists',
    PLAYBACK_POSITIONS: XTREAM_USER_DATA_KEYS.playbackPositions,
};

type StoredXtreamPlaylistData = Omit<XtreamPlaylistData, 'password'> & {
    readonly password?: string;
};

/**
 * PWA implementation of the Xtream data source.
 * Uses API-only strategy: always fetch from API, no database caching.
 * Favorites, recently viewed and positions are stored in USER_DATA_STORAGE.
 */
@Injectable({ providedIn: 'root' })
export class PwaXtreamDataSource implements IXtreamDataSource {
    private readonly apiService = inject(XtreamApiService);
    private readonly injector = inject(Injector);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly logger = createLogger('PwaXtreamDataSource');
    private readonly userDataStorage = inject(USER_DATA_STORAGE);
    private readonly collectionCatalog = new PwaCollectionCatalog();
    private readonly collectionStorage = new PwaCollectionStorage(
        (playlistId, ids, catalogOnly, snapshots) =>
            this.getCollectionItemsById(
                playlistId,
                ids,
                catalogOnly,
                snapshots
            ),
        this.userDataStorage
    );

    // In-memory cache for the current session
    private categoryCache = new Map<string, XtreamCategory[]>();
    private contentCache = new Map<string, XtreamCachedContentItem[]>();
    private playlistPasswords = new Map<string, string>();

    // =========================================================================
    // Playlist Operations (user data storage)
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
        this.collectionStorage.clearCollectionItemsForPlaylist(playlistId);
        this.collectionStorage.clearFavoritesForPlaylist(playlistId);
        this.collectionStorage.clearRecentItemsForPlaylist(playlistId);
        this.clearPlaybackPositionsForPlaylist(playlistId);

        // Clear cache
        this.clearCacheForPlaylist(playlistId);
    }

    private getPlaylistsFromStorage(): XtreamPlaylistData[] {
        try {
            const data = this.userDataStorage.getItem(STORAGE_KEYS.PLAYLISTS);
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
        this.userDataStorage.setItem(
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
                    userAgent: playlist.userAgent?.trim() || undefined,
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
        const content = await this.normalizeContentItems(
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
        const normalizedStreams = await this.normalizeContentItems(
            streams,
            type
        );
        this.contentCache.set(cacheKey, normalizedStreams);

        if (onProgress) {
            onProgress(normalizedStreams.length);
        }

        return normalizedStreams.length;
    }

    private async normalizeContentItems(
        streams:
            | XtreamLiveStream[]
            | XtreamVodStream[]
            | XtreamSerieItem[]
            | XtreamContentItem[],
        type: 'live' | 'movie' | 'series'
    ): Promise<XtreamContentItem[]> {
        const { normalizePwaCatalogContent } =
            await import('./pwa-content-metadata');
        return normalizePwaCatalogContent(streams, type);
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
    // Favorites Operations (user data storage)
    // =========================================================================

    async getFavorites(playlistId: string): Promise<XtreamContentItem[]> {
        await this.userDataRead();
        await this.getCollectionItemsWithHydration(
            playlistId,
            this.collectionStorage.getFavoritesFromStorage()[playlistId] || []
        );
        return this.collectionStorage.getLocalFavorites(playlistId);
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

        const expected = collectionRefIdentity(contentId);
        const { savePwaFavorite } = await import('./pwa-favorite-write');
        await savePwaFavorite(
            this.collectionStorage,
            playlistId,
            normalizedContentId,
            expected,
            (catalogOnly, identity) =>
                this.getCollectionItemsById(
                    playlistId,
                    [normalizedContentId],
                    catalogOnly,
                    undefined,
                    identity ? { [normalizedContentId]: identity } : undefined
                ).get(normalizedContentId),
            () =>
                this.getCollectionItemsWithHydration(playlistId, [
                    normalizedContentId,
                ]),
            (patch) =>
                this.enrichCatalogMetadata(
                    normalizedContentId,
                    playlistId,
                    patch
                ),
            (ids) =>
                this.getMatchingCollectionKeys(
                    playlistId,
                    ids,
                    normalizedContentId
                ),
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

        const expected = collectionRefIdentity(contentId);
        const { removePwaFavorite } = await import('./pwa-favorite-write');
        removePwaFavorite(
            this.collectionStorage,
            playlistId,
            normalizedContentId,
            expected,
            (ids) =>
                this.getMatchingCollectionKeys(
                    playlistId,
                    ids,
                    normalizedContentId
                )
        );
    }

    async isFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<boolean> {
        await this.userDataRead();
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return false;
        }

        const allFavorites = this.collectionStorage.getFavoritesFromStorage();
        const ids = allFavorites[playlistId] || [];
        const matchingKeys = this.getMatchingCollectionKeys(
            playlistId,
            ids,
            normalizedContentId
        );
        return (
            ids.some((id) => matchingKeys.has(id)) &&
            !this.collectionStorage.hasFavoriteIdentityConflict(
                playlistId,
                normalizedContentId
            ) &&
            !this.collectionStorage.hasFavoriteIdentityConflict(
                playlistId,
                normalizedContentId,
                collectionRefIdentity(contentId)
            )
        );
    }

    // =========================================================================
    // Playback Position Operations (user data storage)
    // =========================================================================

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        return (await this.playbackPositions()).savePlaybackPosition(
            playlistId,
            data
        );
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        await this.userDataRead();
        return (await this.playbackPositions()).getPlaybackPosition(
            playlistId,
            contentXtreamId,
            contentType
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        await this.userDataRead();
        return (await this.playbackPositions()).getSeriesPlaybackPositions(
            playlistId,
            seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        await this.userDataRead();
        return (await this.playbackPositions()).getRecentPlaybackPositions(
            playlistId,
            limit
        );
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        await this.userDataRead();
        return (await this.playbackPositions()).getAllPlaybackPositions(
            playlistId
        );
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        return (await this.playbackPositions()).clearPlaybackPosition(
            playlistId,
            contentXtreamId,
            contentType
        );
    }

    async savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void> {
        return (await this.playbackPositions()).savePlaybackPositionsBatch(
            playlistId,
            items
        );
    }

    async clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void> {
        return (await this.playbackPositions()).clearPlaybackPositionsBatch(
            playlistId,
            items
        );
    }

    private async playbackPositions() {
        const { PwaPlaybackPositions } =
            await import('./pwa-playback-positions');
        return new PwaPlaybackPositions(
            this.getPlaybackPositionsFromStorage.bind(this),
            this.savePlaybackPositionsToStorage.bind(this)
        );
    }

    /**
     * Server mode: favorites, history and positions show the server's data
     * once its first read settled, which startup does not wait for beyond a
     * few seconds. A read before it would show a new device empty lists.
     * Whether a read succeeded (always true outside server mode); `fresh`
     * reads again first, for a restore that replaces the current lists.
     */
    private async userDataRead(fresh = false): Promise<boolean> {
        return (await this.userDataStorage.ready?.(fresh)) ?? true;
    }

    private getPlaybackPositionsFromStorage(): Record<
        string,
        PlaybackPositionData[]
    > {
        try {
            const data = this.userDataStorage.getItem(
                STORAGE_KEYS.PLAYBACK_POSITIONS
            );
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private savePlaybackPositionsToStorage(
        positions: Record<string, PlaybackPositionData[]>
    ): void {
        writeXtreamUserDataMap(
            this.userDataStorage,
            STORAGE_KEYS.PLAYBACK_POSITIONS,
            positions
        );
    }

    private clearPlaybackPositionsForPlaylist(playlistId: string): void {
        const allPositions = this.getPlaybackPositionsFromStorage();
        delete allPositions[playlistId];
        this.savePlaybackPositionsToStorage(allPositions);
    }

    // =========================================================================
    // Recently Viewed Operations (user data storage)
    // =========================================================================

    async getRecentItems(playlistId: string): Promise<XtreamContentItem[]> {
        await this.userDataRead();
        await this.getCollectionItemsWithHydration(
            playlistId,
            (
                this.collectionStorage.getRecentItemsFromStorage()[
                    playlistId
                ] || []
            ).map((item) => item.id)
        );
        return this.collectionStorage.getLocalRecentItems(playlistId);
    }

    async addRecentItem(
        contentId: XtreamCollectionRef,
        playlistId: string,
        _backdropUrl?: string,
        playedContent?: XtreamPlayedContent
    ): Promise<void> {
        const normalizedContentId = await this.resolveCollectionKey(
            playlistId,
            contentId
        );
        if (normalizedContentId == null) {
            return;
        }
        const { addPwaRecentItem } = await import('./pwa-recent-write');
        addPwaRecentItem(
            this.collectionStorage,
            playlistId,
            normalizedContentId,
            (ids, catalogOnly) =>
                this.getCollectionItemsById(playlistId, ids, catalogOnly),
            (ids) =>
                this.getMatchingCollectionKeys(
                    playlistId,
                    ids,
                    normalizedContentId
                ),
            _backdropUrl,
            playedContent
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

        const { removePwaRecentItem } = await import('./pwa-recent-write');
        removePwaRecentItem(
            this.collectionStorage,
            playlistId,
            (ids) =>
                this.getMatchingCollectionKeys(
                    playlistId,
                    ids,
                    normalizedContentId
                )
        );
    }

    async clearRecentItems(playlistId: string): Promise<void> {
        this.collectionStorage.clearRecentItemsForPlaylist(playlistId);
    }

    /** Match original keys even when optional migration could not fit in storage. */
    private getMatchingCollectionKeys(
        playlistId: string,
        ids: readonly CollectionKey[],
        target: CollectionKey
    ): Set<CollectionKey> {
        const matchingKeys = new Set([target]);
        for (const [key, item] of this.getCollectionItemsById(
            playlistId,
            ids
        )) {
            if (itemCollectionKey(item) === target) matchingKeys.add(key);
        }
        return matchingKeys;
    }

    private getCollectionItemsById(
        playlistId: string,
        ids: readonly CollectionKey[],
        catalogOnly = false,
        snapshots?: Record<string, XtreamContentItem>,
        preferred?: Record<string, CollectionIdentity>
    ): Map<CollectionKey, XtreamContentItem> {
        if (!ids.length) return new Map();
        const cached = ([] as XtreamContentItem[]).concat(
            ...XTREAM_CONTENT_TYPES.map((type) =>
                this.collectionCatalog.select(
                    (this.contentCache.get(`${playlistId}-${type}-content`) ??
                        []) as XtreamContentItem[],
                    ids
                )
            )
        );
        return findCollectionItems(
            ids,
            cached,
            catalogOnly
                ? {}
                : (snapshots ??
                      this.collectionStorage.getCollectionItemsFromStorage()[
                          playlistId
                      ] ??
                      {}),
            XTREAM_CONTENT_TYPES.every((type) =>
                this.contentCache.has(`${playlistId}-${type}-content`)
            ),
            preferred ?? (catalogOnly ? snapshots : undefined)
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

    private async hydrateStoredCollectionContent(
        playlistId: string,
        ids: readonly CollectionKey[]
    ): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        const missingTypes = XTREAM_CONTENT_TYPES.filter(
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
            userAgent: playlist.userAgent?.trim() || undefined,
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
                const itemXtreamId = cachedContentIdentity(item, type);
                return itemXtreamId === xtreamId;
            });

            if (found) {
                return found as XtreamContentItem;
            }
        }

        return null;
    }

    /** Enrich the current catalog and compatible snapshots, or independent cold Recent data. */
    async setContentMetadataIfMissing(
        contentId: XtreamCollectionRef,
        playlistId: string,
        patch: ContentMetadataPatch
    ): Promise<void> {
        const key = await this.resolveCollectionKey(playlistId, contentId);
        if (key == null) return;
        const { enrichPwaContentMetadata } =
            await import('./pwa-content-metadata');
        const current = this.getCollectionItemsById(
            playlistId,
            [key],
            true,
            undefined,
            {
                [key]: normalizeCollectionIdentity({
                    tmdb_id: patch.tmdbId,
                    release_year: patch.releaseYear,
                }),
            }
        ).get(key);
        const enriched = enrichPwaContentMetadata(
            this.collectionStorage,
            playlistId,
            key,
            current,
            patch
        );
        if (!enriched) return;
        await this.enrichCatalogMetadata(key, playlistId, patch);
    }

    /** Explicit Favorite saves must not depend on optional history enrichment. */
    private async enrichCatalogMetadata(
        key: CollectionKey,
        playlistId: string,
        patch: ContentMetadataPatch
    ): Promise<void> {
        const { enrichPwaCatalogCache } =
            await import('./pwa-content-metadata');
        enrichPwaCatalogCache(
            this.contentCache,
            playlistId,
            key,
            patch
        );
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
        const { snapshotPwaPendingState } = await import('./pwa-pending-state');
        const playbackPositions =
            await this.getAllPlaybackPositions(playlistId);
        const state = snapshotPwaPendingState(
            this.collectionStorage,
            playlistId,
            playbackPositions,
            (ids) => this.getCollectionItemsById(playlistId, ids)
        );
        this.clearCacheForPlaylist(playlistId);
        return state;
    }

    async restoreUserData(
        playlistId: string,
        restoreState: XtreamPendingRestoreState,
        options?: XtreamOperationOptions
    ): Promise<void> {
        void options;
        const { restorePwaXtreamUserData } =
            await import('./pwa-xtream-restore');
        await restorePwaXtreamUserData(
            this.userDataStorage,
            playlistId,
            restoreState
        );
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
