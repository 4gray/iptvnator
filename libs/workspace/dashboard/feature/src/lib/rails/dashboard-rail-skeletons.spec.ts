import {
    EnvironmentInjector,
    createEnvironmentInjector,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    type DashboardRailsSettings,
} from '@iptvnator/shared/interfaces';
import {
    createDashboardRailSkeletons,
    type DashboardRailSkeletonHost,
} from './dashboard-rail-skeletons';
import { DASHBOARD_RAIL_SKELETON_GRACE_MS as GRACE } from './dashboard-skeleton-grace';

function fakeHost() {
    const s = {
        rails: signal<DashboardRailsSettings>({
            ...DEFAULT_DASHBOARD_RAILS_SETTINGS,
            continueWatching: true,
            liveFavorites: true,
            recentlyWatchedLive: true,
            favoriteMoviesAndSeries: true,
            recentSources: true,
            xtreamRecentlyAdded: true,
            tmdbRecommendations: true,
            tmdbTrending: true,
        }),
        recentLive: signal<unknown[]>([]),
        sources: signal<unknown[]>([]),
        liveFavoritesLoading: signal(false),
        playlistsLoaded: signal(true),
        xtreamPlaylists: signal(0),
        xtreamLoading: signal(false),
        trendingLoading: signal(false),
    };
    const empty = () => [];
    const host: DashboardRailSkeletonHost = {
        dashboardRails: () => s.rails(),
        continueWatchingCards: empty,
        liveFavoriteCards: empty,
        recentLiveCards: () => s.recentLive(),
        favoriteMoviesAndSeriesCards: empty,
        sourceCards: () => s.sources(),
        xtreamRecentlyAddedCards: empty,
        recommendationCards: empty,
        trendingCards: empty,
        showLiveFavoritesSkeleton: () => s.liveFavoritesLoading(),
        showRecentContentSkeleton: () => false,
        xtreamPlaylistCount: () => s.xtreamPlaylists(),
        data: {
            playlistsLoaded: () => s.playlistsLoaded(),
            xtreamRecentlyAddedLoading: () => s.xtreamLoading(),
        },
        recommendationsService: { loading: () => false },
        trendingService: { loading: () => s.trendingLoading() },
    };
    const injector = createEnvironmentInjector(
        [],
        TestBed.inject(EnvironmentInjector)
    );
    const gates = injector.runInContext(() =>
        createDashboardRailSkeletons(host)
    );
    const settle = (ms = 0) => {
        TestBed.tick();
        jest.advanceTimersByTime(ms);
        TestBed.tick();
    };
    return { s, gates, settle };
}

describe('createDashboardRailSkeletons', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('suppresses the live favorites skeleton once recently watched live, below it, has cards', () => {
        const { s, gates, settle } = fakeHost();
        s.recentLive.set([{}]);
        s.liveFavoritesLoading.set(true);
        settle(GRACE);

        expect(gates.liveFavorites()).toBe(false);
    });

    it('shows the live favorites skeleton on a slow load when nothing below has cards', () => {
        const { s, gates, settle } = fakeHost();
        s.liveFavoritesLoading.set(true);
        settle(GRACE);

        expect(gates.liveFavorites()).toBe(true);
    });

    it('treats sources as loading until playlists have loaded', () => {
        const { s, gates, settle } = fakeHost();
        s.playlistsLoaded.set(false);
        settle(GRACE);
        expect(gates.sources()).toBe(true);

        s.playlistsLoaded.set(true);
        settle();
        expect(gates.sources()).toBe(false);
    });

    it('never shows the Xtream skeleton without an Xtream playlist', () => {
        const { s, gates, settle } = fakeHost();
        s.xtreamLoading.set(true);
        settle(GRACE);
        expect(gates.xtreamRecentlyAdded()).toBe(false);

        s.xtreamLoading.set(false);
        settle();
        s.xtreamPlaylists.set(1);
        s.xtreamLoading.set(true);
        settle(GRACE);
        expect(gates.xtreamRecentlyAdded()).toBe(true);
    });

    it('ignores loading rails whose rail setting is disabled', () => {
        const { s, gates, settle } = fakeHost();
        s.rails.update((rails) => ({ ...rails, tmdbTrending: false }));
        s.trendingLoading.set(true);
        settle(GRACE);

        expect(gates.tmdbTrending()).toBe(false);
    });
});
