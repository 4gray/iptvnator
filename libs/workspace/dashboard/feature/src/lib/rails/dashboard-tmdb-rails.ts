import { effect, untracked } from '@angular/core';
import type { DashboardRailsSettings } from '@iptvnator/shared/interfaces';

/**
 * What the TMDB rails' loading reads from the dashboard; the rails
 * component satisfies it structurally, so the gate and its effects live
 * here rather than in that (already oversized) component.
 */
export interface DashboardTmdbRailsHost {
    readonly dashboardRails: () => Pick<
        DashboardRailsSettings,
        'tmdbTrending' | 'tmdbRecommendations'
    >;
    readonly languageTick: () => unknown;
    readonly data: {
        readonly globalFavoritesLoaded: () => boolean;
        readonly continueWatchingSettled: () => boolean;
        readonly globalRecentVodItems: () => unknown;
        readonly globalFavoriteItems: () => unknown;
        readonly playlists: () => unknown;
    };
    readonly trendingService: { load(): Promise<void> };
    readonly recommendationsService: { load(): Promise<void> };
}

/**
 * Whether a TMDB rail may start loading. Its batched title match
 * (`DB_MATCH_TITLES`) holds the single-threaded DB worker for seconds per
 * common word on a large catalog, so it waits until the dashboard's own
 * reads are through: the favorites, and the per-playlist playback positions
 * that Continue Watching and the hero gate on. A match issued before those
 * positions queues them behind it and keeps both skeletons up for as long
 * as the match runs.
 */
export function shouldLoadTmdbRail(
    enabled: boolean,
    host: Pick<DashboardTmdbRailsHost, 'data'>
): boolean {
    return (
        enabled &&
        host.data.globalFavoritesLoaded() &&
        host.data.continueWatchingSettled()
    );
}

/** Starts the TMDB rails' loads when allowed. Call from an injection context. */
export function connectDashboardTmdbRails(host: DashboardTmdbRailsHost): void {
    // Trending rail: needs the TMDB opt-in and the Electron DB worker.
    effect(() => {
        if (!shouldLoadTmdbRail(host.dashboardRails().tmdbTrending, host)) {
            return;
        }
        untracked(() => void host.trendingService.load());
    });

    // Recommendations rail: same gating as trending, plus tracked reads of
    // the seed source, the favorites (both feed the exclusion set) and the
    // playlist set (feeds the catalog key) so a newly watched/favorited
    // title or an imported/deleted playlist re-runs the load — the service
    // keys loads by seed + exclusion + catalog set and skips no-ops.
    effect(() => {
        if (
            !shouldLoadTmdbRail(host.dashboardRails().tmdbRecommendations, host)
        ) {
            return;
        }
        host.data.globalRecentVodItems();
        host.data.globalFavoriteItems();
        host.data.playlists();
        // Language feeds the service's load key (localized payloads)
        host.languageTick();
        untracked(() => void host.recommendationsService.load());
    });
}
