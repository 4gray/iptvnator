import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import type {
    PlaybackPositionData,
    PortalActivityItem,
    PortalAddedItem,
    PortalFavoriteItem,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import { DashboardDataService } from '@iptvnator/workspace/dashboard/data-access';
import {
    DashboardHeroTmdbService,
    type DashboardHeroTmdbExtras,
} from './dashboard-hero-tmdb.service';
import {
    DASHBOARD_HERO_LIVE_ANSWER_WAIT_MS,
    DashboardHeroSlidesPresenter,
} from './dashboard-hero-slides.presenter';
import type { DashboardHeroLiveCandidate } from './dashboard-hero-slides.utils';
import { DashboardLiveEpgPresenter } from './dashboard-live-epg.presenter';
import type { DashboardLiveEpgDetails } from './dashboard-live-epg.utils';

const series: PortalRecentItem = {
    id: 1,
    title: 'Big Pharma',
    type: 'movie',
    watch_kind: 'series',
    source: 'stalker',
    playlist_id: 'p1',
    playlist_name: 'rucolor',
    category_id: '1',
    xtream_id: 11,
    poster_url: 'https://img/pharma-poster.jpg',
    viewed_at: '2026-09-02',
};
const watchedMovie: PortalRecentItem = {
    ...series,
    id: 2,
    title: 'Finished Film',
    watch_kind: 'movie',
    xtream_id: 12,
    viewed_at: '2026-09-01',
};
const channel: PortalFavoriteItem = {
    id: 3,
    title: 'Match TV',
    type: 'live',
    source: 'xtream',
    playlist_id: 'p2',
    category_id: '5',
    xtream_id: 33,
    poster_url: 'https://img/match-logo.png',
    added_at: '2026-08-01',
};
const favoriteFilm: PortalFavoriteItem = {
    id: 4,
    title: 'Burnley',
    type: 'series',
    source: 'xtream',
    playlist_id: 'p2',
    playlist_name: 'http://user:secret@4kgood.org:8080',
    category_id: '9',
    xtream_id: 44,
    release_year: 2023,
    added_at: '2026-08-02',
};
const import1: PortalAddedItem = {
    id: 5,
    title: 'Parallel Stories',
    type: 'movie',
    source: 'xtream',
    playlist_id: 'p3',
    category_id: '2',
    xtream_id: 55,
    backdrop_url: 'https://img/parallel-wide.jpg',
    added_at: '2026-09-03',
};

const onAir: DashboardLiveEpgDetails = {
    nowPlayingTitle: 'Football: farewell match',
    nowPlayingTimeRange: '18:50 – 20:55',
    nowPlayingProgress: 35,
    nowPlayingDescription: 'Live from Moscow.',
    nowPlayingCategory: 'Sport',
};

describe('DashboardHeroSlidesPresenter', () => {
    let recentItems: ReturnType<typeof signal<PortalRecentItem[]>>;
    let favorites: ReturnType<typeof signal<PortalFavoriteItem[]>>;
    let addedItems: ReturnType<typeof signal<PortalAddedItem[]>>;
    let candidates: ReturnType<typeof signal<DashboardHeroLiveCandidate[]>>;
    let liveDetails: jest.Mock;
    let tmdbEnabled: ReturnType<typeof signal<boolean>>;
    let tmdbLanguage: ReturnType<typeof signal<string>>;
    let getExtras: jest.Mock;
    let recentLoading: ReturnType<typeof signal<boolean>>;
    let favoritesLoading: ReturnType<typeof signal<boolean>>;
    let addedLoading: ReturnType<typeof signal<boolean>>;
    let liveAwaiting: ReturnType<typeof signal<boolean>>;
    const positions = new Map<string | number, PlaybackPositionData>([
        [
            1,
            {
                contentXtreamId: 111,
                contentType: 'episode',
                seriesXtreamId: 11,
                seasonNumber: 1,
                episodeNumber: 3,
                positionSeconds: 600,
                durationSeconds: 1800,
            },
        ],
        [
            2,
            {
                contentXtreamId: 12,
                contentType: 'vod',
                positionSeconds: 5900,
                durationSeconds: 6000,
            },
        ],
    ]);

    function create(): DashboardHeroSlidesPresenter {
        TestBed.configureTestingModule({
            providers: [
                DashboardHeroSlidesPresenter,
                {
                    provide: DashboardDataService,
                    useValue: {
                        globalRecentLoading: () => recentLoading(),
                        globalFavoritesLoading: () => favoritesLoading(),
                        xtreamRecentlyAddedLoading: () => addedLoading(),
                        globalRecentItems: recentItems,
                        globalRecentVodItems: () =>
                            recentItems().filter((i) => i.type !== 'live'),
                        globalFavoriteItems: favorites,
                        xtreamRecentlyAddedItems: addedItems,
                        getPlaybackPositionForItem: (
                            item: PortalActivityItem
                        ) => positions.get(item.id) ?? null,
                        getRecentItemLink: (item: PortalActivityItem) => [
                            '/recent',
                            String(item.id),
                        ],
                        getRecentItemNavigationState: () => ({ resume: true }),
                        getRecentItemDetailNavigationState: () => ({
                            resume: false,
                        }),
                        getRecentItemResumeNavigation: (
                            item: PortalActivityItem
                        ) => (item.id === 1 ? { link: [], state: {} } : null),
                        getGlobalFavoriteLink: (item: PortalActivityItem) => [
                            '/favorite',
                            String(item.id),
                        ],
                        getGlobalFavoriteNavigationState: () => ({ fav: true }),
                        getRecentlyAddedLink: (item: PortalActivityItem) => [
                            '/added',
                            String(item.id),
                        ],
                        getRecentlyAddedNavigationState: () => ({
                            added: true,
                        }),
                    },
                },
                {
                    provide: DashboardLiveEpgPresenter,
                    useValue: {
                        heroLiveCandidates: candidates,
                        heroDetailsFor: liveDetails,
                        heroLiveAwaitingFirstAnswer: () => liveAwaiting(),
                    },
                },
                {
                    provide: DashboardHeroTmdbService,
                    useValue: {
                        isEnabled: () => tmdbEnabled(),
                        keyFor: (item: PortalActivityItem) =>
                            `${tmdbLanguage()}//${item.title}`,
                        getExtras,
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        onLangChange: new Subject(),
                        instant: (key: string, params?: object) =>
                            params ? `${key} ${JSON.stringify(params)}` : key,
                    },
                },
            ],
        });
        return TestBed.inject(DashboardHeroSlidesPresenter);
    }

    beforeEach(() => {
        recentItems = signal([series, watchedMovie]);
        favorites = signal([channel, favoriteFilm]);
        addedItems = signal([import1]);
        candidates = signal([{ origin: 'favorite', item: channel }]);
        liveDetails = jest.fn(() => onAir);
        tmdbEnabled = signal(false);
        tmdbLanguage = signal('en-US');
        getExtras = jest.fn().mockResolvedValue(null);
        recentLoading = signal(false);
        favoritesLoading = signal(false);
        addedLoading = signal(false);
        liveAwaiting = signal(false);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('builds the rotation from resume, live, favourite and import slides', () => {
        const slides = create().slides();

        expect(slides.map((slide) => [slide.kind, slide.title])).toEqual([
            ['continue', 'Big Pharma'],
            ['live', 'Match TV'],
            ['favorite', 'Burnley'],
            ['added', 'Parallel Stories'],
        ]);
        // A (nearly) finished film is not something to continue.
        expect(slides.some((slide) => slide.title === 'Finished Film')).toBe(
            false
        );
    });

    it('drops a season marker from a series title and leaves movies and live titles alone', () => {
        // The rotation holds four slides: only the series, the live channel
        // and a favorite movie compete here (the finished film never does).
        recentItems.set([{ ...series, title: 'Big Pharma (1 сезон)' }]);
        favorites.set([
            { ...favoriteFilm, id: 9, type: 'movie', title: 'Film Season 2' },
        ]);
        addedItems.set([]);
        candidates.set([
            { origin: 'favorite', item: { ...channel, title: 'Sport S01' } },
        ]);
        const presenter = create();
        const titles = presenter.slides().map((slide) => slide.title);
        expect(titles).toContain('Big Pharma');
        expect(titles).not.toContain('Big Pharma (1 сезон)');
        expect(titles).toContain('Film Season 2');
        expect(titles).toContain('Sport S01');
    });

    it('keeps the season marker of a series that no episode badge describes', () => {
        // A favorite with no playback row: the marker is the only thing
        // telling two per-season catalog entries of the show apart.
        recentItems.set([]);
        favorites.set([{ ...favoriteFilm, title: 'Burnley (2 сезон)' }]);
        addedItems.set([]);
        candidates.set([]);
        const [slide] = create().slides();

        expect(slide.episodeBadge).toBeNull();
        expect(slide.title).toBe('Burnley (2 сезон)');
    });

    it('resumes an unfinished series and offers a detail-only way in', () => {
        const [resume] = create().slides();

        expect(resume).toMatchObject({
            typeLabelKey: 'WORKSPACE.DASHBOARD.TYPE_SERIES',
            reasonLabelKey: 'WORKSPACE.DASHBOARD.CONTINUE_WATCHING',
            episodeBadge:
                'WORKSPACE.DASHBOARD.SEASON_EPISODE_BADGE {"season":1,"episode":3}',
            source: 'rucolor',
            progress: 33,
            // No 16:9 backdrop: the poster becomes the blurred stage.
            backdropSource: 'poster',
            primaryAction: {
                labelKey: 'WORKSPACE.DASHBOARD.HERO_CONTINUE',
                link: ['/recent', '1'],
                state: { resume: true },
                remainingLabel: {
                    key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
                    params: { minutes: 20 },
                },
            },
            secondaryAction: {
                labelKey: 'WORKSPACE.DASHBOARD.HERO_DETAILS',
                state: { resume: false },
            },
        });
    });

    it('shows a favourite channel with its programme on air now', () => {
        const live = create().slides()[1];

        expect(live).toMatchObject({
            typeLabelKey: 'WORKSPACE.DASHBOARD.TYPE_LIVE',
            reasonLabelKey: 'WORKSPACE.DASHBOARD.HERO_FAVORITE_CHANNEL',
            programmeTitle: 'Football: farewell match',
            description: 'Live from Moscow.',
            category: 'Sport',
            timeRange: '18:50 – 20:55',
            progress: 35,
            primaryAction: {
                labelKey: 'WORKSPACE.DASHBOARD.HERO_WATCH_LIVE',
                link: ['/favorite', '3'],
            },
            secondaryAction: null,
        });
    });

    it('leaves the live slide out until a candidate has a programme on air', () => {
        liveDetails.mockReturnValue(null);
        const presenter = create();

        expect(presenter.slides().map((slide) => slide.kind)).not.toContain(
            'live'
        );
    });

    it('opens discovery slides on their detail page, with a safe source label', () => {
        const slides = create().slides();

        // The stored name is a URL with credentials: only its host shows.
        expect(slides[2].source).toBe('4kgood.org:8080');
        expect(slides[2]).toMatchObject({
            year: 2023,
            primaryAction: {
                labelKey: 'WORKSPACE.DASHBOARD.HERO_DETAILS',
                link: ['/favorite', '4'],
            },
            secondaryAction: null,
        });
        expect(slides[3]).toMatchObject({
            backdropSource: 'backdrop',
            primaryAction: { link: ['/added', '5'], state: { added: true } },
        });
    });

    it('patches TMDB extras in, and drops them when TMDB is switched off', async () => {
        tmdbEnabled.set(true);
        const extras: DashboardHeroTmdbExtras = {
            backdropUrl: 'https://tmdb/pharma-wide.jpg',
            rating: '7.5',
            genres: ['Drama'],
            overview: 'A pharmacist enters big business.',
            year: 2024,
        };
        getExtras.mockImplementation((item: PortalActivityItem) =>
            Promise.resolve(item.title === 'Big Pharma' ? extras : null)
        );
        const presenter = create();
        TestBed.tick();
        await Promise.resolve();

        expect(getExtras).toHaveBeenCalledTimes(3);
        expect(presenter.slides()[0]).toMatchObject({
            backdropUrl: 'https://tmdb/pharma-wide.jpg',
            backdropSource: 'backdrop',
            rating: '7.5',
            genres: ['Drama'],
            description: 'A pharmacist enters big business.',
            year: 2024,
        });

        tmdbEnabled.set(false);
        expect(presenter.slides()[0]).toMatchObject({
            backdropSource: 'poster',
            rating: null,
            description: null,
        });
    });

    it('loads the extras again when the TMDB language changes', async () => {
        tmdbEnabled.set(true);
        getExtras.mockImplementation((item: PortalActivityItem) =>
            Promise.resolve(
                item.title === 'Big Pharma'
                    ? {
                          backdropUrl: null,
                          rating: '7.5',
                          genres: [
                              tmdbLanguage() === 'en-US' ? 'Drama' : 'Драма',
                          ],
                          overview: `plot in ${tmdbLanguage()}`,
                          year: 2024,
                      }
                    : null
            )
        );
        const presenter = create();
        TestBed.tick();
        await Promise.resolve();
        expect(presenter.slides()[0].description).toBe('plot in en-US');

        tmdbLanguage.set('ru-RU');
        TestBed.tick();
        await Promise.resolve();

        expect(getExtras).toHaveBeenCalledTimes(6);
        expect(presenter.slides()[0]).toMatchObject({
            description: 'plot in ru-RU',
            genres: ['Драма'],
        });
    });

    it('opens a finished fallback title on its details, never "Continue"', () => {
        recentItems.set([watchedMovie]);
        favorites.set([]);
        addedItems.set([]);
        candidates.set([]);
        const [fallback] = create().slides();

        expect(fallback).toMatchObject({
            kind: 'recent',
            primaryAction: {
                labelKey: 'WORKSPACE.DASHBOARD.HERO_DETAILS',
                state: { resume: false },
            },
            secondaryAction: null,
        });
    });

    it('falls back to the generated stage when an image fails to load', () => {
        const presenter = create();
        presenter.markImageFailed('https://img/pharma-poster.jpg');

        expect(presenter.slides()[0]).toMatchObject({
            backdropUrl: undefined,
            backdropSource: 'fallback',
        });
    });

    it('keeps the skeleton until every source that can feature a title has loaded', () => {
        // J1 profile: no history, no favourites; the Xtream recently-added
        // query runs after the favourites and features the only slide.
        recentItems.set([]);
        favorites.set([]);
        candidates.set([]);
        addedItems.set([]);
        recentLoading.set(true);
        favoritesLoading.set(true);
        addedLoading.set(true);
        const presenter = create();
        expect(presenter.loading()).toBe(true);

        recentLoading.set(false);
        expect(presenter.loading()).toBe(true);

        favoritesLoading.set(false);
        expect(presenter.loading()).toBe(true);

        addedItems.set([import1]);
        addedLoading.set(false);
        expect(presenter.slides().map((slide) => slide.kind)).toEqual([
            'added',
        ]);
        expect(presenter.loading()).toBe(false);
    });

    it('drops the skeleton once every source has loaded with nothing to feature', () => {
        recentItems.set([]);
        favorites.set([]);
        candidates.set([]);
        addedItems.set([]);
        addedLoading.set(true);
        const presenter = create();
        expect(presenter.loading()).toBe(true);

        addedLoading.set(false);
        expect(presenter.loading()).toBe(false);
        expect(presenter.slides()).toEqual([]);
    });

    it('shows a slide without waiting for the slower sources', () => {
        favoritesLoading.set(true);
        addedLoading.set(true);

        expect(create().loading()).toBe(false);
    });

    describe('with a live channel as the only candidate', () => {
        let onAirNow: ReturnType<typeof signal<boolean>>;

        beforeEach(() => {
            recentItems.set([]);
            favorites.set([]);
            addedItems.set([]);
            onAirNow = signal(false);
            liveDetails = jest.fn(() => (onAirNow() ? onAir : null));
            liveAwaiting.set(true);
        });

        it('keeps the skeleton until the channel has its first programme', () => {
            const presenter = create();
            expect(presenter.slides()).toEqual([]);
            expect(presenter.loading()).toBe(true);

            onAirNow.set(true);
            liveAwaiting.set(false);
            expect(presenter.slides().map((slide) => slide.kind)).toEqual([
                'live',
            ]);
            expect(presenter.loading()).toBe(false);
        });

        it('drops the skeleton once the channel answered with nothing on air', () => {
            const presenter = create();
            expect(presenter.loading()).toBe(true);

            liveAwaiting.set(false);
            expect(presenter.loading()).toBe(false);
        });

        it('stops waiting for a programme that does not come', () => {
            jest.useFakeTimers();
            const presenter = create();
            expect(presenter.loading()).toBe(true);

            jest.advanceTimersByTime(DASHBOARD_HERO_LIVE_ANSWER_WAIT_MS - 1);
            expect(presenter.loading()).toBe(true);
            jest.advanceTimersByTime(1);
            expect(presenter.loading()).toBe(false);
        });
    });

    it('does not bring the skeleton back once it has gone', () => {
        recentItems.set([]);
        favorites.set([]);
        candidates.set([]);
        addedItems.set([]);
        const presenter = create();
        expect(presenter.loading()).toBe(false);

        // A later live lookup (a rail card changed the XMLTV batch) must
        // not insert the skeleton above content that is already placed.
        liveAwaiting.set(true);
        expect(presenter.loading()).toBe(false);
    });
});
