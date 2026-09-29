import type { Signal } from '@angular/core';
import type { DashboardRailsSettings } from '@iptvnator/shared/interfaces';
import { createRailSkeletonGates } from './dashboard-skeleton-grace';

type Count = () => { readonly length: number };

/**
 * What the dashboard exposes for skeleton decisions; the rails component
 * satisfies it structurally, so the rail order and conditions live here
 * rather than in that (already oversized) component.
 */
export interface DashboardRailSkeletonHost {
    readonly dashboardRails: () => DashboardRailsSettings;
    readonly continueWatchingCards: Count;
    readonly liveFavoriteCards: Count;
    readonly recentLiveCards: Count;
    readonly favoriteMoviesAndSeriesCards: Count;
    readonly sourceCards: Count;
    readonly xtreamRecentlyAddedCards: Count;
    readonly recommendationCards: Count;
    readonly trendingCards: Count;
    readonly showLiveFavoritesSkeleton: () => boolean;
    readonly showRecentContentSkeleton: () => boolean;
    readonly xtreamPlaylistCount: () => number;
    readonly data: {
        readonly playlistsLoaded: () => boolean;
        readonly xtreamRecentlyAddedLoading: () => boolean;
    };
    readonly recommendationsService: { readonly loading: () => boolean };
    readonly trendingService: { readonly loading: () => boolean };
}

export type DashboardRailSkeletonKey =
    | 'continueWatching'
    | 'liveFavorites'
    | 'recentLive'
    | 'favoriteVod'
    | 'recentContent'
    | 'sources'
    | 'xtreamRecentlyAdded'
    | 'tmdbRecommendations'
    | 'tmdbTrending';

/**
 * Skeleton gates for the dashboard rails, listed in template order (the
 * no-skeleton-above-visible-cards rule depends on it). Rails without their
 * own skeleton are listed with `loading: false` so they still count as
 * "rendered below" for the rails above them. Must be created in an
 * injection context.
 */
export function createDashboardRailSkeletons(
    host: DashboardRailSkeletonHost
): Record<DashboardRailSkeletonKey, Signal<boolean>> {
    const rails = () => host.dashboardRails();
    const none = () => false;

    return createRailSkeletonGates<DashboardRailSkeletonKey>([
        [
            'continueWatching',
            {
                loading: none,
                rendered: () =>
                    rails().continueWatching &&
                    host.continueWatchingCards().length > 0,
            },
        ],
        [
            'liveFavorites',
            {
                loading: () => host.showLiveFavoritesSkeleton(),
                rendered: () =>
                    rails().liveFavorites &&
                    !host.showLiveFavoritesSkeleton() &&
                    host.liveFavoriteCards().length > 0,
            },
        ],
        [
            'recentLive',
            {
                loading: none,
                rendered: () =>
                    rails().recentlyWatchedLive &&
                    host.recentLiveCards().length > 0,
            },
        ],
        [
            'favoriteVod',
            {
                loading: none,
                rendered: () =>
                    rails().favoriteMoviesAndSeries &&
                    host.favoriteMoviesAndSeriesCards().length > 0,
            },
        ],
        [
            'recentContent',
            { loading: () => host.showRecentContentSkeleton(), rendered: none },
        ],
        [
            'sources',
            {
                loading: () =>
                    rails().recentSources && !host.data.playlistsLoaded(),
                rendered: () =>
                    rails().recentSources && host.sourceCards().length > 0,
            },
        ],
        [
            'xtreamRecentlyAdded',
            {
                loading: () =>
                    rails().xtreamRecentlyAdded &&
                    host.xtreamPlaylistCount() > 0 &&
                    host.data.xtreamRecentlyAddedLoading(),
                rendered: () =>
                    rails().xtreamRecentlyAdded &&
                    host.xtreamRecentlyAddedCards().length > 0,
            },
        ],
        [
            'tmdbRecommendations',
            {
                loading: () =>
                    rails().tmdbRecommendations &&
                    host.recommendationsService.loading(),
                rendered: () =>
                    rails().tmdbRecommendations &&
                    host.recommendationCards().length > 0,
            },
        ],
        [
            'tmdbTrending',
            {
                loading: () =>
                    rails().tmdbTrending && host.trendingService.loading(),
                rendered: () =>
                    rails().tmdbTrending && host.trendingCards().length > 0,
            },
        ],
    ]);
}
