import type { PlaylistMeta } from './playlist-meta.type';

/**
 * One Material icon ligature per source type, used everywhere a source is
 * shown: the add dialog, provider auto-detection, the Sources list and its
 * filters, the playlist switcher, dashboard cards, the command palette and
 * the reset summaries. A provider must look the same on every screen, and no
 * icon may stand for two providers.
 *
 * `m3u` is the provider family (filters and summaries that count every M3U
 * source); the other M3U keys name how a single playlist was added. Stored
 * playlists cannot tell a local file from pasted text, so both render as
 * `m3u-local`; only the add dialog and auto-detection show `m3u-text`.
 */
export const SOURCE_TYPE_ICONS = {
    m3u: 'playlist_play',
    'm3u-url': 'link',
    'm3u-local': 'description',
    'm3u-text': 'subject',
    xtream: 'cloud',
    stalker: 'cast',
} as const;

export type SourceTypeIconKey = keyof typeof SOURCE_TYPE_ICONS;

export type PlaylistSourceIconKey = Extract<
    SourceTypeIconKey,
    'm3u-url' | 'm3u-local' | 'xtream' | 'stalker'
>;

export function resolvePlaylistSourceIconKey(
    playlist: Pick<PlaylistMeta, 'macAddress' | 'serverUrl' | 'url'>
): PlaylistSourceIconKey {
    if (playlist.macAddress) {
        return 'stalker';
    }
    if (playlist.serverUrl) {
        return 'xtream';
    }
    if (playlist.url) {
        return 'm3u-url';
    }
    return 'm3u-local';
}

export function getPlaylistSourceIcon(
    playlist: Pick<PlaylistMeta, 'macAddress' | 'serverUrl' | 'url'>
): string {
    return SOURCE_TYPE_ICONS[resolvePlaylistSourceIconKey(playlist)];
}
