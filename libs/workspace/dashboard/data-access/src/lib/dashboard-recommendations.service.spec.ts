import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardRecommendationsService } from './dashboard-recommendations.service';

interface ActivityStub {
    stalker_item?: unknown;
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

    // Distinct catalog rows per title: cards are deduplicated by the row
    // they resolve to, so a shared id would collapse the whole rail.
    const rowIds = new Map<string, number>();
    const rowIdFor = (title: string): number => {
        const existing = rowIds.get(title);
        if (existing !== undefined) {
            return existing;
        }
        const assigned = rowIds.size + 1;
        rowIds.set(title, assigned);
        return assigned;
    };

    const match = (
        queryTitle: string,
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle,
        playlistId: 'pl-1',
        playlistName: 'My Portal',
        categoryId: 7,
        xtreamId: rowIdFor(queryTitle),
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
    let tmdbLanguage: string;

    /**
     * Switch the fixture to a series seed, so the candidates it produces
     * are `tv`-typed. Exclusion is keyed by media type, so a `movie`-typed
     * candidate could never prove anything about the `series:` keys.
     */
    function seedTvRecommendations(extraTitles: readonly string[]): void {
        recentVod = [{ title: 'The Boys', type: 'series' }];
        recentAll = [...recentVod];
        enrichMovie.mockResolvedValue(null);
        enrichTv.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles.slice(0, 5).map((title, i) => rec(100 + i, title)),
                    ...extraTitles.map((title, i) => rec(200 + i, title)),
                ],
            },
        });
        // The catalog rows a tv candidate can match are series rows —
        // buildTitleMatchIndex keys them by the match's own type.
        matchTitles.mockImplementation(async (titles: string[]) =>
            titles.map((title) => match(title, { type: 'series' }))
        );
    }

    function createService(
        options: { matchingAvailable?: boolean } = {}
    ): DashboardRecommendationsService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled,
                        enrichMovie,
                        enrichTv,
                        language: () => tmdbLanguage,
                    },
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
        tmdbLanguage = 'en-US';
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

    it('excludes a watched Stalker embedded-VOD series from the tv rail', async () => {
        // The activity row routes into VOD and is stored as 'movie',
        // while TMDB (and the recommendation) knows it as a show — so the
        // exclusion must be indexed under the media type the lookup
        // builder resolved, not the routing one.
        seedTvRecommendations(['Kholod']);
        recentAll = [
            ...recentVod,
            {
                title: 'Kholod',
                type: 'movie',
                stalker_item: {
                    id: '17573',
                    category_id: 'vclub',
                    series: [1, 2, 3],
                    info: { name: 'Kholod' },
                },
            } as ActivityStub,
        ];
        const service = createService();

        await service.load();

        const tvTitles = service
            .items()
            .filter((item) => item.mediaType === 'tv')
            .map((item) => item.title);
        // Guard: the rail really is carrying tv candidates here, so the
        // assertion below cannot pass on an empty list.
        expect(tvTitles.length).toBeGreaterThan(0);
        expect(tvTitles).not.toContain('Kholod');
    });

    it('excludes a watched Stalker item through its stored original title', async () => {
        // Watched entry stored in the original language; the app now
        // requests TMDB in another one, so the candidate is translated.
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    rec(200, 'Inception'),
                ],
            },
        });
        recentAll = [
            ...recentVod,
            {
                title: 'Начало',
                type: 'movie',
                stalker_item: {
                    id: '42',
                    category_id: 'vod',
                    info: { name: 'Начало', o_name: 'Inception' },
                },
            } as ActivityStub,
        ];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).not.toContain(
            'Inception'
        );
    });

    it('does not let a watched film exclude the same-named show', async () => {
        // A plain 'movie' row states nothing about being a series, so the
        // lookup builder's tv retry is a guess — indexing it would make a
        // watched film swallow the unrelated show of the same name.
        seedTvRecommendations(['Fargo']);
        recentAll = [...recentVod, { title: 'Fargo', type: 'movie' }];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).toContain('Fargo');
    });

    it('excludes a watched title stored with a trailing release year', async () => {
        // Panels routinely name the file "Inception 2010"; its exact key
        // can never equal TMDB's canonical "Inception".
        recentAll = [...recentVod, { title: 'Inception 2010', type: 'movie' }];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).not.toContain(
            'Inception'
        );
    });

    it('does not let a year-suffixed title swallow a different film', async () => {
        // "Blade Runner 2049" carries a year in its NAME — the 1982 film
        // shares the base title but is a different movie.
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    rec(200, 'Blade Runner', 1982),
                ],
            },
        });
        recentAll = [
            ...recentVod,
            { title: 'Blade Runner 2049', type: 'movie' },
        ];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).toContain(
            'Blade Runner'
        );
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

    it('recovers a previously successful input set after a hidden interlude', async () => {
        const service = createService();

        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);

        // A transient below-threshold result under different inputs
        favorites = [{ title: 'Inception', type: 'movie' }];
        matchTitles.mockImplementationOnce(async (titles: string[]) =>
            titles.slice(0, 4).map((title) => match(title))
        );
        await service.load();
        expect(service.items()).toEqual([]);

        // Returning to the original inputs must reload, not hit the guard
        favorites = [];
        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);
    });

    it('reloads when the TMDB language changes', async () => {
        const service = createService();

        await service.load();
        expect(enrichMovie).toHaveBeenCalledTimes(1);

        tmdbLanguage = 'ru-RU';
        await service.load();
        expect(enrichMovie).toHaveBeenCalledTimes(2);
    });

    it('picks the year-compatible row when the catalog holds several', async () => {
        // Two year-stripped rows share one key; the wrong one arrives
        // first. Collapsing before the year check would discard the right
        // one and drop the card.
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    rec(200, 'Dune', 2021),
                ],
            },
        });
        matchTitles.mockImplementation(async (titles: string[]) => {
            const rows: CatalogTitleMatch[] = [];
            for (const title of titles) {
                if (title === 'Dune') {
                    rows.push(
                        match(title, { trailingYear: 1984, xtreamId: 84 }),
                        match(title, { trailingYear: 2021, xtreamId: 21 })
                    );
                } else {
                    rows.push(match(title));
                }
            }
            return rows;
        });
        const service = createService();

        await service.load();

        const dune = service.items().find((item) => item.title === 'Dune');
        expect(dune).toBeDefined();
        expect(dune?.match.xtreamId).toBe(21);
    });

    it('falls back to the alias match when the localized match is year-incompatible', async () => {
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    {
                        ...rec(200, 'The Hunt', 2012),
                        original_title: 'Jagten',
                    },
                ],
            },
        });
        matchTitles.mockImplementation(async (titles: string[]) =>
            titles.map((title) =>
                match(title, {
                    // The localized title hits a same-named 2020 row; the
                    // original-title alias holds the correct 2012 match.
                    trailingYear: title === 'The Hunt' ? 2020 : null,
                })
            )
        );
        const service = createService();

        await service.load();

        const hunt = service
            .items()
            .find((item) => item.title === 'The Hunt');
        expect(hunt).toBeDefined();
        expect(hunt?.match.queryTitle).toBe('Jagten');
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

    it('keeps the rail when a refresh cannot reach TMDB', async () => {
        const service = createService();

        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);

        // New seed, TMDB unreachable: a failed refresh is not a verdict
        // that there is nothing to recommend.
        recentVod = [{ title: 'Heat', type: 'movie' }];
        recentAll = [...recentVod];
        enrichMovie.mockResolvedValue(null);
        await service.load();

        expect(service.items()).toHaveLength(recTitles.length);
    });

    it('drops a since-favorited card even when the refresh fails', async () => {
        const service = createService();

        await service.load();
        expect(service.items().map((item) => item.title)).toContain(
            'Inception'
        );

        favorites = [{ title: 'Inception', type: 'movie' }];
        enrichMovie.mockResolvedValue(null);
        await service.load();

        const titles = service.items().map((item) => item.title);
        expect(titles).not.toContain('Inception');
        // The rest survive — the failure is not a reason to blank them
        expect(titles).toHaveLength(recTitles.length - 1);
    });

    it('rebuilds after an offline filter once the inputs are restored', async () => {
        const service = createService();

        await service.load();
        const full = service.items().length;

        // Offline, and enough cards favorited to fall under the threshold
        favorites = recTitles.slice(0, 3).map((title) => ({
            title,
            type: 'movie',
        }));
        enrichMovie.mockResolvedValue(null);
        await service.load();
        expect(service.items()).toEqual([]);

        // Un-favoriting restores the exact inputs of the successful load —
        // the saved key must not short-circuit the rebuild.
        favorites = [];
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: recTitles.map((title, i) => rec(100 + i, title)),
            },
        });
        await service.load();
        expect(service.items()).toHaveLength(full);
    });

    it('keeps same-titled remakes apart through catalog matching', async () => {
        // Two seeds recommend two different films sharing a title; only
        // the 2021 one is in the library. Collapsing them before matching
        // would let the 1984 entry fail the year gate on its behalf.
        recentVod = [
            { title: 'The Matrix', type: 'movie' },
            { title: 'Blade Runner', type: 'movie' },
        ];
        recentAll = [...recentVod];
        enrichMovie.mockImplementation(async (query: { title: string }) => ({
            recommendations: {
                results:
                    query.title === 'The Matrix'
                        ? [
                              // The unplayable cut is interleaved FIRST —
                              // that is the order in which collapsing by
                              // title loses the playable one.
                              rec(300, 'Dune', 1984),
                              ...recTitles
                                  .slice(0, 5)
                                  .map((t, i) => rec(100 + i, t)),
                          ]
                        : [rec(301, 'Dune', 2021)],
            },
        }));
        matchTitles.mockImplementation(async (titles: string[]) => {
            const rows: CatalogTitleMatch[] = [];
            for (const title of titles) {
                // The library holds only the 2021 cut
                rows.push(
                    title === 'Dune'
                        ? match(title, { trailingYear: 2021, xtreamId: 21 })
                        : match(title)
                );
            }
            return rows;
        });
        const service = createService();

        await service.load();

        const dune = service.items().filter((item) => item.title === 'Dune');
        expect(dune).toHaveLength(1);
        expect(dune[0].year).toBe(2021);
    });

    it('does not exclude a remake whose year disagrees with the watched one', async () => {
        // A Stalker row states its release year, so a watched 1954
        // "Godzilla" must not swallow the 2014 one.
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    rec(200, 'Godzilla', 2014),
                ],
            },
        });
        recentAll = [
            ...recentVod,
            {
                title: 'Godzilla',
                type: 'movie',
                stalker_item: {
                    id: '9',
                    category_id: 'vod',
                    info: { name: 'Godzilla', releasedate: '1954-11-03' },
                },
            } as ActivityStub,
        ];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).toContain(
            'Godzilla'
        );
    });

    it('excludes a watched title whose name ends in a year', async () => {
        // "Blade Runner 2049" is a 2017 film; the 2049 belongs to the
        // NAME, so it must not be read as a release year and used to
        // reject the very title the user just watched.
        enrichMovie.mockResolvedValue({
            recommendations: {
                results: [
                    ...recTitles
                        .slice(0, 5)
                        .map((title, i) => rec(100 + i, title)),
                    rec(200, 'Blade Runner 2049', 2017),
                ],
            },
        });
        recentAll = [
            ...recentVod,
            { title: 'Blade Runner 2049', type: 'movie' },
        ];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).not.toContain(
            'Blade Runner 2049'
        );
    });

    it('drops a card whose playlist was deleted while offline', async () => {
        const service = createService();

        await service.load();
        expect(service.items().length).toBeGreaterThan(0);

        // Playlist gone AND TMDB unreachable — the only path that reaches
        // the retained cards without rebuilding them.
        playlists = [];
        enrichMovie.mockResolvedValue(null);
        await service.load();

        expect(service.items()).toEqual([]);
    });

    it('still excludes a watched title whose year is unknown', async () => {
        recentAll = [...recentVod, { title: 'Inception', type: 'movie' }];
        const service = createService();

        await service.load();

        expect(service.items().map((item) => item.title)).not.toContain(
            'Inception'
        );
    });

    it('retries while any seed is still unresolved', async () => {
        // Two seeds, one transiently failing: the resolved one alone
        // fills the rail, but latching would drop the other seed's
        // recommendations for the rest of the session.
        recentVod = [
            { title: 'The Matrix', type: 'movie' },
            { title: 'Blade Runner', type: 'movie' },
        ];
        recentAll = [...recentVod];
        enrichMovie.mockImplementation(async (query: { title: string }) =>
            query.title === 'The Matrix'
                ? {
                      recommendations: {
                          results: recTitles.map((t, i) => rec(100 + i, t)),
                      },
                  }
                : null
        );
        const service = createService();

        await service.load();
        expect(service.items()).toHaveLength(recTitles.length);
        const callsAfterFirst = enrichMovie.mock.calls.length;

        await service.load();
        expect(enrichMovie.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it('latches once every seed has resolved', async () => {
        const service = createService();

        await service.load();
        await service.load();

        expect(enrichMovie).toHaveBeenCalledTimes(1);
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
