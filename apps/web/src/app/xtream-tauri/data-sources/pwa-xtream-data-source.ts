import { inject, Injectable } from '@angular/core';
import {
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';
import { CategoryType, StreamType, XtreamApiService, XtreamCredentials } from '../services/xtream-api.service';
import {
    DbCategoryType,
    IXtreamDataSource,
    ProgressCallback,
    XtreamCategoryFromDb,
    XtreamContentItem,
    XtreamPlaylistData,
} from './xtream-data-source.interface';

/**
 * LocalStorage keys for PWA persistence
 */
const STORAGE_KEYS = {
    FAVORITES: 'xtream-favorites',
    RECENT_ITEMS: 'xtream-recent-items',
    PLAYLISTS: 'xtream-playlists',
    PLAYBACK_POSITIONS: 'xtream-playback-positions',
};

/**
 * PWA implementation of the Xtream data source.
 * Uses API-only strategy: always fetch from API, no database caching.
 * Favorites and recently viewed are stored in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class PwaXtreamDataSource implements IXtreamDataSource {
    private readonly apiService = inject(XtreamApiService);

    // In-memory cache for the current session
    private categoryCache = new Map<string, XtreamCategory[]>();
    private contentCache = new Map<string, any[]>();

    // =========================================================================
    // Playlist Operations (localStorage)
    // =========================================================================

    async getPlaylist(playlistId: string): Promise<XtreamPlaylistData | null> {
        const playlists = this.getPlaylistsFromStorage();
        return playlists.find((p) => p.id === playlistId) || null;
    }

    async createPlaylist(playlist: XtreamPlaylistData): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        playlists.push(playlist);
        this.savePlaylistsToStorage(playlists);
    }

    async updatePlaylist(
        playlistId: string,
        updates: Partial<XtreamPlaylistData>
    ): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        const index = playlists.findIndex((p) => p.id === playlistId);
        if (index !== -1) {
            playlists[index] = { ...playlists[index], ...updates };
            this.savePlaylistsToStorage(playlists);
        }
    }

    async deletePlaylist(playlistId: string): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        const filtered = playlists.filter((p) => p.id !== playlistId);
        this.savePlaylistsToStorage(filtered);

        // Also clear favorites and recent items for this playlist
        this.clearFavoritesForPlaylist(playlistId);
        this.clearRecentItemsForPlaylist(playlistId);
        this.clearPlaybackPositionsForPlaylist(playlistId);

        // Clear cache
        this.clearCacheForPlaylist(playlistId);
    }

    private getPlaylistsFromStorage(): XtreamPlaylistData[] {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    private savePlaylistsToStorage(playlists: XtreamPlaylistData[]): void {
        localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
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
        type: CategoryType
    ): Promise<XtreamCategory[]> {
        const cacheKey = `${playlistId}-${type}-categories`;

        // Check in-memory cache first
        if (this.categoryCache.has(cacheKey)) {
            return this.categoryCache.get(cacheKey)!;
        }

        // Fetch from API
        const categories = await this.apiService.getCategories(
            credentials,
            type
        );

        // Cache in memory
        this.categoryCache.set(cacheKey, categories);

        return categories;
    }

    async getAllCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        // PWA doesn't track hidden categories - return empty
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
        // Category visibility is not supported in PWA mode
        console.warn('Category visibility not supported in PWA mode');
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
        onTotal?: (total: number) => void
    ): Promise<XtreamLiveStream[] | XtreamVodStream[] | XtreamSerieItem[]> {
        const cacheKey = `${playlistId}-${type}-content`;

        // Check in-memory cache first
        if (this.contentCache.has(cacheKey)) {
            return this.contentCache.get(cacheKey)!;
        }

        // Fetch from API
        const content = await this.apiService.getStreams(credentials, type);

        // Report total and progress (PWA doesn't have incremental save, so report all at once)
        if (onTotal) {
            onTotal(content.length);
        }
        if (onProgress) {
            onProgress(content.length);
        }

        // Cache in memory
        this.contentCache.set(cacheKey, content);

        return content;
    }

    async saveContent(
        playlistId: string,
        streams: any[],
        type: 'live' | 'movie' | 'series',
        onProgress?: ProgressCallback
    ): Promise<number> {
        // In PWA mode, we just cache in memory
        const cacheKey = `${playlistId}-${type}-content`;
        this.contentCache.set(cacheKey, streams);

        if (onProgress) {
            onProgress(streams.length);
        }

        return streams.length;
    }

    // =========================================================================
    // Search Operations (in-memory filter)
    // =========================================================================

    async searchContent(
        playlistId: string,
        searchTerm: string,
        types: string[]
    ): Promise<XtreamContentItem[]> {
        const results: any[] = [];
        const searchLower = searchTerm.toLowerCase();

        for (const type of types) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            const filtered = content.filter((item: any) => {
                const title =
                    item.name || item.title || item.stream_display_name || '';
                return title.toLowerCase().includes(searchLower);
            });

            results.push(...filtered);
        }

        return results as XtreamContentItem[];
    }

    // =========================================================================
    // Favorites Operations (localStorage)
    // =========================================================================

    async getFavorites(playlistId: string): Promise<XtreamContentItem[]> {
        const allFavorites = this.getFavoritesFromStorage();
        const playlistFavorites = allFavorites[playlistId] || [];

        // Match favorites with cached content
        const results: any[] = [];
        for (const type of ['live', 'movie', 'series']) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            for (const item of content as any[]) {
                const itemId = item.stream_id || item.series_id || item.id;
                if (playlistFavorites.includes(itemId)) {
                    results.push(item);
                }
            }
        }

        return results as XtreamContentItem[];
    }

    async addFavorite(contentId: number, playlistId: string): Promise<void> {
        const allFavorites = this.getFavoritesFromStorage();
        if (!allFavorites[playlistId]) {
            allFavorites[playlistId] = [];
        }
        if (!allFavorites[playlistId].includes(contentId)) {
            allFavorites[playlistId].push(contentId);
        }
        this.saveFavoritesToStorage(allFavorites);
    }

    async removeFavorite(contentId: number, playlistId: string): Promise<void> {
        const allFavorites = this.getFavoritesFromStorage();
        if (allFavorites[playlistId]) {
            allFavorites[playlistId] = allFavorites[playlistId].filter(
                (id: number) => id !== contentId
            );
        }
        this.saveFavoritesToStorage(allFavorites);
    }

    async isFavorite(contentId: number, playlistId: string): Promise<boolean> {
        const allFavorites = this.getFavoritesFromStorage();
        return (allFavorites[playlistId] || []).includes(contentId);
    }

    private getFavoritesFromStorage(): Record<string, number[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private saveFavoritesToStorage(
        favorites: Record<string, number[]>
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

    async savePlaybackPosition(playlistId: string, data: any): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (!allPositions[playlistId]) {
            allPositions[playlistId] = [];
        }

        // Remove existing entry if present
        allPositions[playlistId] = allPositions[playlistId].filter(
            (p: any) =>
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
    ): Promise<any | null> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return (
            playlistPositions.find(
                (p: any) =>
                    p.contentXtreamId === contentXtreamId &&
                    p.contentType === contentType
            ) || null
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<any[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return playlistPositions.filter(
            (p: any) =>
                p.contentType === 'episode' && p.seriesXtreamId === seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<any[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        // Sort by updatedAt descending
        playlistPositions.sort(
            (a: any, b: any) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        return limit ? playlistPositions.slice(0, limit) : playlistPositions;
    }

    async getAllPlaybackPositions(playlistId: string): Promise<any[]> {
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
                (p: any) =>
                    !(
                        p.contentXtreamId === contentXtreamId &&
                        p.contentType === contentType
                    )
            );
            this.savePlaybackPositionsToStorage(allPositions);
        }
    }

    private getPlaybackPositionsFromStorage(): Record<string, any[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.PLAYBACK_POSITIONS);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private savePlaybackPositionsToStorage(
        positions: Record<string, any[]>
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
        const allRecent = this.getRecentItemsFromStorage();
        const playlistRecent = allRecent[playlistId] || [];

        // Match recent items with cached content
        const results: any[] = [];
        for (const type of ['live', 'movie', 'series']) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            for (const item of content as any[]) {
                const itemId = item.stream_id || item.series_id || item.id;
                const recentEntry = playlistRecent.find(
                    (r: any) => r.id === itemId
                );
                if (recentEntry) {
                    results.push({
                        ...item,
                        viewed_at: recentEntry.viewedAt,
                    });
                }
            }
        }

        // Sort by viewed_at descending
        results.sort(
            (a, b) =>
                new Date(b.viewed_at).getTime() -
                new Date(a.viewed_at).getTime()
        );

        return results as XtreamContentItem[];
    }

    async addRecentItem(contentId: number, playlistId: string): Promise<void> {
        const allRecent = this.getRecentItemsFromStorage();
        if (!allRecent[playlistId]) {
            allRecent[playlistId] = [];
        }

        // Remove existing entry if present
        allRecent[playlistId] = allRecent[playlistId].filter(
            (r: any) => r.id !== contentId
        );

        // Add new entry at the beginning
        allRecent[playlistId].unshift({
            id: contentId,
            viewedAt: new Date().toISOString(),
        });

        // Keep only last 50 items
        allRecent[playlistId] = allRecent[playlistId].slice(0, 50);

        this.saveRecentItemsToStorage(allRecent);
    }

    async removeRecentItem(
        contentId: number,
        playlistId: string
    ): Promise<void> {
        const allRecent = this.getRecentItemsFromStorage();
        if (allRecent[playlistId]) {
            allRecent[playlistId] = allRecent[playlistId].filter(
                (r: any) => r.id !== contentId
            );
        }
        this.saveRecentItemsToStorage(allRecent);
    }

    async clearRecentItems(playlistId: string): Promise<void> {
        this.clearRecentItemsForPlaylist(playlistId);
    }

    private getRecentItemsFromStorage(): Record<
        string,
        { id: number; viewedAt: string }[]
    > {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.RECENT_ITEMS);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private saveRecentItemsToStorage(
        recentItems: Record<string, { id: number; viewedAt: string }[]>
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

    // =========================================================================
    // Content Lookup
    // =========================================================================

    async getContentByXtreamId(
        xtreamId: number,
        playlistId: string
    ): Promise<XtreamContentItem | null> {
        for (const type of ['live', 'movie', 'series']) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            const found = (content as any[]).find((item) => {
                const itemXtreamId =
                    item.stream_id || item.series_id || item.id;
                return itemXtreamId === xtreamId;
            });

            if (found) {
                return found as XtreamContentItem;
            }
        }

        return null;
    }

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    async clearPlaylistContent(playlistId: string): Promise<{
        favoritedXtreamIds: number[];
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[];
    }> {
        // Get current favorites and recent items
        const favorites = this.getFavoritesFromStorage();
        const recentItems = this.getRecentItemsFromStorage();

        const favoritedXtreamIds = favorites[playlistId] || [];
        const recentlyViewedXtreamIds = (recentItems[playlistId] || []).map(
            (r: any) => ({
                xtreamId: r.id,
                viewedAt: r.viewedAt,
            })
        );

        // Clear in-memory cache
        this.clearCacheForPlaylist(playlistId);

        return { favoritedXtreamIds, recentlyViewedXtreamIds };
    }

    async restoreUserData(
        playlistId: string,
        favoritedXtreamIds: number[],
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[]
    ): Promise<void> {
        // Restore favorites
        const favorites = this.getFavoritesFromStorage();
        favorites[playlistId] = favoritedXtreamIds;
        this.saveFavoritesToStorage(favorites);

        // Restore recent items
        const recentItems = this.getRecentItemsFromStorage();
        recentItems[playlistId] = recentlyViewedXtreamIds.map((r) => ({
            id: r.xtreamId,
            viewedAt: r.viewedAt,
        }));
        this.saveRecentItemsToStorage(recentItems);
    }

    // =========================================================================
    // Cache Management
    // =========================================================================

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
