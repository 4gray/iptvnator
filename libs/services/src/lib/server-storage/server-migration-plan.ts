import type { Playlist } from '@iptvnator/shared/interfaces';

/** Where one browser playlist goes on the server. */
export type ServerMigrationStep =
    | {
          readonly kind: 'upload';
          readonly playlist: Playlist;
      }
    | {
          /** The server already has this source; it keeps its document. */
          readonly kind: 'merge';
          readonly browserId: string;
          readonly serverId: string;
      };

/**
 * Matches browser playlists to the server's: the same id first (a playlist
 * moved before), then the same source (Xtream server and user, Stalker
 * portal and MAC, M3U URL). A file or pasted M3U has no source to compare
 * and is uploaded unless its id is taken. Browser duplicates of one source
 * collapse onto the first.
 */
export function planServerMigration(
    browser: readonly Playlist[],
    server: readonly Playlist[]
): ServerMigrationStep[] {
    const serverIds = new Set(server.map((playlist) => playlist._id));
    const bySource = new Map<string, string>();
    for (const playlist of server) {
        const source = sourceIdentity(playlist);
        if (source && !bySource.has(source)) {
            bySource.set(source, playlist._id);
        }
    }

    const steps: ServerMigrationStep[] = [];
    for (const playlist of browser) {
        const source = sourceIdentity(playlist);
        const match = serverIds.has(playlist._id)
            ? playlist._id
            : source
              ? bySource.get(source)
              : undefined;
        if (match) {
            steps.push({
                kind: 'merge',
                browserId: playlist._id,
                serverId: match,
            });
            continue;
        }
        steps.push({ kind: 'upload', playlist });
        serverIds.add(playlist._id);
        if (source) {
            bySource.set(source, playlist._id);
        }
    }
    return steps;
}

/** The provider account or URL a playlist reads from, if it has one. */
export function sourceIdentity(playlist: Playlist): string | null {
    if (playlist.serverUrl && playlist.username) {
        return [
            'xtream',
            normalizeUrl(playlist.serverUrl),
            playlist.username.trim(),
        ].join('|');
    }
    const portalUrl = playlist.portalUrl ?? playlist.url;
    if (playlist.macAddress && portalUrl) {
        return [
            'stalker',
            normalizeUrl(portalUrl),
            playlist.macAddress.trim().toLowerCase(),
        ].join('|');
    }
    return playlist.url ? `m3u|${normalizeUrl(playlist.url)}` : null;
}

/** Same rules as the backup import's fingerprints. */
function normalizeUrl(value: string): string {
    const trimmed = value.trim();
    try {
        const url = new URL(trimmed);
        const pathname =
            url.pathname === '/'
                ? '/'
                : url.pathname.replace(/\/+$/, '') || '/';
        return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}${url.search}${url.hash}`;
    } catch {
        return trimmed.toLowerCase();
    }
}
