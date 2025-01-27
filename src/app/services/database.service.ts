import { Injectable } from '@angular/core';
import Database from '@tauri-apps/plugin-sql';
import { PlaylistMeta } from '../shared/playlist-meta.type';

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
    private static db: Database | null = null;

    async getConnection(): Promise<Database> {
        if (!DatabaseService.db) {
            DatabaseService.db = await Database.load('sqlite:database.db');
        }
        return DatabaseService.db;
    }

    /**
     * Delete a playlist and all its related data
     * @param playlistId ID of the playlist to delete
     * @returns True if deletion was successful
     */
    async deletePlaylist(playlistId: string): Promise<boolean> {
        try {
            const db = await this.getConnection();

            // Start a transaction to ensure all related data is deleted
            await db.execute('BEGIN TRANSACTION');

            try {
                // Delete from recently_viewed table (related to content which is related to playlist)
                await db.execute(
                    `
                    DELETE FROM recently_viewed 
                    WHERE content_id IN (
                        SELECT c.id 
                        FROM content c 
                        JOIN categories cat ON c.category_id = cat.id 
                        WHERE cat.playlist_id = ?
                    )
                `,
                    [playlistId]
                );

                // Delete content related to the playlist's categories
                await db.execute(
                    `
                    DELETE FROM content 
                    WHERE category_id IN (
                        SELECT id FROM categories WHERE playlist_id = ?
                    )
                `,
                    [playlistId]
                );

                // Delete categories related to the playlist
                await db.execute(
                    'DELETE FROM categories WHERE playlist_id = ?',
                    [playlistId]
                );

                // Finally, delete the playlist itself
                await db.execute('DELETE FROM playlists WHERE id = ?', [
                    playlistId,
                ]);

                // Commit the transaction
                await db.execute('COMMIT');
                return true;
            } catch (error) {
                // If any error occurs, rollback the transaction
                await db.execute('ROLLBACK');
                throw error;
            }
        } catch (error) {
            console.error('Error deleting playlist:', error);
            return false;
        }
    }

    async updateXtreamPlaylist(playlist: any): Promise<boolean> {
        try {
            const db = await this.getConnection();
            await db.execute('UPDATE playlists SET name = ? WHERE id = ?', [
                playlist.name,
                playlist.id,
            ]);
            return true;
        } catch (error) {
            console.error('Error updating playlist:', error);
            return false;
        }
    }

    async updateXtreamPlaylistDetails(playlist: {
        id: string;
        title: string;
        username?: string;
        password?: string;
        serverUrl?: string;
    }): Promise<boolean> {
        try {
            const db = await this.getConnection();
            const updateFields: string[] = ['name = ?'];
            const params: any[] = [playlist.title];

            if (playlist.username) {
                updateFields.push('username = ?');
                params.push(playlist.username);
            }
            if (playlist.password) {
                updateFields.push('password = ?');
                params.push(playlist.password);
            }
            if (playlist.serverUrl) {
                updateFields.push('serverUrl = ?');
                params.push(playlist.serverUrl);
            }

            params.push(playlist.id);

            console.log(params);

            const query = `UPDATE playlists SET ${updateFields.join(', ')} WHERE id = ?`;
            await db.execute(query, params);
            return true;
        } catch (error) {
            console.error('Error updating playlist details:', error);
            return false;
        }
    }

    async hasXtreamCategories(
        playlistId: string,
        type: 'live' | 'movies' | 'series'
    ): Promise<boolean> {
        const db = await this.getConnection();
        const result = await db.select<XCategoryFromDb[]>(
            'SELECT * FROM categories WHERE playlist_id = ? AND type = ?',
            [playlistId, type]
        );
        return result.length > 0;
    }

    async getXtreamCategories(
        playlistId: string,
        type: 'live' | 'movies' | 'series'
    ): Promise<XCategoryFromDb[]> {
        const db = await this.getConnection();
        return await db.select<XCategoryFromDb[]>(
            'SELECT * FROM categories WHERE playlist_id = ? AND type = ? ORDER BY name COLLATE NOCASE',
            [playlistId, type]
        );
    }

    async saveXtreamCategories(
        playlistId: string,
        categories: any[],
        type: 'live' | 'movies' | 'series'
    ): Promise<void> {
        const db = await this.getConnection();
        for (const category of categories) {
            await db.execute(
                'INSERT INTO categories (playlist_id, name, type, xtream_id) VALUES (?, ?, ?, ?)',
                [playlistId, category.category_name, type, category.category_id]
            );
        }
    }

    async hasXtreamContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<boolean> {
        const db = await this.getConnection();
        const result = await db.select(
            `SELECT c.* FROM content c 
             JOIN categories cat ON c.category_id = cat.id 
             WHERE cat.playlist_id = ? AND c.type = ?
             ORDER BY c.added`,
            [playlistId, type]
        );
        return (result as any[]).length > 0;
    }

    async getXtreamContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<XtreamContent[]> {
        const db = await this.getConnection();
        return await db.select(
            `SELECT 
                c.id, c.category_id, c.title, c.rating, 
                c.added, c.poster_url, c.xtream_id, c.type
            FROM content c 
            INNER JOIN categories cat ON c.category_id = cat.id 
            WHERE cat.playlist_id = ? AND c.type = ?
            ORDER BY c.added DESC`,
            [playlistId, type]
        );
    }

    async saveXtreamContent(
        playlistId: string,
        streams: any[],
        type: 'live' | 'movie' | 'series',
        onProgress?: (count: number) => void
    ): Promise<number> {
        const db = await this.getConnection();
        const dbType =
            type === 'series' ? 'series' : type === 'movie' ? 'movies' : 'live';

        const categories = await db.select<{ id: number; xtream_id: number }[]>(
            'SELECT id, xtream_id FROM categories WHERE playlist_id = ? AND type = ?',
            [playlistId, dbType]
        );

        const categoryMap = new Map(
            categories.map((c) => [parseInt(c.xtream_id.toString()), c.id])
        );

        const bulkInsertData = this.prepareBulkInsertData(
            streams,
            type,
            categoryMap
        );
        return await this.executeBulkInsert(db, bulkInsertData, onProgress);
    }

    async searchXtreamContent(
        playlistId: string,
        searchTerm: string,
        types: string[]
    ): Promise<XtreamContent[]> {
        const db = await this.getConnection();
        const placeholders = types.map(() => '?').join(',');
        return await db.select(
            `SELECT c.* FROM content c 
             JOIN categories cat ON c.category_id = cat.id 
             WHERE (c.title LIKE ?)
             AND cat.playlist_id = ?
             AND c.type IN (${placeholders})
             LIMIT 50`,
            [`%${searchTerm}%`, playlistId, ...types]
        );
    }

    async globalSearchContent(
        searchTerm: string,
        types: string[]
    ): Promise<GlobalSearchResult[]> {
        const db = await this.getConnection();
        const placeholders = types.map(() => '?').join(',');

        // Use a materialized subquery for better performance
        return await db.select(
            `
            WITH filtered_content AS (
                SELECT 
                    c.id,
                    c.category_id,
                    c.title,
                    c.rating,
                    c.added,
                    c.poster_url,
                    c.xtream_id,
                    c.type,
                    cat.playlist_id,
                    p.name as playlist_name
                FROM content c 
                INNER JOIN categories cat ON c.category_id = cat.id 
                INNER JOIN playlists p ON cat.playlist_id = p.id
                WHERE c.type IN (${placeholders})
            )
            SELECT * FROM filtered_content
            WHERE LOWER(title) LIKE LOWER(?)
            ORDER BY title
            LIMIT 50
        `,
            [...types, `%${searchTerm}%`]
        );
    }

    async getGlobalRecentlyViewed(): Promise<GlobalRecentItem[]> {
        try {
            console.log('Starting getGlobalRecentlyViewed query...');
            const db = await this.getConnection();
            console.log('Got database connection');

            // Check if table exists
            const tableCheck = await db.select(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='recently_viewed'
            `);
            console.log('Tables check:', tableCheck);

            const items = await db.select<GlobalRecentItem[]>(`
                SELECT 
                    c.id,
                    c.category_id,
                    c.title,
                    c.rating,
                    c.added,
                    c.poster_url,
                    c.xtream_id,
                    c.type,
                    cat.playlist_id,
                    p.name as playlist_name,
                    rv.viewed_at
                FROM recently_viewed rv
                INNER JOIN content c ON rv.content_id = c.id
                INNER JOIN categories cat ON c.category_id = cat.id
                INNER JOIN playlists p ON cat.playlist_id = p.id
                ORDER BY rv.viewed_at DESC
                LIMIT 100
            `);

            console.log('Query executed, items found:', items?.length);
            console.log('First few items:', items?.slice(0, 3));

            return items || [];
        } catch (error) {
            console.error('Detailed error in getGlobalRecentlyViewed:', error);
            throw error; // Let's throw the error to see it in the component
        }
    }

    async clearGlobalRecentlyViewed(): Promise<void> {
        try {
            const db = await this.getConnection();
            await db.execute('DELETE FROM recently_viewed');
        } catch (error) {
            console.error('Error clearing global recently viewed:', error);
            throw error;
        }
    }

    async getPlaylistById(playlistId: string): Promise<XtreamPlaylist | null> {
        const db = await this.getConnection();
        const results = await db.select<XtreamPlaylist[]>(
            'SELECT * FROM playlists WHERE id = ?',
            [playlistId]
        );
        return results[0] || null;
    }

    async createPlaylist(playlist: PlaylistMeta): Promise<void> {
        const db = await this.getConnection();
        await db.execute(
            'INSERT INTO playlists (id, name, serverUrl, username, password, type) VALUES (?, ?, ?, ?, ?, ?)',
            [
                playlist._id,
                playlist.title,
                playlist.serverUrl,
                playlist.username,
                playlist.password,
                'xtream',
            ]
        );
    }

    private prepareBulkInsertData(
        streams: any[],
        type: string,
        categoryMap: Map<number, number>
    ): any[] {
        return streams
            .map((stream) => {
                const streamCategoryId =
                    type === 'series'
                        ? parseInt(stream.category_id || '0')
                        : parseInt(stream.category_id);

                const categoryId = categoryMap.get(streamCategoryId);
                if (!categoryId) return null;

                const title =
                    type === 'series'
                        ? stream.title ||
                          stream.name ||
                          `Unknown Series ${stream.series_id}`
                        : stream.name ||
                          stream.title ||
                          `Unknown Stream ${stream.stream_id}`;

                return [
                    categoryId,
                    title,
                    stream.rating || stream.rating_imdb || '',
                    type === 'series'
                        ? stream.last_modified || ''
                        : stream.added || '',
                    stream.stream_icon || stream.poster || stream.cover || '',
                    type === 'series'
                        ? parseInt(stream.series_id || '0')
                        : parseInt(stream.stream_id || '0'),
                    type,
                ];
            })
            .filter((data) => data !== null);
    }

    private async executeBulkInsert(
        db: Database,
        data: any[],
        onProgress?: (count: number) => void
    ): Promise<number> {
        const CHUNK_SIZE = 100;
        let totalInserted = 0;

        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            const placeholders = chunk
                .map(() => '(?, ?, ?, ?, ?, ?, ?)')
                .join(', ');
            const query = `
                INSERT INTO content (
                    category_id, title, rating, added,
                    poster_url, xtream_id, type
                ) VALUES ${placeholders}
            `;

            try {
                await db.execute(query, chunk.flat());
                totalInserted += chunk.length;
                onProgress?.(totalInserted);
            } catch (err) {
                console.error('Error in bulk insert chunk:', err);
            }
        }

        return totalInserted;
    }
}
