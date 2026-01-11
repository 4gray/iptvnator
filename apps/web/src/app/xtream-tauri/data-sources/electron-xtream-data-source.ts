import { inject, Injectable } from '@angular/core';
import { DatabaseService } from 'services';
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
    mapCategoryTypeToDbType,
    ProgressCallback,
    XtreamCategoryFromDb,
    XtreamContentItem,
    XtreamPlaylistData,
} from './xtream-data-source.interface';

/**
 * Electron implementation of the Xtream data source.
 * Uses DB-first strategy: check DB, fetch API if needed, cache to DB.
 */
@Injectable({ providedIn: 'root' })
export class ElectronXtreamDataSource implements IXtreamDataSource {
    private readonly dbService = inject(DatabaseService);
    private readonly apiService = inject(XtreamApiService);

    // =========================================================================
    // Playlist Operations
    // =========================================================================

    async getPlaylist(playlistId: string): Promise<XtreamPlaylistData | null> {
        const playlist = await this.dbService.getPlaylistById(playlistId);
        return playlist as XtreamPlaylistData | null;
    }

    async createPlaylist(playlist: XtreamPlaylistData): Promise<void> {
        await this.dbService.createPlaylist({
            _id: playlist.id,
            title: playlist.name,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        } as any);
    }

    async updatePlaylist(
        playlistId: string,
        updates: Partial<XtreamPlaylistData>
    ): Promise<void> {
        await this.dbService.updateXtreamPlaylistDetails({
            id: playlistId,
            title: updates.name,
            username: updates.username,
            password: updates.password,
            serverUrl: updates.serverUrl,
        });
    }

    async deletePlaylist(playlistId: string): Promise<void> {
        await this.dbService.deletePlaylist(playlistId);
    }

    // =========================================================================
    // Category Operations
    // =========================================================================

    async hasCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<boolean> {
        return this.dbService.hasXtreamCategories(playlistId, type);
    }

    async getCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        const dbType = mapCategoryTypeToDbType(type);

        // Check if we have cached data
        const exists = await this.dbService.hasXtreamCategories(
            playlistId,
            dbType
        );

        if (exists) {
            // Return from cache
            return this.dbService.getXtreamCategories(playlistId, dbType);
        }

        // Fetch from API and cache
        const remoteData = await this.apiService.getCategories(
            credentials,
            type
        );

        if (remoteData && Array.isArray(remoteData) && remoteData.length > 0) {
            await this.dbService.saveXtreamCategories(
                playlistId,
                remoteData,
                dbType
            );
        }

        // Return from cache (now populated)
        return this.dbService.getXtreamCategories(playlistId, dbType);
    }

    async getAllCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        return this.dbService.getAllXtreamCategories(playlistId, type);
    }

    async saveCategories(
        playlistId: string,
        categories: XtreamCategory[],
        type: DbCategoryType
    ): Promise<void> {
        await this.dbService.saveXtreamCategories(playlistId, categories, type);
    }

    async updateCategoryVisibility(
        categoryIds: number[],
        hidden: boolean
    ): Promise<void> {
        await this.dbService.updateCategoryVisibility(categoryIds, hidden);
    }

    // =========================================================================
    // Content/Stream Operations
    // =========================================================================

    async hasContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<boolean> {
        return this.dbService.hasXtreamContent(playlistId, type);
    }

    async getContent(
        playlistId: string,
        credentials: XtreamCredentials,
        type: StreamType
    ): Promise<XtreamContentItem[]> {
        // Check if we have cached data
        const exists = await this.dbService.hasXtreamContent(playlistId, type);

        if (exists) {
            // Return from cache
            return this.dbService.getXtreamContent(playlistId, type);
        }

        // Fetch from API
        const remoteData = await this.apiService.getStreams(credentials, type);

        if (remoteData && Array.isArray(remoteData) && remoteData.length > 0) {
            // Save to cache
            await this.dbService.saveXtreamContent(
                playlistId,
                remoteData as any[],
                type
            );
        }

        // Return from cache (now populated)
        return this.dbService.getXtreamContent(playlistId, type);
    }

    async saveContent(
        playlistId: string,
        streams: any[],
        type: 'live' | 'movie' | 'series',
        onProgress?: ProgressCallback
    ): Promise<number> {
        return this.dbService.saveXtreamContent(
            playlistId,
            streams,
            type,
            onProgress
        );
    }

    // =========================================================================
    // Search Operations
    // =========================================================================

    async searchContent(
        playlistId: string,
        searchTerm: string,
        types: string[]
    ): Promise<XtreamContentItem[]> {
        return this.dbService.searchXtreamContent(playlistId, searchTerm, types);
    }

    // =========================================================================
    // Favorites Operations
    // =========================================================================

    async getFavorites(playlistId: string): Promise<XtreamContentItem[]> {
        return this.dbService.getFavorites(playlistId);
    }

    async addFavorite(contentId: number, playlistId: string): Promise<void> {
        await this.dbService.addToFavorites(contentId, playlistId);
    }

    async removeFavorite(contentId: number, playlistId: string): Promise<void> {
        await this.dbService.removeFromFavorites(contentId, playlistId);
    }

    async isFavorite(contentId: number, playlistId: string): Promise<boolean> {
        return this.dbService.isFavorite(contentId, playlistId);
    }

    // =========================================================================
    // Recently Viewed Operations
    // =========================================================================

    async getRecentItems(playlistId: string): Promise<XtreamContentItem[]> {
        return this.dbService.getRecentItems(playlistId);
    }

    async addRecentItem(contentId: number, playlistId: string): Promise<void> {
        await this.dbService.addRecentItem(contentId, playlistId);
    }

    async removeRecentItem(
        contentId: number,
        playlistId: string
    ): Promise<void> {
        await this.dbService.removeRecentItem(contentId, playlistId);
    }

    async clearRecentItems(playlistId: string): Promise<void> {
        await this.dbService.clearPlaylistRecentItems(playlistId);
    }

    // =========================================================================
    // Content Lookup
    // =========================================================================

    async getContentByXtreamId(
        xtreamId: number,
        playlistId: string
    ): Promise<XtreamContentItem | null> {
        return this.dbService.getContentByXtreamId(xtreamId, playlistId);
    }

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    async clearPlaylistContent(playlistId: string): Promise<{
        favoritedXtreamIds: number[];
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[];
    }> {
        const result =
            await this.dbService.deleteXtreamPlaylistContent(playlistId);
        return {
            favoritedXtreamIds: result.favoritedXtreamIds,
            recentlyViewedXtreamIds: result.recentlyViewedXtreamIds,
        };
    }

    async restoreUserData(
        playlistId: string,
        favoritedXtreamIds: number[],
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[]
    ): Promise<void> {
        await this.dbService.restoreXtreamUserData(
            playlistId,
            favoritedXtreamIds,
            recentlyViewedXtreamIds
        );
    }
}
