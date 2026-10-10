import {
    EnvironmentInjector,
    createEnvironmentInjector,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    connectDashboardTmdbRails,
    type DashboardTmdbRailsHost,
} from './dashboard-tmdb-rails';

function connect() {
    const state = {
        trending: signal(true),
        recommendations: signal(true),
        favoritesLoaded: signal(false),
        continueWatchingSettled: signal(false),
        recentVod: signal<unknown[]>([]),
    };
    const trendingLoad = jest.fn(() => Promise.resolve());
    const recommendationsLoad = jest.fn(() => Promise.resolve());
    const host: DashboardTmdbRailsHost = {
        dashboardRails: () => ({
            tmdbTrending: state.trending(),
            tmdbRecommendations: state.recommendations(),
        }),
        languageTick: () => 0,
        data: {
            globalFavoritesLoaded: () => state.favoritesLoaded(),
            continueWatchingSettled: () => state.continueWatchingSettled(),
            globalRecentVodItems: () => state.recentVod(),
            globalFavoriteItems: () => [],
            playlists: () => [],
        },
        trendingService: { load: trendingLoad },
        recommendationsService: { load: recommendationsLoad },
    };
    const injector = createEnvironmentInjector(
        [],
        TestBed.inject(EnvironmentInjector)
    );
    injector.runInContext(() => connectDashboardTmdbRails(host));
    TestBed.tick();
    return { state, trendingLoad, recommendationsLoad, injector };
}

describe('connectDashboardTmdbRails', () => {
    it('keeps both title matches back until Continue Watching has settled', () => {
        const { state, trendingLoad, recommendationsLoad } = connect();

        state.favoritesLoaded.set(true);
        TestBed.tick();

        // Favorites alone used to start the matches, which then held the
        // DB worker while the playback positions waited behind them.
        expect(trendingLoad).not.toHaveBeenCalled();
        expect(recommendationsLoad).not.toHaveBeenCalled();

        state.continueWatchingSettled.set(true);
        TestBed.tick();

        expect(trendingLoad).toHaveBeenCalledTimes(1);
        expect(recommendationsLoad).toHaveBeenCalledTimes(1);
    });

    it('waits for the favorites as well', () => {
        const { state, trendingLoad, recommendationsLoad } = connect();

        state.continueWatchingSettled.set(true);
        TestBed.tick();

        expect(trendingLoad).not.toHaveBeenCalled();
        expect(recommendationsLoad).not.toHaveBeenCalled();
    });

    it('never loads a rail the user turned off', () => {
        const { state, trendingLoad, recommendationsLoad } = connect();
        state.trending.set(false);
        state.recommendations.set(false);

        state.favoritesLoaded.set(true);
        state.continueWatchingSettled.set(true);
        TestBed.tick();

        expect(trendingLoad).not.toHaveBeenCalled();
        expect(recommendationsLoad).not.toHaveBeenCalled();
    });

    it('reloads recommendations when the history changes, trending only once', () => {
        const { state, trendingLoad, recommendationsLoad } = connect();
        state.favoritesLoaded.set(true);
        state.continueWatchingSettled.set(true);
        TestBed.tick();

        state.recentVod.set([{ id: 1 }]);
        TestBed.tick();

        expect(trendingLoad).toHaveBeenCalledTimes(1);
        expect(recommendationsLoad).toHaveBeenCalledTimes(2);
    });
});
