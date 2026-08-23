import {
    PlaylistMeta,
    PlaybackPositionData,
    PortalActivityType,
    PortalAddedItem,
    PortalFavoriteItem,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    buildStalkerDetailNavigationTarget,
    buildStalkerStateItem,
    buildXtreamNavigationTarget,
    getGlobalFavoriteNavigation,
    getRecentItemNavigation,
    isPortalPlaybackWatched,
    WorkspaceNavigationTarget,
    type SeriesResumeTarget,
} from '@iptvnator/portal/shared/util';

/**
 * Pure navigation/link helpers for dashboard items.
 *
 * Extracted from `DashboardDataService` so the routing logic can be unit-tested
 * in isolation and the service stays a thin facade. None of these functions
 * touch component/service state — they map a dashboard item to a router link
 * (and optional navigation state) using the shared portal navigation builders.
 */

export type DashboardContentKind = 'all' | 'channels' | 'vod' | 'series';

export function isTypeInKind(
    type: PortalActivityType,
    kind: DashboardContentKind
): boolean {
    if (kind === 'all') {
        return true;
    }
    if (kind === 'channels') {
        return type === 'live';
    }
    if (kind === 'vod') {
        return type === 'movie';
    }
    return type === 'series';
}

export function getPlaylistLink(playlist: PlaylistMeta): string[] {
    if (playlist.serverUrl) {
        return ['/workspace', 'xtreams', playlist._id, 'vod'];
    }

    if (playlist.macAddress) {
        return ['/workspace', 'stalker', playlist._id, 'vod'];
    }

    return ['/workspace', 'playlists', playlist._id];
}

export function getRecentItemLink(item: PortalRecentItem): string[] {
    return getRecentItemNavigation(item).link;
}

export function getRecentItemNavigationState(
    item: PortalRecentItem,
    playbackPosition?: PlaybackPositionData | null
): WorkspaceNavigationTarget['state'] {
    return getRecentItemNavigation(
        item,
        buildRecentSeriesResumeTarget(item, playbackPosition)
    ).state;
}

/**
 * Detail-only navigation state: never carries a series resume target, so the
 * handoff opens the detail page without auto-playing. Used by the Continue
 * Watching cards' default click (movie-like behavior, issue #1441); the hero
 * CTA and the cards' explicit Resume action keep the resume handoff. The
 * position still matters here: a legacy episode-keyed recent row needs its
 * identity rewritten to the parent series the position names, or the detail
 * would target the episode id.
 */
export function getRecentItemDetailNavigationState(
    item: PortalRecentItem,
    playbackPosition?: PlaybackPositionData | null
): WorkspaceNavigationTarget['state'] {
    return getRecentItemNavigation(
        item,
        buildRecentSeriesIdentityTarget(item, playbackPosition),
        { resumeIdentityOnly: true }
    ).state;
}

/**
 * Full navigation target carrying the one-shot resume handoff, or null when
 * the item/position cannot produce one (non-Xtream, non-series, watched or
 * coordinate-less rows). Powers the card's explicit "Resume episode" action.
 */
export function getRecentItemResumeNavigation(
    item: PortalRecentItem,
    playbackPosition?: PlaybackPositionData | null
): WorkspaceNavigationTarget | null {
    const resumeTarget = buildRecentSeriesResumeTarget(item, playbackPosition);
    return resumeTarget ? getRecentItemNavigation(item, resumeTarget) : null;
}

export function buildRecentSeriesResumeTarget(
    item: PortalRecentItem,
    playbackPosition?: PlaybackPositionData | null
): SeriesResumeTarget | null {
    // A watched row is a completion marker (natural finish or a manual/bulk
    // "mark watched"), not resumable progress — auto-playing it would start
    // the episode at its end. Detail-only handoff lets the series page's
    // quick-start pick the first unwatched episode instead.
    if (isPortalPlaybackWatched(playbackPosition)) {
        return null;
    }

    return buildRecentSeriesIdentityTarget(item, playbackPosition);
}

/**
 * Series coordinates named by an episode position, without the watched
 * guard: even a finished episode still identifies its parent series, which
 * the detail-only click needs for the episode-keyed-row identity rewrite.
 */
function buildRecentSeriesIdentityTarget(
    item: PortalRecentItem,
    playbackPosition?: PlaybackPositionData | null
): SeriesResumeTarget | null {
    if (
        item.type !== 'series' ||
        item.source !== 'xtream' ||
        playbackPosition?.contentType !== 'episode'
    ) {
        return null;
    }

    // Episode-keyed recent rows make item.xtream_id an episode id, so only a
    // position row that names its parent series can produce a resume target;
    // legacy rows without seriesXtreamId stay detail-only.
    const seriesXtreamId = Number(playbackPosition.seriesXtreamId);
    const contentXtreamId = Number(playbackPosition.contentXtreamId);
    const seasonNumber = Number(playbackPosition.seasonNumber);
    const episodeNumber = Number(playbackPosition.episodeNumber);

    if (
        !Number.isInteger(seriesXtreamId) ||
        seriesXtreamId <= 0 ||
        !Number.isInteger(contentXtreamId) ||
        contentXtreamId <= 0 ||
        !Number.isInteger(seasonNumber) ||
        seasonNumber < 0 ||
        !Number.isInteger(episodeNumber) ||
        episodeNumber < 0
    ) {
        return null;
    }

    return {
        seriesXtreamId,
        contentXtreamId,
        seasonNumber,
        episodeNumber,
    };
}

export function getGlobalFavoriteLink(item: PortalFavoriteItem): string[] {
    return getGlobalFavoriteNavigation(item).link;
}

export function getGlobalFavoriteNavigationState(
    item: PortalFavoriteItem
): WorkspaceNavigationTarget['state'] {
    return getGlobalFavoriteNavigation(item).state;
}

export function getRecentlyAddedLink(item: PortalAddedItem): string[] {
    if (item.source === 'stalker' && item.type !== 'live') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlist_id,
            type: item.type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(item.stalker_item, {
                id: item.id,
                title: item.title,
                type: item.type,
                category_id: item.category_id,
                poster_url: item.poster_url,
            }),
        }).link;
    }

    return buildXtreamNavigationTarget({
        playlistId: item.playlist_id,
        type: item.type,
        categoryId: item.category_id,
        itemId: item.xtream_id,
        title: item.title,
        imageUrl: item.poster_url,
    }).link;
}

export function getRecentlyAddedNavigationState(
    item: PortalAddedItem
): WorkspaceNavigationTarget['state'] {
    if (item.source === 'stalker' && item.type !== 'live') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlist_id,
            type: item.type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(item.stalker_item, {
                id: item.id,
                title: item.title,
                type: item.type,
                category_id: item.category_id,
                poster_url: item.poster_url,
            }),
        }).state;
    }

    return buildXtreamNavigationTarget({
        playlistId: item.playlist_id,
        type: item.type,
        categoryId: item.category_id,
        itemId: item.xtream_id,
        title: item.title,
        imageUrl: item.poster_url,
    }).state;
}
