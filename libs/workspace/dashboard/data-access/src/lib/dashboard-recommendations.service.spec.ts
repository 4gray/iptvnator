import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardRecommendationsService } from './dashboard-recommendations.service';

interface ActivityStub {
    title: string;
    type: string;
}

describe('DashboardRecommendationsService', () => {
    const rec = (id: number, title: string, year = 2010) => ({
        id,
        title,
        release_date: `${year}-01-01`,
        vote_average: 7.5,
        vote_count: 100,
        poster_path: null,
        popularity: 50,
    });

    const match = (
        queryTitle: string,
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle,
        playlistId: 'pl-1',
        playlistName: 'My Portal',
        categoryId: 7,
        xtreamId: 42,
        type: 'movie',
        trailingYear: null,
        ...overrides,
    });

    // Seven recommendations so dropping two (exclusion tests) still leaves
    // the rail at MIN_RECOMMENDATION_MATCHES (5).
    const recTitles = [
        'Inception',
        'Interstellar',
        'Tenet',
        'Dunkirk',
        'Memento',
        'Insomnia',
        'The Prestige',
    ];

    let isEnabled: jest.Mock;
    let enrichMovie: jest.Mock;
    let enrichTv: jest.Mock;
    let matchTitles: jest.Mock;
    let recentVod: ActivityStub[];
    let recentAll: ActivityStub[];
    let favorites: ActivityStub[];
    let playlists: { _id: string }[];

    function createService(
        options: { matchingAvailable?: boolean } = {}
    ): DashboardRecommendationsService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled, enrichMovie, enrichTv },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: {
                        isAvailable: options.matchingAvailable ?? true,
                        matchTitles,
                    },
                },
                {
                    provide: DashboardDataService,
                    useValue: {
                        globalRecentVodItems: () => recentVod,
                        globalRecentItems: () => recentAll,
                        globalFavoriteItems: () => favorites,
                        playlists: () => playlists,
                    },
                },
            ],
        });
        return TestBed.inject(DashboardRecommendationsService);
    }

    beforeEach(() => {
        isEnabled = jest.fn().mockReturnValue(true);
        enrichMovie = jest.fn().mockResolvedValue({
            recommendations: {
                results: recTitles.map((title, i) => rec(100 + i, title)),
            },
        });
        enrichTv = jest.fn().mockResolvedValue(null);
        matchTitles = jest
            .fn()
            .mockImplementation(async (titles: string[]) =>
                titles.map((title) => match(title))
            );
        recentVod = [{ title: 'The Matrix', type: 'movie' }];
        recentAll = [...recentVod];
        favorites = [];
        playlists = [{ _id: 'pl-1' }];
    });

    it('does nothing when TMDB is disabled', async () => {
        isEnabled.mockReturnValue(false);
        const service = createService();

        await service.load();

        expect(enrichMovie).not.toHaveBeenCalled();
        expect(service.items()).toEqual([]);
    });

    it('does nothing without the Electron title matcher (PWA)', async () => {
        const service = createService({ matchingAvailable: false });

        await service.load();

        expect(enrichMovie).not.toHaveBeenCalled();
    });

    it('builds the rail from matched seed recommendations', async () => {
        const service = createService();

        await service.load();

        expect(service.items()).toHaveLength(recTitles.length);
        expect(service.items()[0].match.playlistName).toBe('My Portal');
        expect(service.seedTitles()).toEqual(['The Matrix']);
        expect(service.loading()).toBe(false);
    });

    it('hides the rail below the minimum match count without latching', async () => {
        matchTitles.mockImplementationOnce(async (titles: string[]) =>
            titles.slice(0, 4).map((title) => match(title))
        );
        const service = createService();

        await service.load();
        expect(service.items()).toEqual([]);
        expect(service.seedTitles()).toEqual([]);

        // A transient matcher failure surfaces as an empty result — the
        // next visit must retry instead of hiding the rail all session.
        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);
    });

    it('excludes titles the user already watched or favorited', async () => {
        favorites = [{ title: 'Inception', type: 'movie' }];
        recentAll = [
            ...recentVod,
            { title: 'Interstellar', type: 'movie' },
            // A live channel sharing a rec title must NOT exclude the movie
            { title: 'Tenet', type: 'live' },
        ];
        const service = createService();

        await service.load();

        const titles = service.items().map((item) => item.title);
        expect(titles).not.toContain('Inception');
        expect(titles).not.toContain('Interstellar');
        expect(titles).toContain('Tenet');
    });

    it('drops year-incompatible matches', async () => {
        matchTitles.mockImplementation(async (titles: string[]) =>
            titles.map((title) =>
                match(title, {
                    trailingYear: title === 'Inception' ? 1974 : null,
                })
            )
        );
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).not.toContain(
            'Inception'
        );
    });

    it('loads once per seed set and re-seeds when it changes', async () => {
        const service = createService();

        await service.load();
        await service.load();
        expect(enrichMovie).toHaveBeenCalledTimes(1);

        recentVod = [{ title: 'Heat', type: 'movie' }];
        recentAll = [...recentVod];
        await service.load();
        expect(enrichMovie).toHaveBeenCalledTimes(2);
    });

    it('clears the rail when the watch history empties', async () => {
        const service = createService();

        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);

        recentVod = [];
        recentAll = [];
        await service.load();

        expect(service.items()).toEqual([]);
        expect(service.seedTitles()).toEqual([]);
    });

    it('re-filters when a recommended title is favorited after a load', async () => {
        const service = createService();

        await service.load();
        expect(service.items().map((item) => item.title)).toContain(
            'Inception'
        );

        favorites = [{ title: 'Inception', type: 'movie' }];
        await service.load();

        expect(service.items().map((item) => item.title)).not.toContain(
            'Inception'
        );
    });

    it('runs a load queued while another was in flight', async () => {
        let resolveFirst!: (value: unknown) => void;
        enrichMovie.mockImplementationOnce(
            () => new Promise((resolve) => (resolveFirst = resolve))
        );
        const service = createService();

        const first = service.load();
        recentVod = [{ title: 'Heat', type: 'movie' }];
        recentAll = [...recentVod];
        await service.load(); // dropped by the loading guard — must queue

        resolveFirst({
            recommendations: {
                results: recTitles.map((title, i) => rec(100 + i, title)),
            },
        });
        await first; // resolves only after the queued re-run completes

        expect(enrichMovie).toHaveBeenCalledTimes(2);
        expect(enrichMovie.mock.calls[1][0]).toEqual(
            expect.objectContaining({ title: 'Heat' })
        );
    });

    it('re-runs the matching when the playlist set changes', async () => {
        const service = createService();

        await service.load();
        expect(matchTitles).toHaveBeenCalledTimes(1);

        playlists = [{ _id: 'pl-1' }, { _id: 'pl-2' }];
        await service.load();
        expect(matchTitles).toHaveBeenCalledTimes(2);
    });

    it('matches and excludes through the original-title alias', async () => {
        // App language localizes TMDB titles; the catalog and the stored
        // watch history speak the original language.
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    {
                        ...rec(200, 'Начало'),
                        original_title: 'Inception 2',
                    },
                    {
                        ...rec(201, 'Слышь, смотрел?'),
                        original_title: 'Dunkirk 2',
                    },
                ],
            },
        });
        matchTitles.mockImplementation(async (titles: string[]) =>
            titles
                .filter((title) => /^[A-Za-z]/.test(title))
                .map((title) => match(title))
        );
        recentAll = [...recentVod, { title: 'Dunkirk 2', type: 'movie' }];
        const service = createService();

        await service.load();

        const titles = service.items().map((item) => item.title);
        // Matched via its original title, displayed localized
        expect(titles).toContain('Начало');
        // Excluded because its original title was already watched
        expect(titles).not.toContain('Слышь, смотрел?');
    });

    it('retries on the next visit when no seed resolved', async () => {
        enrichMovie.mockResolvedValue(null);
        const service = createService();

        await service.load();
        expect(service.items()).toEqual([]);

        enrichMovie.mockResolvedValue({
            recommendations: {
                results: recTitles.map((title, i) => rec(100 + i, title)),
            },
        });
        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);
    });

    it('interleaves seeds and deduplicates shared recommendations', async () => {
        recentVod = [
            { title: 'The Matrix', type: 'movie' },
            { title: 'Blade Runner', type: 'movie' },
        ];
        recentAll = [...recentVod];
        enrichMovie.mockImplementation(async (query: { title: string }) => ({
            recommendations: {
                results:
                    query.title === 'The Matrix'
                        ? recTitles.slice(0, 4).map((t, i) => rec(100 + i, t))
                        : [
                              // Shared with the first seed — must appear once
                              rec(100, 'Inception'),
                              rec(300, 'Ghost in the Shell'),
                              rec(301, 'Akira'),
                          ],
            },
        }));
        const service = createService();

        await service.load();

        const titles = service.items().map((item) => item.title);
        expect(titles.filter((title) => title === 'Inception')).toHaveLength(1);
        // Round-robin: the second seed's first unique pick lands before the
        // first seed's tail.
        expect(titles.indexOf('Ghost in the Shell')).toBeLessThan(
            titles.indexOf('Dunkirk')
        );
        expect(service.seedTitles()).toEqual(['The Matrix', 'Blade Runner']);
    });

    it('reports only the seeds that contributed visible items', async () => {
        recentVod = [
            { title: 'The Matrix', type: 'movie' },
            { title: 'Blade Runner', type: 'movie' },
        ];
        recentAll = [...recentVod];
        enrichMovie.mockImplementation(async (query: { title: string }) => ({
            recommendations: {
                results:
                    query.title === 'The Matrix'
                        ? recTitles.map((t, i) => rec(100 + i, t))
                        : [],
            },
        }));
        const service = createService();

        await service.load();

        expect(service.seedTitles()).toEqual(['The Matrix']);
    });
});
