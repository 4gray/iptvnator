import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    ParentalLockService,
    PlaybackPositionService,
    XtreamPendingRestoreService,
    XtreamImportStatus,
    VodSourcePinService,
} from '@iptvnator/services';
import {
    normalizeXtreamContentTypes,
    XtreamContentType,
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
    XtreamCollectionRef,
    xtreamCollectionId,
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
    private readonly playlistMetas = inject(Store, {
        optional: true,
    })?.selectSignal(selectAllPlaylistsMeta);
    private readonly dbService = inject(DatabaseService);
    private readonly playbackService = inject(PlaybackPositionService);
    private readonly vodSourcePinService = inject(VodSourcePinService);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );
    private readonly injector = inject(Injector);
    private readonly apiService = inject(XtreamApiService);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly categoryRequests = new Map<
        string,
        Promise<XtreamCategoryFromDb[]>
    >();
    private readonly contentRequests = new Map<
        string,
        Promise<XtreamContentItem[]>
    >();

    private async getEnabledContentTypes(
        playlistId: string
    ): Promise<XtreamContentType[]> {
        // The app already owns reactive source metadata. Do not re-read the
        // entire playlist over IPC for every category/content/cache check.
        const meta = this.playlistMetas?.().find(
            (row) => row._id === playlistId
        );
        const playlist = meta ?? (await this.getPlaylist(playlistId));
        return normalizeXtreamContentTypes(playlist?.xtreamContentTypes);
    }

    private async isEnabled(
        playlistId: string,
        type: string
    ): Promise<boolean> {
        const normalized = type === 'vod' || type === 'movies' ? 'movie' : type;
        return (await this.getEnabledContentTypes(playlistId)).some(
            (value) => value === normalized
        );
    }

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
        if (!(await this.isEnabled(playlistId, type))) return true;
        return this.dbService.hasXtreamCategories(playlistId, type);
    }

    async getCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType,
        options?: XtreamOperationOptions
    ): Promise<XtreamCategoryFromDb[]> {
        // Fail closed with the renderer: while the lock store is loading,
        // unreadable or its SQLite index not yet reconciled, the index may
        // still carry a stale `locked = false` stamp, so nothing is served.
        if (this.parentalLock.withholdsEverything?.()) {
            return [];
        }
        if (!(await this.isEnabled(playlistId, type))) return [];
        const dbType = mapCategoryTypeToDbType(type);
        // The lock version keys the share: a read issued under an older lock
        // state (still unlocked, or locks since edited) answers with rows the
        // caller under the newer state must not be handed.
        const requestKey = `${playlistId}:${dbType}:${this.parentalLock.version()}`;
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
        if (
            importStatus !== 'completed' &&
            (importStatus !== 'idle' ||
                this.pendingRestoreService.get(playlistId)
                    ?.preservePlaybackPositions)
        ) {
            const { clearIncompleteCatalog } =
                await import('./xtream-category-import');
            await clearIncompleteCatalog(
                this.dbService,
                playlistId,
                importType
            );
        }
        // Fetch from DB directly — avoids a separate 'has' round-trip.
        // An empty result means the cache is cold; proceed to fetch from API.
        const cached = await this.dbService.getXtreamCategories(
            playlistId,
            dbType
        );
        // The read is filtered by the parental lock, so an empty result is
        // not proof of a cold cache: a type whose every category is locked
        // is complete and must not be refetched from the provider.
        if (
            importStatus === 'completed' &&
            (cached.length > 0 ||
                (await this.dbService.hasXtreamCategories(playlistId, dbType)))
        ) {
            return cached;
        }

        const { loadRemoteCategories } =
            await import('./xtream-category-import');
        return loadRemoteCategories(
            {
                db: this.dbService,
                api: this.apiService,
                pending: this.pendingRestoreService,
                locks: this.parentalLock,
            },
            playlistId,
            credentials,
            type,
            dbType,
            options
        );
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
        // Same fail-closed gate as the live reads: the warm-route hydration
        // reads the cache directly and must not publish rows a stale index
        // stamp still marks unlocked.
        if (this.parentalLock.withholdsEverything?.()) {
            return [];
        }
        if (!(await this.isEnabled(playlistId, type))) return [];
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
        if (!(await this.isEnabled(playlistId, type))) return true;
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
        // Fail closed with the renderer: while the lock store is loading,
        // unreadable or its SQLite index not yet reconciled, the index may
        // still carry a stale `locked = false` stamp, so nothing is served.
        if (this.parentalLock.withholdsEverything?.()) {
            return [];
        }
        if (!(await this.isEnabled(playlistId, type))) return [];
        const requestKey = `${playlistId}:${type}:${this.parentalLock.version()}`;
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
        // Filtered by the parental lock like the category read: empty is not
        // cold while unfiltered rows exist.
        if (
            importStatus === 'completed' &&
            (cached.length > 0 ||
                (await this.dbService.hasXtreamContent(playlistId, type)))
        ) {
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
        // Same fail-closed gate as the live reads: the warm-route hydration
        // reads the cache directly and must not publish rows a stale index
        // stamp still marks unlocked.
        if (this.parentalLock.withholdsEverything?.()) {
            return [];
        }
        if (!(await this.isEnabled(playlistId, type))) return [];
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
        // Fail closed with the renderer: while the lock store is loading,
        // unreadable or its SQLite index not yet reconciled, the index may
        // still carry a stale `locked = false` stamp, so nothing is served.
        if (this.parentalLock.withholdsEverything?.()) {
            return [];
        }
        const enabled = await this.getEnabledContentTypes(playlistId);
        const selected = types.filter((type) =>
            enabled.some((value) => value === type)
        );
        if (!selected.length) return [];
        return this.dbService.searchXtreamContent(
            playlistId,
            searchTerm,
            selected,
            excludeHidden
        );
    }

    // =========================================================================
    // Favorites Operations
    // =========================================================================

    async getFavorites(
        playlistId: string
    ): Promise<import('./xtream-data-source.interface').XtreamFavoriteItem[]> {
        return this.dbService.getFavorites(playlistId);
    }

    async addFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void> {
        await this.dbService.addToFavoritesOrThrow(
            xtreamCollectionId(contentId),
            playlistId,
            backdropUrl
        );
    }

    async removeFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<void> {
        await this.dbService.removeFromFavorites(
            xtreamCollectionId(contentId),
            playlistId
        );
    }

    async isFavorite(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<boolean> {
        return this.dbService.isFavorite(
            xtreamCollectionId(contentId),
            playlistId
        );
    }

    // =========================================================================
    // Recently Viewed Operations
    // =========================================================================

    async getRecentItems(playlistId: string): Promise<XtreamContentItem[]> {
        return this.dbService.getRecentItems(playlistId);
    }

    async addRecentItem(
        contentId: XtreamCollectionRef,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void> {
        await this.dbService.addRecentItem(
            xtreamCollectionId(contentId),
            playlistId,
            backdropUrl
        );
    }

    async removeRecentItem(
        contentId: XtreamCollectionRef,
        playlistId: string
    ): Promise<void> {
        await this.dbService.removeRecentItem(
            xtreamCollectionId(contentId),
            playlistId
        );
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
        contentType?: 'live' | 'movie' | 'series',
        identity?: ContentMetadataPatch
    ): Promise<XtreamContentItem | null> {
        return this.dbService.getContentByXtreamId(
            xtreamId,
            playlistId,
            contentType,
            ...(identity ? [identity] : [])
        );
    }

    async setContentMetadataIfMissing(
        contentId: XtreamCollectionRef,
        playlistId: string,
        patch: ContentMetadataPatch
    ): Promise<void> {
        void playlistId;
        await this.dbService.setContentMetadataIfMissing(
            xtreamCollectionId(contentId),
            patch
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
        const { clearElectronCatalogCache } =
            await import('./xtream-deferred-restore');
        return clearElectronCatalogCache(
            {
                db: this.dbService,
                playback: this.playbackService,
                pins: this.vodSourcePinService,
                getPlaylist: (id) => this.getPlaylist(id),
            },
            playlistId
        );
    }

    async restoreFavoriteSnapshots(
        playlistId: string,
        state: XtreamPendingRestoreState
    ): Promise<void> {
        this.playbackService.assertSupportsAtomicReplacement();
        if (!state.preservePlaybackPositions || !state.catalogSnapshot) {
            const { prepareElectronFavoriteRestore } =
                await import('./xtream-deferred-restore');
            await prepareElectronFavoriteRestore(
                this.dbService,
                this.injector,
                playlistId,
                state
            );
        }
        await this.dbService.restoreXtreamFavoriteSnapshots(
            playlistId,
            state.favorites,
            state.favoritesRestoreId
        );
    }

    async restoreUserData(
        playlistId: string,
        restoreState: XtreamPendingRestoreState,
        options?: XtreamOperationOptions
    ): Promise<void> {
        const { restoreElectronUserData } =
            await import('./xtream-deferred-restore');
        await restoreElectronUserData(
            {
                db: this.dbService,
                playback: this.playbackService,
                pins: this.vodSourcePinService,
                injector: this.injector,
                getPlaylist: (id) => this.getPlaylist(id),
                restoreFavorites: (id, state) =>
                    this.restoreFavoriteSnapshots(id, state),
            },
            playlistId,
            restoreState,
            options
        );
    }
}
