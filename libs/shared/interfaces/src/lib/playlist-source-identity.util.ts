import type { Playlist } from './playlist.interface';

/** The provider account or URL a playlist reads from, if it has one. */
export function sourceIdentity(playlist: Playlist): string | null {
    if (playlist.serverUrl && playlist.username) {
        return [
            'xtream',
            normalizeSourceUrlIdentity(playlist.serverUrl),
            playlist.username.trim(),
        ].join('|');
    }
    const portalUrl = playlist.portalUrl ?? playlist.url;
    if (playlist.macAddress && portalUrl) {
        return [
            'stalker',
            normalizeSourceUrlIdentity(portalUrl),
            playlist.macAddress.trim().toLowerCase(),
        ].join('|');
    }
    return playlist.url
        ? `m3u|${normalizeSourceUrlIdentity(playlist.url)}`
        : null;
}

/** URL identity shared by source matching and backup restore. */
export function normalizeSourceUrlIdentity(value: string): string {
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
