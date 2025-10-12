/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import axios from 'axios';
import { dialog, ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import { createPlaylistObject, getFilenameFromUrl } from 'm3u-utils';
import { readFile } from 'node:fs/promises';

export default class PlaylistEvents {
    static bootstrapPlaylistEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

const https = require('https');

ipcMain.handle('fetch-playlist-by-url', async (event, url) => {
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
            playlistName,
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
    // 1. Await the result from the dialog
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

        console.log('Sending playlist object to renderer:', playlistObject);

        // 5. Return the final object. This value is sent back to Angular.
        return playlistObject;
    } catch (error) {
        console.error('Error reading or parsing the file:', error);
        // It's good practice to throw the error so the renderer can catch it
        throw new Error('Failed to process the selected file.');
    }
});
