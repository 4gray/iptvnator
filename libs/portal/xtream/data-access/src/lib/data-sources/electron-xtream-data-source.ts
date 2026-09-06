import { inject, Injectable } from '@angular/core';
import {
    DatabaseService,
    PlaybackPositionService,
    XtreamPendingRestoreService,
    XtreamImportStatus,
    VodSourcePinService,
} from '@iptvnator/services';
import {
    ContentMetadataPatch,
    PlaybackPositionData,
    PlaylistMeta,
    XtreamPendingRestoreState,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
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
    private readonly vodSourcePinService = inject(VodSourcePinService);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );
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

    async rememberServerTimezone(
        playlistId: string,
        credentials: XtreamCredentials,
        serverTimezone: string
    ): Promise<void> {
        // One conditional UPDATE in the worker (`DB_SET_PLAYLIST_SERVER_TIMEZONE`):
        // the row-level connection match and the no-op-when-equal check
        // happen inside the statement, never as a read here.
        await this.dbService.setXtreamPlaylistServerTimezone(
            playlistId,
            {
                serverUrl: credentials.serverUrl,
                username: credentials.username,
                password: credentials.password,
            },
            serverTimezone
        );
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
        // The DB read below is the slow part of a warm start; report it as a
        // phase so the sync overlay never shows a phaseless card.
        options?.onPhaseChange?.('loading-cached');
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
        const restoreData = this.pendingRestoreService.get(playlistId);
        const hiddenCategories = restoreData?.hiddenCategories;

        if (!hiddenCategories || hiddenCategories.length === 0) {
            return undefined;
        }

        return hiddenCategories
            .filter((category) => category.categoryType === type)
            .map((category) => category.xtreamId);
    }

    async getAllCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        return this.dbService.getAllXtreamCategories(playlistId, type);
    }

    async getCachedCategories(
        playlistId: string,
        type: CategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        return this.dbService.getXtreamCategories(
            playlistId,
            mapCategoryTypeToDbType(type)
        );
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
        // The DB read below is the slow part of a warm start; report it as a
        // phase so the sync overlay never shows a phaseless card.
        options?.onPhaseChange?.('loading-cached');
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
                    XtreamLiveStream[] | XtreamVodStream[] | XtreamSerieItem[],
                type,
                onProgress,
                options
            );
        }

        // Return from cache (now populated)
        return this.dbService.getXtreamContent(playlistId, type);
    }

    async getCachedContent(
        playlistId: string,
        type: StreamType
    ): Promise<XtreamContentItem[]> {
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
            streams as Parameters<DatabaseService['saveXtreamContent']>[1],
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

    async addFavorite(
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void> {
        await this.dbService.addToFavorites(contentId, playlistId, backdropUrl);
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

    async addRecentItem(
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void> {
        await this.dbService.addRecentItem(contentId, playlistId, backdropUrl);
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

    async setContentMetadataIfMissing(
        contentId: number,
        playlistId: string,
        patch: ContentMetadataPatch
    ): Promise<void> {
        void playlistId;
        await this.dbService.setContentMetadataIfMissing(contentId, patch);
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
        // Failure-propagating on purpose: the store and catalog caches must
        // not mistake a failed read for an authoritative empty list.
        return this.playbackService.getAllPlaybackPositionsOrThrow(playlistId);
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

    async savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void> {
        await this.playbackService.savePlaybackPositionsBatch(
            playlistId,
            items
        );
    }

    async clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void> {
        await this.playbackService.clearPlaybackPositionsBatch(
            playlistId,
            items
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

    async clearPlaylistContent(
        playlistId: string
    ): Promise<XtreamPendingRestoreState> {
        const [result, playbackPositions, sourcePins] = await Promise.all([
            this.dbService.deleteXtreamPlaylistContent(playlistId),
            this.playbackService.getAllPlaybackPositions(playlistId),
            this.vodSourcePinService.listForPlaylist(playlistId),
        ]);

        return {
            hiddenCategories: result.hiddenCategories,
            favorites: result.favorites,
            recentlyViewed: result.recentlyViewed,
            playbackPositions,
            sourcePins: sourcePins.map((pin) => ({
                matchKey: pin.matchKey,
                contentId: pin.contentId,
                ...(pin.updatedAt ? { updatedAt: pin.updatedAt } : {}),
            })),
        };
    }

    async restoreUserData(
        playlistId: string,
        restoreState: XtreamPendingRestoreState,
        options?: XtreamOperationOptions
    ): Promise<void> {
        const categoriesByType = await Promise.all([
            this.dbService.getAllXtreamCategories(playlistId, 'live'),
            this.dbService.getAllXtreamCategories(playlistId, 'movies'),
            this.dbService.getAllXtreamCategories(playlistId, 'series'),
        ]);
        for (const categories of categoriesByType) {
            if (categories.length === 0) {
                continue;
            }

            const reset = await this.dbService.updateCategoryVisibility(
                categories.map((category) => category.id),
                false
            );
            if (!reset) {
                throw new Error(
                    `Resetting category visibility for "${playlistId}" failed.`
                );
            }

            const hiddenCategoryIds = categories
                .filter((category) =>
                    restoreState.hiddenCategories.some(
                        (hiddenCategory) =>
                            hiddenCategory.categoryType === category.type &&
                            hiddenCategory.xtreamId === category.xtream_id
                    )
                )
                .map((category) => category.id);
            if (
                hiddenCategoryIds.length > 0 &&
                !(await this.dbService.updateCategoryVisibility(
                    hiddenCategoryIds,
                    true
                ))
            ) {
                throw new Error(
                    `Restoring category visibility for "${playlistId}" failed.`
                );
            }
        }

        await this.dbService.restoreXtreamUserData(
            playlistId,
            restoreState.favorites,
            restoreState.recentlyViewed,
            options
        );

        await this.playbackService.clearAllPlaybackPositions(playlistId);

        for (const playbackPosition of restoreState.playbackPositions) {
            await this.playbackService.savePlaybackPosition(
                playlistId,
                playbackPosition
            );
        }

        // The fresh-import path lands here rather than in the backup service:
        // a new playlist has no content yet when the archive is read, so its
        // user state is parked and applied once the import finishes.
        if (!restoreState.sourcePins) {
            return;
        }

        const pins = restoreState.sourcePins.map((pin) => ({
            matchKey: pin.matchKey,
            playlistId,
            contentId: pin.contentId,
            portalType: 'xtream' as const,
            ...(pin.updatedAt ? { updatedAt: pin.updatedAt } : {}),
        }));
        const replaced = await this.vodSourcePinService.replaceForPlaylist(
            playlistId,
            pins
        );

        // Throwing keeps the pending state for a later retry — the caller only
        // clears it when this resolves. Dropping it here would lose the
        // preference with the import still reporting success.
        if (!replaced) {
            throw new Error(
                `Restoring the pinned sources for "${playlistId}" failed.`
            );
        }
    }
}
