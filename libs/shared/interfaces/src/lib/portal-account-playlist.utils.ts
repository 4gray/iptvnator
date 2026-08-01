import { PlaylistMeta } from './playlist-meta.type';

/**
 * A playlist backed by an Xtream Codes account — the only kind the Xtream
 * account-info dialog can query (`player_api.php` needs all three fields).
 */
export function isXtreamAccountPlaylist(
    playlist: PlaylistMeta
): playlist is PlaylistMeta & {
    serverUrl: string;
    username: string;
    password: string;
} {
    return Boolean(
        playlist.serverUrl && playlist.username && playlist.password
    );
}

/**
 * A playlist backed by a Stalker/Ministra portal. Portal URL + MAC address
 * are what every Stalker request is keyed on, so together they identify an
 * account the Stalker account-info dialog can describe.
 */
export function isStalkerAccountPlaylist(
    playlist: PlaylistMeta
): playlist is PlaylistMeta & {
    portalUrl: string;
    macAddress: string;
} {
    return Boolean(playlist.portalUrl && playlist.macAddress);
}

/**
 * Any playlist for which an account-info dialog exists.
 */
export function isPortalAccountPlaylist(playlist: PlaylistMeta): boolean {
    return (
        isXtreamAccountPlaylist(playlist) || isStalkerAccountPlaylist(playlist)
    );
}
