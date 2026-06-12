import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    createPlaylistObject,
    getFilenameFromUrl,
} from '@iptvnator/shared/m3u-utils';
import { parse } from 'iptv-playlist-parser';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createPlaylistAgentFactory } from '../util/secure-https';
import { requestWithValidatedRedirects } from '../util/validated-axios';

export async function fetchPlaylistFromUrl(
    url: string,
    title?: string
): Promise<Playlist> {
    const result = await requestWithValidatedRedirects<string>(
        url,
        {
            agentFactory: createPlaylistAgentFactory(),
            method: 'GET',
        },
        { allowPrivateNetworks: true }
    );
    const parsedPlaylist = parse(result.data);
    const extractedName = url && url.length > 1 ? getFilenameFromUrl(url) : '';
    const playlistName =
        !extractedName || extractedName === 'Untitled playlist'
            ? 'Imported from URL'
            : extractedName;

    return createPlaylistObject(
        title ?? playlistName,
        parsedPlaylist,
        url,
        'URL'
    );
}

export async function fetchPlaylistFromFile(
    filePath: string,
    title: string
): Promise<Playlist> {
    const fileContent = await readFile(filePath, 'utf-8');
    return createPlaylistObject(title, parse(fileContent), filePath, 'FILE');
}

export function derivePlaylistTitleFromFilePath(filePath: string): string {
    const filename = basename(filePath);
    return filename.replace(/\.(m3u8?|pls|txt)$/i, '') || 'from file';
}

export function preserveAutoUpdatedPlaylistFields(
    playlistObject: Playlist,
    playlist: Playlist
): Playlist {
    return {
        ...playlistObject,
        _id: playlist._id,
        autoRefresh: playlist.autoRefresh,
        favorites: playlist.favorites || [],
        userAgent: playlist.userAgent,
    };
}
