/**
 * Database service for Electron renderer process
 * Communicates with the main process database via IPC
 */

import { Injectable } from '@angular/core';
import { PlaylistMeta } from 'shared-interfaces';

export interface XCategoryFromDb {
    id: number;
    name: string;
    playlist_id: string;
    type: 'movies' | 'live' | 'series';
    xtream_id: number;
}

export interface XtreamContent {
    id: number;
    category_id: number;
    title: string;
    rating: string;
    added: string;
    poster_url: string;
    xtream_id: number;
    type: string;
    added_at?: string;
    viewed_at?: string;
}

export interface XtreamPlaylist {
    id: string;
    name: string;
    serverUrl: string;
    username: string;
    password: string;
    type: string;
}

export interface GlobalSearchResult extends XtreamContent {
    playlist_id: string;
    playlist_name: string;
}

export interface GlobalRecentItem extends XtreamContent {
    playlist_id: string;
    playlist_name: string;
    viewed_at: string;
}

@Injectable({
    providedIn: 'root',
})
export class DatabaseService {
    /**
     * Delete a playlist and all its related data
     */
    async deletePlaylist(playlistId: string): Promise<boolean> {
        try {
            await window.electron.dbDeletePlaylist(playlistId);
            return true;
        } catch (error) {
            console.error('Error deleting playlist:', error);
            return false;
        }
    }

    /**
     * Delete all content and categories for an Xtream playlist (for refresh)
     * Keeps the playlist entry but removes all imported data
     */
    async deleteXtreamPlaylistContent(playlistId: string): Promise<void> {
        await window.electron.dbDeleteXtreamContent(playlistId);
    }

    /**
     * Update playlist basic info
     */
    async updateXtreamPlaylist(playlist: any): Promise<boolean> {
        try {
            await window.electron.dbUpdatePlaylist(playlist.id, {
                name: playlist.name,
            });
            return true;
        } catch (error) {
            console.error('Error updating playlist:', error);
            return false;
        }
    }

    /**
     * Update playlist details including credentials
     */
    async updateXtreamPlaylistDetails(playlist: {
        id: string;
        title: string;
        username?: string;
        password?: string;
        serverUrl?: string;
    }): Promise<boolean> {
        try {
            await window.electron.dbUpdatePlaylist(playlist.id, {
                name: playlist.title,
                username: playlist.username,
                password: playlist.password,
                serverUrl: playlist.serverUrl,
            });
            return true;
        } catch (error) {
            console.error('Error updating playlist details:', error);
            return false;
        }
    }

    /**
     * Check if categories exist
     */
    async hasXtreamCategories(
        playlistId: string,
        type: 'live' | 'movies' | 'series'
    ): Promise<boolean> {
        return await window.electron.dbHasCategories(playlistId, type);
    }

    /**
     * Get categories for a playlist
     */
    async getXtreamCategories(
        playlistId: string,
        type: 'live' | 'movies' | 'series'
    ): Promise<XCategoryFromDb[]> {
        return await window.electron.dbGetCategories(playlistId, type);
    }

    /**
     * Save categories in bulk
     */
    async saveXtreamCategories(
        playlistId: string,
        categories: any[],
        type: 'live' | 'movies' | 'series'
    ): Promise<void> {
        await window.electron.dbSaveCategories(playlistId, categories, type);
    }

    /**
     * Check if content exists
     */
    async hasXtreamContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<boolean> {
        return await window.electron.dbHasContent(playlistId, type);
    }

    /**
     * Get content for a playlist
     */
    async getXtreamContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<XtreamContent[]> {
        return await window.electron.dbGetContent(playlistId, type);
    }

    /**
     * Save content in bulk
     */
    async saveXtreamContent(
        playlistId: string,
        streams: any[],
        type: 'live' | 'movie' | 'series',
        onProgress?: (count: number) => void
    ): Promise<number> {
        // Setup progress listener if callback provided
        if (onProgress) {
            window.addEventListener('message', (event) => {
                if (event.data.type === 'DB_SAVE_CONTENT_PROGRESS') {
                    onProgress(event.data.count);
                }
            });
        }

        const result = await window.electron.dbSaveContent(
            playlistId,
            streams,
            type
        );
        return result.count;
    }

    /**
     * Search content within a playlist
     */
    async searchXtreamContent(
        playlistId: string,
        searchTerm: string,
        types: string[]
    ): Promise<XtreamContent[]> {
        return await window.electron.dbSearchContent(
            playlistId,
            searchTerm,
            types
        );
    }

