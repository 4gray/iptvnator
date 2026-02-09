import { InjectionToken } from '@angular/core';
import {
    PlaybackPositionData,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';

// Re-export for backward compatibility
export { PlaybackPositionData };
import { XtreamCredentials, CategoryType, StreamType } from '../services/xtream-api.service';

/**
 * Playlist representation in the data source
 */
export interface XtreamPlaylistData {
    id: string;
    name: string;
    title?: string; // Alias for name, used in some templates
    serverUrl: string;
    username: string;
    password: string;
    type: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
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
    xtream_id: number;
    type: string;
    added_at?: string;
    viewed_at?: string;

    // XtreamItem compatibility fields (optional for search/navigation)
    num?: number;
    name?: string;
    stream_type?: 'live' | 'movie';
    stream_id?: number;
    stream_icon?: string;
    custom_sid?: string;
    direct_source?: string;
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
export function mapStreamTypeToDbType(type: StreamType): 'live' | 'movie' | 'series' {
    return type;
}

/**
 * Progress callback for bulk operations
 */
export type ProgressCallback = (count: number) => void;

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
     * Delete a playlist and all its data
     */
    deletePlaylist(playlistId: string): Promise<void>;

    // =========================================================================
    // Category Operations
    // =========================================================================

    /**
     * Check if categories exist for a playlist and type
     */
    hasCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<boolean>;

    /**
     * Get categories for a playlist and type
     * Returns only visible categories by default
     */
    getCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType
    ): Promise<XtreamCategory[] | XtreamCategoryFromDb[]>;

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
        onTotal?: (total: number) => void
    ): Promise<XtreamLiveStream[] | XtreamVodStream[] | XtreamSerieItem[] | XtreamContentItem[]>;

    /**
     * Save content in bulk
     */
    saveContent(
        playlistId: string,
        streams: any[],
        type: 'live' | 'movie' | 'series',
        onProgress?: ProgressCallback
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
     * Add content to favorites
     */
    addFavorite(contentId: number, playlistId: string): Promise<void>;

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
     * Add item to recently viewed
     */
    addRecentItem(contentId: number, playlistId: string): Promise<void>;

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
        playlistId: string
    ): Promise<XtreamContentItem | null>;

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
    getAllPlaybackPositions(playlistId: string): Promise<PlaybackPositionData[]>;

    /**
     * Clear playback position (mark as unwatched)
     */
    clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void>;

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    /**
     * Clear all content and categories for a playlist (for refresh)
     * Returns user data (favorites, recently viewed) for restoration
     */
    clearPlaylistContent(playlistId: string): Promise<{
        favoritedXtreamIds: number[];
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[];
    }>;

    /**
     * Restore user data after refresh
     */
    restoreUserData(
        playlistId: string,
        favoritedXtreamIds: number[],
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[]
    ): Promise<void>;
}

/**
 * Injection token for the data source
 */
export const XTREAM_DATA_SOURCE = new InjectionToken<IXtreamDataSource>(
    'XtreamDataSource'
);
