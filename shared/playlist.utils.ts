import { Channel } from './channel.interface';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from './constants';
import { Playlist } from './playlist.interface';

/**
 * Aggregates favorite channels as objects from all available playlists
 * @param playlists all available playlists
 * @returns an array with favorite channels from all playlists
 */
export function aggregateFavoriteChannels(playlists: Playlist[]): Channel[] {
    const favorites = [];
    playlists.forEach((playlist) => {
        if (playlist.favorites?.length > 0) {
            playlist.playlist.items.forEach((channel) => {
                if (
                    playlist.favorites.includes(channel.id) ||
                    playlist.favorites.includes(channel.url)
                ) {
                    favorites.push(channel);
                }
            });
        }
    });
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
        id: GLOBAL_FAVORITES_PLAYLIST_ID,
        _id: GLOBAL_FAVORITES_PLAYLIST_ID,
        count: channels.length,
        playlist: {
            items: channels,
        },
        filename: 'Global favorites',
    };
}

export const getUUID = () =>
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    (String(1e7) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (
            Number(c) ^
            (crypto.getRandomValues(new Uint8Array(1))[0] &
                (15 >> (Number(c) / 4)))
        ).toString(16)
    );
