/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import axios from 'axios';
import { dialog, ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import { createPlaylistObject, getFilenameFromUrl } from 'm3u-utils';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { AUTO_UPDATE_PLAYLISTS } from 'shared-interfaces';

export default class PlaylistEvents {
    static bootstrapPlaylistEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

/**
 * Fetches and parses a playlist from a URL
 * @param url - The URL to fetch the playlist from
 * @param title - Optional title for the playlist
 * @returns Parsed playlist object
 */
async function fetchPlaylistFromUrl(
    url: string,
    title?: string
): Promise<any> {
    const result = await axios.get(url);
    const parsedPlaylist = parse(result.data);

    const extractedName =
        url && url.length > 1 ? getFilenameFromUrl(url) : '';
    const playlistName =
        !extractedName || extractedName === 'Untitled playlist'
            ? 'Imported from URL'
            : extractedName;

    const playlistObject = createPlaylistObject(
        title ?? playlistName,
        parsedPlaylist,
        url,
        'URL'
    );

    return playlistObject;
}

/**
 * Reads and parses a playlist from a file path
 * @param filePath - The path to the playlist file
 * @param title - Title for the playlist
 * @returns Parsed playlist object
 */
async function fetchPlaylistFromFile(
    filePath: string,
    title: string
): Promise<any> {
    const fileContent = await readFile(filePath, 'utf-8');
    const parsedPlaylist = parse(fileContent);
    const playlistObject = createPlaylistObject(
        title,
        parsedPlaylist,
        filePath,
        'FILE'
    );
    return playlistObject;
}

ipcMain.handle('fetch-playlist-by-url', async (event, url, title?: string) => {
    try {
        return await fetchPlaylistFromUrl(url, title);
    } catch (error) {
        console.error('Error fetching playlist:', error);
        throw error;
    }
});

ipcMain.handle(
    'update-playlist-from-file-path',
    async (event, filePath, title) => {
        try {
            return await fetchPlaylistFromFile(filePath, title);
        } catch (error) {
            console.error('Error reading playlist from file:', error);
            throw error;
        }
    }
);

ipcMain.handle('open-playlist-from-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'txt'] },
            { name: 'All Files', extensions: ['*'] },
        ],
    });

    if (canceled || filePaths.length === 0) {
        console.log('User canceled file open dialog.');
        return null;
    }

    const filePath = filePaths[0];

    try {
        // Extract filename from path and remove extension for a clean title
        const filename = basename(filePath);
        const title = filename.replace(/\.(m3u8?|pls|txt)$/i, '') || 'from file';

        return await fetchPlaylistFromFile(filePath, title);
    } catch (error) {
        console.error('Error reading or parsing the file:', error);
        throw new Error('Failed to process the selected file.');
    }
});

ipcMain.handle(AUTO_UPDATE_PLAYLISTS, async (event, playlists) => {
    console.log(`Auto-updating ${playlists.length} playlist(s)...`);

    const updatedPlaylists = [];

    for (const playlist of playlists) {
        try {
            let playlistObject;

            if (playlist.importDate && playlist.url) {
                // Update from URL
                console.log(
                    `Updating playlist "${playlist.title}" from URL: ${playlist.url}`
                );
                playlistObject = await fetchPlaylistFromUrl(
                    playlist.url,
                    playlist.title
                );
            } else if (playlist.filePath) {
                // Update from file path
                console.log(
                    `Updating playlist "${playlist.title}" from file: ${playlist.filePath}`
                );
                playlistObject = await fetchPlaylistFromFile(
                    playlist.filePath,
                    playlist.title
                );
            } else {
                console.warn(
                    `Skipping playlist "${playlist.title}": no URL or file path found`
                );
                continue;
            }

            // Preserve user data when updating playlist
            updatedPlaylists.push({
                ...playlistObject,
                _id: playlist._id,
                autoRefresh: playlist.autoRefresh,
                favorites: playlist.favorites || [], // Preserve favorites
                userAgent: playlist.userAgent, // Preserve custom user agent
            });

            console.log(`Successfully updated playlist "${playlist.title}"`);
        } catch (error) {
            console.error(
                `Failed to update playlist "${playlist.title}":`,
                error
            );
            // Continue with other playlists even if one fails
        }
    }

    console.log(`Auto-update completed: ${updatedPlaylists.length} updated`);
    return updatedPlaylists;
});

ipcMain.handle('save-file-dialog', async (event, defaultPath, filters) => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath,
            filters: filters || [
                { name: 'All Files', extensions: ['*'] },
            ],
        });

        if (canceled || !filePath) {
            return null;
        }

        return filePath;
    } catch (error) {
        console.error('Error showing save dialog:', error);
        throw error;
    }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
    try {
        await writeFile(filePath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        console.error('Error writing file:', error);
        throw error;
    }
});

**Changes made:**

1. **Removed `const https = require('https');`** (line 20) — the `https` module import is no longer needed.
2. **Removed the custom HTTPS agent** with `rejectUnauthorized: false` (lines 32-34) — this was disabling TLS certificate verification, which would allow man-in-the-middle attacks.
3. **Changed `axios.get(url, { httpsAgent: agent })` to `axios.get(url)`** — this lets axios use Node.js's default HTTPS behavior, which properly verifies TLS certificates.

By removing the custom agent, axios will now use the system's default certificate store and properly reject connections to servers with invalid, expired, or untrusted certificates.