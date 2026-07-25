import type { Playlist } from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import {
    fetchPlaylistFromFile,
    fetchPlaylistFromUrl,
    preserveAutoUpdatedPlaylistFields,
    type PlaylistFetchOptions,
} from './playlist-source';

/**
 * How many playlists the startup auto-update refreshes at the same time.
 * Refreshing sequentially let a single slow or unreachable host delay every
 * remaining playlist (issue #931), while an unbounded fan-out would download
 * and parse arbitrarily many large M3U files in the main process at once.
 */
export const AUTO_UPDATE_CONCURRENCY = 3;

/**
 * Refreshes a single playlist from its original source.
 * Returns `null` when the playlist carries neither a URL nor a file path.
 */
async function refreshPlaylist(
    playlist: Playlist,
    options: PlaylistFetchOptions
): Promise<Playlist | null> {
    let playlistObject: Playlist;

    if (playlist.importDate && playlist.url) {
        console.log(
            `Updating playlist "${playlist.title}" from URL: ${redactSensitiveData(playlist.url)}`
        );
        playlistObject = await fetchPlaylistFromUrl(
            playlist.url,
            playlist.title,
            options
        );
    } else if (playlist.filePath) {
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
        return null;
    }

    console.log(`Successfully updated playlist "${playlist.title}"`);
    return preserveAutoUpdatedPlaylistFields(playlistObject, playlist);
}

/**
 * Refreshes the given playlists with bounded concurrency, isolating every
 * failure so one broken source never withholds the playlists that did update.
 * The returned playlists keep the order of the requested ones.
 */
export async function autoUpdatePlaylists(
    playlists: readonly Playlist[],
    options: PlaylistFetchOptions = {}
): Promise<Playlist[]> {
    const results: (Playlist | null)[] = new Array(playlists.length).fill(null);
    let nextIndex = 0;

    const refreshNextPlaylist = async (): Promise<void> => {
        for (
            let index = nextIndex++;
            index < playlists.length;
            index = nextIndex++
        ) {
            const playlist = playlists[index];

            try {
                results[index] = await refreshPlaylist(playlist, options);
            } catch (error) {
                console.error(
                    `Failed to update playlist "${playlist.title}":`,
                    error
                );
            }
        }
    };

    await Promise.all(
        Array.from(
            { length: Math.min(AUTO_UPDATE_CONCURRENCY, playlists.length) },
            refreshNextPlaylist
        )
    );

    return results.filter(
        (playlist): playlist is Playlist => playlist !== null
    );
}
