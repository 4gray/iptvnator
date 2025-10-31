/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import axios from 'axios';
import { dialog, ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import { createPlaylistObject, getFilenameFromUrl } from 'm3u-utils';
import { readFile, writeFile } from 'node:fs/promises';
import { AUTO_UPDATE_PLAYLISTS } from 'shared-interfaces';

export default class PlaylistEvents {
    static bootstrapPlaylistEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

const https = require('https');

ipcMain.handle('fetch-playlist-by-url', async (event, url, title?: string) => {
    try {
        const agent = new https.Agent({
            rejectUnauthorized: false,
        });
        const result = await axios.get(url, { httpsAgent: agent });
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
    } catch (error) {
        console.error('Error fetching playlist:', error);
        throw error;
    }
});

ipcMain.handle(
    'update-playlist-from-file-path',
    async (event, filePath, title) => {
        const playlist = await readFile(filePath, 'utf-8');
        const parsedPlaylist = parse(playlist);
        const playlistObject = createPlaylistObject(
            title,
            parsedPlaylist,
            filePath,
            'FILE'
        );
        return playlistObject;
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
        const fileContent = await readFile(filePath, 'utf-8');

        const parsedPlaylist = parse(fileContent);
        const playlistObject = createPlaylistObject(
            'from file',
            parsedPlaylist,
            filePath,
            'FILE'
        );

        return playlistObject;
    } catch (error) {
        console.error('Error reading or parsing the file:', error);
        throw new Error('Failed to process the selected file.');
    }
});

ipcMain.handle(AUTO_UPDATE_PLAYLISTS, async (event, playlistUrls) => {
    // TODO: Implement auto-update logic
    for (const url of playlistUrls) {
        console.log(`Auto-updating playlist from ${url}`);
    }
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
