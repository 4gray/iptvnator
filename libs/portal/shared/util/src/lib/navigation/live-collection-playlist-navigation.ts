import {
    buildXtreamNavigationTarget,
    WorkspaceNavigationTarget,
} from './workspace-portal-navigation';

/**
 * History-state key the M3U player consumes on arrival to select the channel
 * with this stream URL (`VideoPlayerComponent`, `all` view). Global search
 * writes the same key.
 */
export const OPEN_M3U_CHANNEL_URL_STATE_KEY = 'openM3uChannelUrl';

/**
 * The fields a live collection row needs to be located inside its owning
 * playlist. Both `UnifiedCollectionItem` and `UnifiedFavoriteChannel` satisfy
 * it, so the EPG-panel chip (resolved from the active item) and the row
 * context menu (resolved from the list row) share one verdict.
 */
export interface LiveCollectionPlaylistNavigationSource {
    sourceType: string;
    playlistId: string;
    /** Absent on `UnifiedFavoriteChannel`, whose rows are always live. */
    contentType?: string;
    name?: string;
    logo?: string | null;
    xtreamId?: number | null;
    streamUrl?: string;
}

/**
 * "Open in playlist" for a live channel shown outside its playlist (global
 * favorites/recent, a portal's own favorites/recent tabs).
 *
 * The target is the channel itself, not the playlist root: Xtream lands on
 * the live layout with `openXtreamLiveItemId`, which its auto-open state
 * service turns into a playing, selected channel; M3U lands on the player's
 * `all` view with `openM3uChannelUrl`, which selects the channel by URL.
 * Stalker returns `null` for now — its ITV layout has no open-on-arrival
 * contract yet, and a jump that only reached the section root would not be
 * the affordance this promises.
 *
 * Like `getUnifiedCollectionDetailNavigation`, this never degrades to a
 * playlist-only route: without a positive stream id (Xtream) or a stream URL
 * (M3U) the caller is expected to hide the action.
 */
export function getLiveCollectionPlaylistNavigation(
    source: LiveCollectionPlaylistNavigationSource
): WorkspaceNavigationTarget | null {
    if (source.contentType !== undefined && source.contentType !== 'live') {
        return null;
    }

    const playlistId = (source.playlistId ?? '').trim();
    if (!playlistId) {
        return null;
    }

    if (source.sourceType === 'xtream') {
        const streamId = Number(source.xtreamId);
        if (!Number.isFinite(streamId) || streamId <= 0) {
            return null;
        }

        return buildXtreamNavigationTarget({
            playlistId,
            type: 'live',
            itemId: streamId,
            title: source.name,
            imageUrl: source.logo ?? null,
        });
    }

    if (source.sourceType === 'm3u') {
        const streamUrl = (source.streamUrl ?? '').trim();
        if (!streamUrl) {
            return null;
        }

        return {
            link: ['/workspace', 'playlists', playlistId, 'all'],
            state: { [OPEN_M3U_CHANNEL_URL_STATE_KEY]: streamUrl },
        };
    }

    return null;
}
