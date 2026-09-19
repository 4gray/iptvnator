import {
    buildStalkerLiveNavigationTarget,
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
    /** Stalker channel id (`UnifiedCollectionItem.stalkerId`). */
    stalkerId?: string | number | null;
    /**
     * Stalker: used as the fallback genre only when it is a numeric genre id.
     * Favorites/recent rows written by the app carry the SECTION marker here
     * (`'itv'`), which is not a genre.
     */
    categoryId?: string | number | null;
    /** Stalker: the stored row; its `tv_genre_id` is the channel's real genre. */
    stalkerItem?: unknown;
    /** `'true'` for radio stations, which live in a different Stalker section. */
    radio?: string;
}

/**
 * "Open in playlist" for a live channel shown outside its playlist (global
 * favorites/recent, a portal's own favorites/recent tabs).
 *
 * The target is the channel itself, not the playlist root: Xtream lands on
 * the live layout with `openXtreamLiveItemId`, which its auto-open state
 * service turns into a playing, selected channel; M3U lands on the player's
 * `all` view with `openM3uChannelUrl`, which selects the channel by URL;
 * Stalker lands on the ITV section with `openStalkerLiveItemId`, which
 * `StalkerLiveAutoOpen` resolves through the full channel list cache. Stalker
 * radio stations return `null`: they live in the separate `radio` section,
 * whose station list is legacy-paged and has no open-on-arrival contract.
 *
 * Like `getUnifiedCollectionDetailNavigation`, this never degrades to a
 * playlist-only route: without a positive stream id (Xtream), a stream URL
 * (M3U) or a channel id (Stalker) the caller is expected to hide the action.
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

    if (source.sourceType === 'stalker') {
        if (source.radio === 'true') {
            return null;
        }

        return buildStalkerLiveNavigationTarget({
            playlistId,
            itemId: source.stalkerId,
            categoryId:
                stalkerItemGenre(source.stalkerItem) ??
                stalkerGenreId(source.categoryId),
            title: source.name,
            imageUrl: source.logo ?? null,
        });
    }

    return null;
}

function stalkerItemGenre(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
        return null;
    }
    return stalkerGenreId((item as { tv_genre_id?: unknown }).tv_genre_id);
}

/** Stalker ITV genres are numeric ids; anything else (`'itv'`, `'*'`) is not a genre. */
function stalkerGenreId(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? text : null;
}
