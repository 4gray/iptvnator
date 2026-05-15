import {
    Channel,
    ParsedPlaylist,
    ParsedPlaylistItem,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { v4 as uuidv4 } from 'uuid';

/**
 * Aggregates favorite channels as objects from all available playlists
 * @param playlists all available playlists
 * @returns an array with favorite channels from all playlists
 */
export function aggregateFavoriteChannels(playlists: Playlist[]): Channel[] {
    const favorites: Channel[] = [];

    for (const playlist of playlists) {
        const favoriteIds = new Set(
            (playlist.favorites ?? []).filter(
                (favorite): favorite is string => typeof favorite === 'string'
            )
        );

        if (favoriteIds.size === 0) {
            continue;
        }

        for (const channel of playlist.playlist?.items ?? []) {
            if (favoriteIds.has(channel.id) || favoriteIds.has(channel.url)) {
                favorites.push(channel);
            }
        }
    }

    return favorites;
}

/**
 * Creates a simplified playlist object which is used for global favorites
 * @param channels channels list
 * @returns simplified playlist object
 */
export function createFavoritesPlaylist(
    channels: Channel[]
): Partial<Playlist> {
    return {
        _id: 'global-favorites',
        count: channels.length,
        playlist: {
            items: channels,
        },
        favorites: channels.map((channel) => channel.url),
        filename: 'Global favorites',
    };
}

/**
 * Returns last segment (part after last slash "/") of the given URL
 * @param value URL as string
 */
export const getFilenameFromUrl = (value: string): string => {
    if (value && value.length > 1) {
        return value.substring(value.lastIndexOf('/') + 1);
    }
    return 'Untitled playlist';
};

/**
 * Creates a playlist object
 * @param name name of the playlist
 * @param playlist playlist to save
 * @param urlOrPath absolute fs path or url of the playlist
 * @param uploadType upload type - by file or via an url
 */
export const createPlaylistObject = (
    name: string,
    playlist: ParsedPlaylist,
    urlOrPath?: string,
    uploadType?: 'URL' | 'FILE' | 'TEXT'
): Playlist => {
    return {
        _id: uuidv4(),
        filename: name,
        title: name,
        count: playlist.items.length,
        playlist: {
            ...playlist,
            items: playlist.items.map((item: ParsedPlaylistItem) => ({
                ...item,
                id: uuidv4(),
            })),
        },
        importDate: new Date().toISOString(),
        lastUsage: new Date().toISOString(),
        favorites: [],
        autoRefresh: false,
        ...(uploadType === 'URL' ? { url: urlOrPath } : {}),
        ...(uploadType === 'FILE' ? { filePath: urlOrPath } : {}),
    };
};

/**
 * Extract the file extension from a URL, ignoring query strings and fragments.
 *
 * Returns `undefined` when no real extension is found — e.g. for IPTV proxy
 * URLs like `https://proxy.example.com/ace/getstream?infohash=abc` where the
 * path segment has no dot-separated extension.
 */
export const getExtensionFromUrl = (url: string): string | undefined => {
    const path = url.split(/[#?]/)[0];
    const lastSegment = path.split('/').pop() || '';
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex < 1) return undefined;
    const ext = lastSegment.slice(dotIndex + 1).trim();
    return ext || undefined;
};

export const getStreamExtensionFromUrl = (url: string): string | undefined => {
    return getExtensionFromUrlQuery(url) ?? getExtensionFromUrl(url);
};

const getExtensionFromUrlQuery = (url: string): string | undefined => {
    try {
        const parsedUrl = new URL(url, 'http://iptvnator.local');
        return normalizeExtensionToken(parsedUrl.searchParams.get('extension'));
    } catch {
        return undefined;
    }
};

const normalizeExtensionToken = (
    value: string | null | undefined
): string | undefined => {
    const extension = value?.trim().replace(/^\.+/, '').toLowerCase();
    return extension || undefined;
};
