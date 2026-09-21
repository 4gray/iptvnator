import {
    Channel,
    PlaylistMeta,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { extractDrmFromRaw } from '@iptvnator/shared/m3u-utils';
import { resolveExternalPlayerHttpHeaders } from '@iptvnator/m3u-state';

/**
 * Builds the playback payload for an M3U row.
 *
 * Extracted from the video player so the series detail can play an episode
 * through exactly the same path. Duplicating it was the alternative, and a
 * duplicated header/DRM resolution is one that eventually disagrees with
 * itself — the app already carries the scars of a rule that existed in three
 * places.
 */
export interface M3uPlaybackPayloadInput {
    /** The row whose name and artwork the player shows. */
    readonly channel: Channel;
    /** The row actually played — a catch-up URL may differ from the above. */
    readonly target: Channel & { readonly epgParams?: string };
    readonly playlistMeta: PlaylistMeta | null | undefined;
    readonly isLive: boolean;
}

export function buildM3uPlaybackPayload({
    channel,
    target,
    playlistMeta,
    isLive,
}: M3uPlaybackPayloadInput): ResolvedPortalPlayback {
    // Embedded MPV requests bypass the Electron webRequest override, so the
    // playlist-level custom headers must ride in the payload; channel
    // #EXTVLCOPT values still win.
    const effective = resolveExternalPlayerHttpHeaders(target, playlistMeta);
    const headers: Record<string, string> = {};
    if (effective['user-agent']) {
        headers['User-Agent'] = effective['user-agent'];
    }
    if (effective.referer) {
        headers['Referer'] = effective.referer;
    }
    if (effective.origin) {
        headers['Origin'] = effective.origin;
    }

    return {
        streamUrl: `${target.url}${target.epgParams ?? ''}`,
        title: channel.name?.trim() || channel.tvg?.name || target.url,
        thumbnail: channel.tvg?.logo ?? null,
        isLive,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        userAgent: effective['user-agent'],
        referer: effective.referer,
        origin: effective.origin,
        // Playlists imported before the DRM feature carry no drm field yet,
        // but their raw KODIPROP block survived in the stored items —
        // extract lazily so they work without a re-import.
        drm: target.drm ?? extractDrmFromRaw(target.raw),
    };
}
