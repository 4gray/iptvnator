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
     * Stalker: used as the fallback genre unless it is a section marker.
     * Favorites/recent rows written by the app carry the SECTION marker here
     * (`'itv'`), which is not a genre.
     */
    categoryId?: string | number | null;
    /** Stalker: the stored row; its `tv_genre_id` is the channel's real genre. */
    stalkerItem?: unknown;
    /** Stalker: the genre already resolved by `resolveStalkerLiveGenreId` (list rows). */
    stalkerGenreId?: string | null;
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
        // The stored row is the authority on the provider id: the collection
        // services mint a synthetic list-only id (`<playlist>-<index>`, or
        // `-` for a blank `id` beside a valid `stream_id`) for rows they
        // cannot identify, and the ITV catalog can never match those.
        const itemId =
            source.stalkerItem === undefined || source.stalkerItem === null
                ? source.stalkerId
                : resolveStalkerProviderId(source.stalkerItem);
        if (!itemId) {
            return null;
        }

        return buildStalkerLiveNavigationTarget({
            playlistId,
            itemId,
            categoryId: resolveStalkerLiveGenreId(source),
            title: source.name,
            imageUrl: source.logo ?? null,
        });
    }

    return null;
}

/**
 * The Stalker live row's genre for the auto-open fallback: an already
 * resolved value, else the stored row's `tv_genre_id` (genre ids are opaque
 * portal strings, numeric on most panels but not all), else `categoryId`
 * unless it is a section marker — app-written favorites/recent carry
 * `'itv'` there, which is not a genre.
 */
export function resolveStalkerLiveGenreId(
    source: Pick<
        LiveCollectionPlaylistNavigationSource,
        'stalkerGenreId' | 'stalkerItem' | 'categoryId'
    >
): string | null {
    return (
        stalkerGenreId(source.stalkerGenreId) ??
        stalkerItemGenre(source.stalkerItem) ??
        stalkerCategoryGenre(source.categoryId)
    );
}

const STALKER_SECTION_MARKERS = new Set(['itv', 'radio', 'vod', 'series']);

/**
 * The stored Stalker row's real provider id: the first NON-BLANK of
 * `id`/`stream_id`/`series_id`/`movie_id`, or `null` for an id-less row.
 * (Unlike the collection services' extractor, a blank `id` does not shadow
 * a valid `stream_id`.)
 */
export function resolveStalkerProviderId(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
        return null;
    }
    const raw = item as Record<string, unknown>;
    for (const key of ['id', 'stream_id', 'series_id', 'movie_id']) {
        const value = String(raw[key] ?? '').trim();
        if (value) {
            return value;
        }
    }
    return null;
}

/**
 * An authoritative stored row answers even without a genre: a genreless
 * channel lives in the All list, so `'*'` is its fallback (a portal without
 * a full list otherwise lands on the empty "select a category" screen).
 */
function stalkerItemGenre(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
        return null;
    }
    return (
        stalkerGenreId((item as { tv_genre_id?: unknown }).tv_genre_id) ?? '*'
    );
}

/** Any non-blank genre id, the All pseudo-genre included. */
function stalkerGenreId(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function stalkerCategoryGenre(value: unknown): string | null {
    const genre = stalkerGenreId(value);
    return genre && !STALKER_SECTION_MARKERS.has(genre.toLowerCase())
        ? genre
        : null;
}
