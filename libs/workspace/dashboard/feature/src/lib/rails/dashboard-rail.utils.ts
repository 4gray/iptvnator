import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    buildCollectionViewState,
    COLLECTION_VIEW_STATE_KEY,
    CollectionContentType,
} from '@iptvnator/portal/shared/util';
import type {
    DashboardRailAction,
    DashboardRailCard,
} from './dashboard-rail.component';
import type { DashboardRailsSettings } from '@iptvnator/shared/interfaces';

// Cap dashboard rails at 20 items. Users get ~3x what's visible at once,
// the DOM stays cheap, and the "Manage all" link is one click away for the
// full list. Matches the single-rail density of Netflix / Apple TV+.
export const RAIL_ITEM_LIMIT = 20;

// Six placeholder slots per skeleton rail fills a typical viewport without
// taking the whole page. Mirrors the recently-added skeleton density.
export const SKELETON_CARDS_PER_RAIL = [1, 2, 3, 4, 5, 6] as const;
export const SKELETON_RAILS = [1, 2, 3] as const;

export type DashboardSourceActionId =
    | 'refresh'
    | 'playlist-info'
    | 'account-info'
    | 'remove';

export function buildDashboardSourceActions(
    playlist: PlaylistMeta,
    canRefresh: boolean
): DashboardRailAction[] {
    const actions: DashboardRailAction[] = [];

    if (canRefresh) {
        actions.push({
            id: 'refresh',
            icon: 'sync',
            labelKey: playlist.serverUrl
                ? 'HOME.PLAYLISTS.REFRESH_XTREAM'
                : 'HOME.PLAYLISTS.REFRESH',
        });
    }

    actions.push({
        id: 'playlist-info',
        icon: 'edit',
        labelKey: 'HOME.PLAYLISTS.SHOW_DETAILS',
    });

    if (isXtreamAccountPlaylist(playlist)) {
        actions.push({
            id: 'account-info',
            icon: 'person',
            labelKey: 'WORKSPACE.SHELL.ACCOUNT_INFO',
        });
    }

    actions.push({
        id: 'remove',
        icon: 'delete',
        labelKey: 'HOME.PLAYLISTS.REMOVE_DIALOG.TITLE',
        destructive: true,
        separatorBefore: true,
    });

    return actions;
}

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

export function liveRailTitleKeyForSource(
    source: 'favorites' | 'recent'
): string {
    return source === 'favorites'
        ? 'WORKSPACE.DASHBOARD.LIVE_FAVORITES'
        : 'WORKSPACE.DASHBOARD.RECENTLY_WATCHED_LIVE_TV';
}

export function buildDashboardCollectionViewState(
    selectedContentType: CollectionContentType
): Record<string, unknown> {
    return {
        [COLLECTION_VIEW_STATE_KEY]: buildCollectionViewState({
            selectedContentType,
        }),
    };
}

export function buildDashboardRailSeeAllState(
    cards: readonly Pick<DashboardRailCard, 'contentType'>[],
    fallbackContentType: CollectionContentType = 'movie'
): Record<string, unknown> {
    const firstContentType =
        cards.find(
            (
                card
            ): card is Pick<DashboardRailCard, 'contentType'> & {
                contentType: CollectionContentType;
            } =>
                card.contentType === 'live' ||
                card.contentType === 'movie' ||
                card.contentType === 'series'
        )?.contentType ?? fallbackContentType;

    return buildDashboardCollectionViewState(firstContentType);
}

type DashboardRecentRailSettings = Pick<
    DashboardRailsSettings,
    'continueWatching' | 'recentlyWatchedLive'
>;

export interface DashboardRecentContentSkeletonInput {
    readonly continueWatchingCount: number;
    readonly globalRecentLoading: boolean;
    readonly recentLiveCount: number;
}

export function shouldShowRecentContentSkeleton(
    rails: DashboardRecentRailSettings,
    input: DashboardRecentContentSkeletonInput
): boolean {
    if (!input.globalRecentLoading) {
        return false;
    }

    return (
        (rails.continueWatching && input.continueWatchingCount === 0) ||
        (rails.recentlyWatchedLive && input.recentLiveCount === 0)
    );
}