    /**
     * Global search across all playlists
     */
    async globalSearchContent(
        searchTerm: string,
        types: string[]
    ): Promise<GlobalSearchResult[]> {
        return await window.electron.dbGlobalSearch(searchTerm, types);
    }

    /**
     * Get recently viewed items
     */
    async getGlobalRecentlyViewed(): Promise<GlobalRecentItem[]> {
        try {
            const items = await window.electron.dbGetRecentlyViewed();
            return items || [];
        } catch (error) {
            console.error('Error getting recently viewed:', error);
            return [];
        }
    }

    /**
     * Clear recently viewed items
     */
    async clearGlobalRecentlyViewed(): Promise<void> {
        try {
            await window.electron.dbClearRecentlyViewed();
        } catch (error) {
            console.error('Error clearing recently viewed:', error);
            throw error;
        }
    }

    /**
     * Get playlist by ID
     */
    async getPlaylistById(playlistId: string): Promise<XtreamPlaylist | null> {
        return await window.electron.dbGetPlaylist(playlistId);
    }

    /**
     * Create a new playlist
     */
    async createPlaylist(playlist: PlaylistMeta): Promise<void> {
        await window.electron.dbCreatePlaylist({
            id: playlist._id,
            name: playlist.title,
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            type: 'xtream',
        });
    }

    /**
     * Add content to favorites
     */
    async addToFavorites(
        contentId: number,
        playlistId: string
    ): Promise<boolean> {
        try {
            await window.electron.dbAddFavorite(contentId, playlistId);
            return true;
        } catch (error) {
            console.error('Error adding to favorites:', error);
            return false;
        }
    }

    /**
     * Remove content from favorites
     */
    async removeFromFavorites(
        contentId: number,
        playlistId: string
    ): Promise<boolean> {
        try {
            await window.electron.dbRemoveFavorite(contentId, playlistId);
            return true;
        } catch (error) {
            console.error('Error removing from favorites:', error);
            return false;
        }
    }

    /**
     * Check if content is favorited
     */
    async isFavorite(contentId: number, playlistId: string): Promise<boolean> {
        try {
            return await window.electron.dbIsFavorite(contentId, playlistId);
        } catch (error) {
            console.error('Error checking favorite:', error);
            return false;
        }
    }

    /**
     * Get all favorites for a playlist
     */
    async getFavorites(playlistId: string): Promise<XtreamContent[]> {
        try {
            return await window.electron.dbGetFavorites(playlistId);
        } catch (error) {
            console.error('Error getting favorites:', error);
            return [];
        }
    }

    /**
     * Get recently viewed items for a specific playlist
     */
    async getRecentItems(playlistId: string): Promise<XtreamContent[]> {
        try {
            return await window.electron.dbGetRecentItems(playlistId);
        } catch (error) {
            console.error('Error getting recent items:', error);
            return [];
        }
    }

    /**
     * Add item to recently viewed
     */
    async addRecentItem(
        contentId: number,
        playlistId: string
    ): Promise<boolean> {
        try {
            await window.electron.dbAddRecentItem(contentId, playlistId);
            return true;
        } catch (error) {
            console.error('Error adding recent item:', error);
            return false;
        }
    }

    /**
     * Clear recently viewed for a specific playlist
     */
    async clearPlaylistRecentItems(playlistId: string): Promise<boolean> {
        try {
            await window.electron.dbClearPlaylistRecentItems(playlistId);
            return true;
        } catch (error) {
            console.error('Error clearing playlist recent items:', error);
            return false;
        }
    }

    /**
     * Remove specific item from recently viewed
     */
    async removeRecentItem(
        contentId: number,
        playlistId: string
    ): Promise<boolean> {
        try {
            await window.electron.dbRemoveRecentItem(contentId, playlistId);
            return true;
        } catch (error) {
            console.error('Error removing recent item:', error);
            return false;
        }
    }

    /**
     * Get content by xtream ID
     */
    async getContentByXtreamId(
        xtreamId: number,
        playlistId: string
    ): Promise<XtreamContent | null> {
        try {
            return await window.electron.dbGetContentByXtreamId(
                xtreamId,
                playlistId
            );
        } catch (error) {
            console.error('Error getting content by xtream ID:', error);
            return null;
        }
    }
}
