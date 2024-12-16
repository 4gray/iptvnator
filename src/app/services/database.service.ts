import { Injectable } from '@angular/core';
import Database from '@tauri-apps/plugin-sql';

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
}
