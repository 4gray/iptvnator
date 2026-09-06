import { InjectionToken } from '@angular/core';
import {
    ContentMetadataPatch,
    PlaybackPositionData,
    XtreamPendingRestoreState,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import type { DbOperationEvent } from '@iptvnator/services';
import {
    CategoryType,
    StreamType,
    XtreamCredentials,
} from '../services/xtream-api.service';

// Re-export for backward compatibility
export { PlaybackPositionData };

/**
 * Playlist representation in the data source
 */
export interface XtreamPlaylistData {
    id: string;
    name: string;
    title?: string; // Alias for name, used in some templates
    updateDate?: number;
    serverUrl: string;
    username: string;
    password: string;
    type: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
    serverTimezone?: string;
    allowedOutputFormats?: string[];
}

/**
 * Content item from the data source.
 * Includes fields from XtreamItem for template compatibility.
 */
export interface XtreamContentItem {
    // Core DB fields
    id: number;
    category_id: number | string; // Can be number (DB) or string (API)
    title: string;
    rating: string;
    added: string;
    poster_url: string;
    backdrop_url?: string | null;
    tmdb_id?: number | null;
    release_year?: number | null;
    original_title?: string | null;
    epg_channel_id?: string | null;
    tv_archive?: number | null;
    tv_archive_duration?: number | null;
    direct_source?: string | null;
    xtream_id: number;
    type: string;
    added_at?: string;
    viewed_at?: string;
    position?: number | null;

    // XtreamItem compatibility fields (optional for search/navigation)
    num?: number;
    name?: string;
    stream_type?: 'live' | 'movie';
    stream_id?: number;
    stream_icon?: string;
    custom_sid?: string;
    rating_imdb?: string;

    // Global search result fields
    description?: string;
    playlist_id?: string;
    playlist_name?: string;
}

/**
 * Category from the database with additional fields
 */
export interface XtreamCategoryFromDb {
    id: number;
    name: string;
    playlist_id: string;
    type: 'movies' | 'live' | 'series';
    xtream_id: number;
    hidden: boolean;
}

/**
 * Recently viewed item with playlist info
 */
export interface RecentlyViewedItem extends XtreamContentItem {
    viewed_at: string;
}

/**
 * Database category type mapping (differs from API type)
 */
export type DbCategoryType = 'live' | 'movies' | 'series';

/**
 * Maps CategoryType to DbCategoryType
 */
export function mapCategoryTypeToDbType(type: CategoryType): DbCategoryType {
    switch (type) {
        case 'live':
            return 'live';
        case 'vod':
            return 'movies';
        case 'series':
            return 'series';
    }
}

/**
 * Maps StreamType to DbCategoryType for content storage
 */
export function mapStreamTypeToDbType(
    type: StreamType
): 'live' | 'movie' | 'series' {
    return type;
}

/**
 * Progress callback for bulk operations
 */
export type ProgressCallback = (count: number) => void;

export interface XtreamOperationOptions {
    operationId?: string;
    sessionId?: string;
    onEvent?: (event: DbOperationEvent) => void;
    onPhaseChange?: (phase: string) => void;
}

/**
 * Abstract interface for Xtream data source.
 * Allows different implementations for Electron (DB-first) and PWA (API-only).
 */
export interface IXtreamDataSource {
    // =========================================================================
    // Playlist Operations
    // =========================================================================

    /**
     * Get playlist by ID
     */
    getPlaylist(playlistId: string): Promise<XtreamPlaylistData | null>;

    /**
     * Create a new playlist
     */
    createPlaylist(playlist: XtreamPlaylistData): Promise<void>;

    /**
     * Update playlist details
     */
    updatePlaylist(
        playlistId: string,
        updates: Partial<XtreamPlaylistData>
    ): Promise<void>;

    /**
     * Persist the panel clock a successful account-info check learned
     * (`resolveXtreamServerTimezone`) onto the stored playlist row, which
     * the Favorites / Recent catch-up resolver reads instead of the store
     * (issue #1562). Each runtime applies it atomically against the row's
     * current connection: the write lands only while the row still points
     * at `credentials`, so an edit that moved the source meanwhile keeps
     * the clock the edit flow dropped, and a row already carrying the value
     * is left untouched. Never rejects — a failed write is retried by the
     * next check.
     */
    rememberServerTimezone(
        playlistId: string,
        credentials: XtreamCredentials,
        serverTimezone: string
    ): Promise<void>;

    /**
     * Delete a playlist and all its data
     */
    deletePlaylist(playlistId: string): Promise<void>;

    // =========================================================================
    // Category Operations
    // =========================================================================

    /**
     * Check if categories exist for a playlist and type
     */
    hasCategories(playlistId: string, type: DbCategoryType): Promise<boolean>;

    /**
     * Get categories for a playlist and type
     * Returns only visible categories by default
     */
    getCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType,
        options?: XtreamOperationOptions
    ): Promise<XtreamCategory[] | XtreamCategoryFromDb[]>;

    /**
     * Get persisted categories without contacting the Xtream API.
     * Electron reads SQLite; PWA has no persisted DB cache and returns [].
     */
    getCachedCategories(
        playlistId: string,
        type: CategoryType
    ): Promise<XtreamCategoryFromDb[]>;

    /**
     * Get all categories including hidden (for management)
     */
    getAllCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<XtreamCategoryFromDb[]>;

    /**
     * Save categories in bulk
     */
    saveCategories(
        playlistId: string,
        categories: XtreamCategory[],
        type: DbCategoryType
    ): Promise<void>;

    /**
     * Update category visibility
     */
    updateCategoryVisibility(
        categoryIds: number[],
        hidden: boolean
    ): Promise<void>;

    // =========================================================================
    // Content/Stream Operations
    // =========================================================================

    /**
     * Check if content exists for a playlist and type
     */
    hasContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<boolean>;

    /**
     * Get content/streams for a playlist and type
     * @param onProgress - Optional callback for import progress (count)
     * @param onTotal - Optional callback for total items to import
     */
    getContent(
        playlistId: string,
        credentials: XtreamCredentials,
        type: StreamType,
        onProgress?: ProgressCallback,
        onTotal?: (total: number) => void,
        options?: XtreamOperationOptions
    ): Promise<
        | XtreamLiveStream[]
        | XtreamVodStream[]
        | XtreamSerieItem[]
        | XtreamContentItem[]
    >;

    /**
     * Get persisted content without contacting the Xtream API.
     * Electron reads SQLite; PWA has no persisted DB cache and returns [].
     */
    getCachedContent(
        playlistId: string,
        type: StreamType
    ): Promise<XtreamContentItem[]>;

    /**
     * Save content in bulk
     */
    saveContent(
        playlistId: string,
        streams:
            | XtreamLiveStream[]
            | XtreamVodStream[]
            | XtreamSerieItem[]
            | XtreamContentItem[],
        type: 'live' | 'movie' | 'series',
        onProgress?: ProgressCallback,
        options?: XtreamOperationOptions
    ): Promise<number>;

    // =========================================================================
    // Search Operations
    // =========================================================================

    /**
     * Search content within a playlist
     */
    searchContent(
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ): Promise<XtreamContentItem[]>;

    // =========================================================================
    // Favorites Operations
    // =========================================================================

    /**
     * Get all favorites for a playlist
     */
    getFavorites(playlistId: string): Promise<XtreamContentItem[]>;

    /**
     * Add content to favorites.
     * @param backdropUrl optionally persisted to `content.backdrop_url` when
     * the row doesn't already have one. Enables the dashboard hero to surface
     * a cinematic backdrop without a separate round-trip.
     */
    addFavorite(
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void>;

    /**
     * Remove content from favorites
     */
    removeFavorite(contentId: number, playlistId: string): Promise<void>;

    /**
     * Check if content is favorited
     */
    isFavorite(contentId: number, playlistId: string): Promise<boolean>;

    // =========================================================================
    // Recently Viewed Operations
    // =========================================================================

    /**
     * Get recently viewed items for a playlist
     */
    getRecentItems(playlistId: string): Promise<XtreamContentItem[]>;

    /**
     * Add item to recently viewed. See `addFavorite` for `backdropUrl`.
     */
    addRecentItem(
        contentId: number,
        playlistId: string,
        backdropUrl?: string
    ): Promise<void>;

    /**
     * Remove item from recently viewed
     */
    removeRecentItem(contentId: number, playlistId: string): Promise<void>;

    /**
     * Clear recently viewed for a playlist
     */
    clearRecentItems(playlistId: string): Promise<void>;

    // =========================================================================
    // Content Lookup
    // =========================================================================

    /**
     * Get content by xtream ID
     */
    getContentByXtreamId(
        xtreamId: number,
        playlistId: string,
        contentType?: 'live' | 'movie' | 'series'
    ): Promise<XtreamContentItem | null>;

    /**
     * Persist what a detail view learned about an already-known content item —
     * its backdrop, and the identity (TMDB id, release year, original title)
     * that lets the dashboard repeat this view's lookup instead of rebuilding
     * a weaker one from the display title. Never changes favorites or recent
     * ordering, and never overwrites a column that already has a value.
     */
    setContentMetadataIfMissing(
        contentId: number,
        playlistId: string,
        patch: ContentMetadataPatch
    ): Promise<void>;

    // =========================================================================
    // Playback Position Operations
    // =========================================================================

    /**
     * Save/update playback position for content
     */
    savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void>;

    /**
     * Get playback position for a specific content item
     */
    getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null>;

    /**
     * Get all episode positions for a series (for highlighting watched episodes)
     */
    getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]>;

    /**
     * Get recently watched items with positions (for "Continue Watching" section)
     */
    getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]>;

    /**
     * Get all playback positions for a playlist (for grid view)
     */
    getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]>;

    /**
     * Clear playback position (mark as unwatched)
     */
    clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void>;

    /**
     * Save/update many playback positions at once (season-level "mark as
     * watched"). Rejects when nothing was persisted.
     */
    savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void>;

    /**
     * Clear many playback positions at once (season-level "mark as
     * unwatched"). Rejects when nothing was cleared.
     */
    clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void>;

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    /**
     * Clear any in-memory session cache for a playlist.
     * Called when the store resets for a playlist switch so stale data
     * cannot bleed into the new session (relevant for the PWA implementation).
     */
    clearSessionCache(playlistId: string): void;

    /**
     * Clear all content and categories for a playlist (for refresh)
     * Returns user data (favorites, recently viewed) for restoration
     */
    clearPlaylistContent(
        playlistId: string
    ): Promise<XtreamPendingRestoreState>;

    /**
     * Restore user data after refresh
     */
    restoreUserData(
        playlistId: string,
        restoreState: XtreamPendingRestoreState,
        options?: XtreamOperationOptions
    ): Promise<void>;
}

/**
 * Injection token for the data source
 */
export const XTREAM_DATA_SOURCE = new InjectionToken<IXtreamDataSource>(
    'XtreamDataSource'
);
