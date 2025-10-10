/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import axios from 'axios';
import { ipcMain } from 'electron';
import { parse } from 'iptv-playlist-parser';
import { createPlaylistObject, getFilenameFromUrl } from 'm3u-utils';

export default class PlaylistEvents {
    static bootstrapPlaylistEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

const https = require('https');

// Retrieve app version
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
