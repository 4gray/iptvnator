import { inject, Injectable } from '@angular/core';
import {
    DatabaseService,
    PlaybackPositionService,
    XtreamImportStatus,
} from 'services';
import {
    PlaybackPositionData,
    PlaylistMeta,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';
import {
    CategoryType,
    StreamType,
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import {
    DbCategoryType,
    IXtreamDataSource,
    mapCategoryTypeToDbType,
    ProgressCallback,
    XtreamOperationOptions,
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
    private readonly playbackService = inject(PlaybackPositionService);
    private readonly apiService = inject(XtreamApiService);
    private readonly categoryRequests = new Map<
        string,
        Promise<XtreamCategoryFromDb[]>
    >();
    private readonly contentRequests = new Map<
        string,
        Promise<XtreamContentItem[]>
    >();

    private mapCategoryTypeToImportType(
        type: CategoryType
    ): 'live' | 'movie' | 'series' {
        switch (type) {
            case 'live':
                return 'live';
            case 'vod':
                return 'movie';
            case 'series':
                return 'series';
        }
    }

    private async getImportStatus(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<XtreamImportStatus> {
        return this.dbService.getXtreamImportStatus(playlistId, type);
    }

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
        } as unknown as PlaylistMeta);
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
        type: CategoryType,
        options?: XtreamOperationOptions
    ): Promise<XtreamCategoryFromDb[]> {
        const dbType = mapCategoryTypeToDbType(type);
        const requestKey = `${playlistId}:${dbType}`;
        const inFlightRequest = this.categoryRequests.get(requestKey);

        if (inFlightRequest) {
            return inFlightRequest;
        }

        const request = this.loadCategories(
            playlistId,
            credentials,
            type,
            dbType,
            options
        ).finally(() => {
                this.categoryRequests.delete(requestKey);
            });

        this.categoryRequests.set(requestKey, request);
        return request;
    }

    private async loadCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType,
        dbType: DbCategoryType,
        options?: XtreamOperationOptions
    ): Promise<XtreamCategoryFromDb[]> {
        const importType = this.mapCategoryTypeToImportType(type);
        const importStatus = await this.getImportStatus(playlistId, importType);
        // Fetch from DB directly — avoids a separate 'has' round-trip.
        // An empty result means the cache is cold; proceed to fetch from API.
        const cached = await this.dbService.getXtreamCategories(
            playlistId,
            dbType
        );
        if (importStatus === 'completed' && cached.length > 0) {
            return cached;
        }

        // Fetch from API and cache
        options?.onPhaseChange?.('loading-categories');
        const remoteData = await this.apiService.getCategories(
            credentials,
            type,
            {
                sessionId: options?.sessionId,
            }
        );

        if (remoteData && Array.isArray(remoteData) && remoteData.length > 0) {
            // Check if there are saved hidden categories to restore
            const hiddenCategoryXtreamIds = this.getHiddenCategoryXtreamIds(
                playlistId,
                dbType
            );

            options?.onPhaseChange?.('saving-categories');
            await this.dbService.saveXtreamCategories(
                playlistId,
                remoteData,
                dbType,
                hiddenCategoryXtreamIds
            );
        }

        // Return from cache (now populated)
        return this.dbService.getXtreamCategories(playlistId, dbType);
    }

    /**
     * Get hidden category xtreamIds from localStorage for a specific playlist and type
     * Used to restore visibility preferences after playlist refresh
     */
    private getHiddenCategoryXtreamIds(
        playlistId: string,
        type: 'live' | 'movies' | 'series'
    ): number[] | undefined {
        const restoreKey = `xtream-restore-${playlistId}`;
        const restoreDataStr = localStorage.getItem(restoreKey);

        if (!restoreDataStr) {
            return undefined;
        }

        try {
            const restoreData = JSON.parse(restoreDataStr) as {
                hiddenCategories?: { xtreamId: number; type: string }[];
            };
            const hiddenCategories = restoreData.hiddenCategories;

            if (!hiddenCategories || hiddenCategories.length === 0) {
                return undefined;
            }

            // Filter for the specific type and return xtreamIds
            return hiddenCategories
                .filter((cat) => cat.type === type)
                .map((cat) => cat.xtreamId);
        } catch {
            return undefined;
        }
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
        type: StreamType,
        onProgress?: (count: number) => void,
        onTotal?: (total: number) => void,
        options?: XtreamOperationOptions
    ): Promise<XtreamContentItem[]> {
        const requestKey = `${playlistId}:${type}`;
        const inFlightRequest = this.contentRequests.get(requestKey);

        if (inFlightRequest) {
            return inFlightRequest;
        }

        const request = this.loadContent(
            playlistId,
            credentials,
            type,
            onProgress,
            onTotal,
            options
        ).finally(() => {
            this.contentRequests.delete(requestKey);
        });

        this.contentRequests.set(requestKey, request);
        return request;
    }

    private async loadContent(
        playlistId: string,
        credentials: XtreamCredentials,
        type: StreamType,
        onProgress?: (count: number) => void,
        onTotal?: (total: number) => void,
        options?: XtreamOperationOptions
    ): Promise<XtreamContentItem[]> {
        const importStatus = await this.getImportStatus(playlistId, type);
        // Fetch from DB directly — avoids a separate 'has' round-trip.
        // An empty result means the cache is cold; proceed to fetch from API.
        const cached = await this.dbService.getXtreamContent(playlistId, type);
        if (importStatus === 'completed' && cached.length > 0) {
            return cached;
        }

        // Fetch from API
        options?.onPhaseChange?.(
            type === 'live'
                ? 'loading-live'
                : type === 'movie'
                  ? 'loading-movies'
                  : 'loading-series'
        );
        const remoteData = await this.apiService.getStreams(credentials, type, {
            sessionId: options?.sessionId,
        });

        if (remoteData && Array.isArray(remoteData) && remoteData.length > 0) {
            // Report total items to import
            if (onTotal) {
                onTotal(remoteData.length);
            }

            // Save to cache with progress tracking
            await this.dbService.saveXtreamContent(
                playlistId,
                remoteData as
                    | XtreamLiveStream[]
                    | XtreamVodStream[]
                    | XtreamSerieItem[],
                type,
                onProgress,
                options
            );
        }

        // Return from cache (now populated)
        return this.dbService.getXtreamContent(playlistId, type);
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
        return this.dbService.saveXtreamContent(
            playlistId,
            streams,
            type,
            onProgress,
            options
        );
    }

    // =========================================================================
    // Search Operations
    // =========================================================================

    async searchContent(
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ): Promise<XtreamContentItem[]> {
        return this.dbService.searchXtreamContent(
            playlistId,
            searchTerm,
            types,
            excludeHidden
        );
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
        playlistId: string,
        contentType?: 'live' | 'movie' | 'series'
    ): Promise<XtreamContentItem | null> {
        return this.dbService.getContentByXtreamId(
            xtreamId,
            playlistId,
            contentType
        );
    }

    // =========================================================================
    // Playback Position Operations
    // =========================================================================

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        await this.playbackService.savePlaybackPosition(playlistId, data);
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        return this.playbackService.getPlaybackPosition(
            playlistId,
            contentXtreamId,
            contentType
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        return this.playbackService.getSeriesPlaybackPositions(
            playlistId,
            seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        return this.playbackService.getRecentPlaybackPositions(
            playlistId,
            limit
        );
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        return this.playbackService.getAllPlaybackPositions(playlistId);
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        await this.playbackService.clearPlaybackPosition(
            playlistId,
            contentXtreamId,
            contentType
        );
    }

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    /**
     * No-op for Electron: DB-backed storage has no in-memory session cache to clear.
     */
    clearSessionCache(playlistId: string): void {
        void playlistId;
        // Electron uses the DB as its cache layer; no in-memory state to evict.
    }

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
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[],
        options?: XtreamOperationOptions
    ): Promise<void> {
        await this.dbService.restoreXtreamUserData(
            playlistId,
            favoritedXtreamIds,
            recentlyViewedXtreamIds,
            options
        );
    }
}
