import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    CatalogTitleMatch,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardRecommendationsService } from './dashboard-recommendations.service';

/** "Because you watched" follows the TMDB match the viewer chose for a seed. */
describe('DashboardRecommendationsService and TMDB match choices', () => {
    const titles = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
    const recommendations = (offset: number) => ({
        recommendations: {
            results: titles.map((title, i) => ({
                id: offset + i,
                title: `${title} ${offset}`,
                release_date: '2010-01-01',
                vote_average: 7,
                vote_count: 10,
                poster_path: null,
                popularity: 10,
            })),
        },
    });
    const seed = {
        title: 'Synthetic Seed',
        type: 'movie',
        source: 'xtream',
        playlist_id: 'pl-1',
        xtream_id: 42,
    };

    let choice: unknown;
    let otherChoice: unknown;
    let enrichMovie: jest.Mock;
    let enrichTv: jest.Mock;
    let playbackPosition: PlaybackPositionData | null;
    let seeds: object[];

    function createService(): DashboardRecommendationsService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => true,
                        enrichMovie,
                        enrichTv,
                        language: () => 'en-US',
                        getMatches: async () => ({
                            read: (identity: { itemId: string }) =>
                                identity.itemId === '42' ? choice : otherChoice,
                        }),
                    },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: {
                        isAvailable: true,
                        matchTitles: async (queries: string[]) =>
                            queries.map((queryTitle, i): CatalogTitleMatch => ({
                                queryTitle,
                                playlistId: 'pl-1',
                                playlistName: 'Synthetic Portal',
                                categoryId: 7,
                                xtreamId: 1000 + i,
                                type: 'movie',
                                trailingYear: null,
                            })),
                        visibleMatches: (matches: CatalogTitleMatch[]) =>
                            matches,
                    },
                },
                {
                    provide: DashboardDataService,
                    useValue: {
                        globalRecentVodItems: () => seeds,
                        globalRecentItems: () => seeds,
                        globalFavoriteItems: () => [],
                        getPlaybackPositionForItem: () => playbackPosition,
                        playlists: () => [{ _id: 'pl-1' }],
                    },
                },
            ],
        });
        return TestBed.inject(DashboardRecommendationsService);
    }

    beforeEach(() => {
        choice = null;
        otherChoice = null;
        seeds = [seed];
        playbackPosition = null;
        enrichTv = jest.fn(async () => null);
        enrichMovie = jest.fn(
            async (query: { matchIdentity?: unknown; title: string }) =>
                recommendations(
                    query.matchIdentity
                        ? 500
                        : query.title === 'Synthetic Other'
                          ? 300
                          : 100
                )
        );
    });

    it.each([42, undefined])(
        'uses the parent series choice for an episode-keyed seed (%s)',
        async (seriesXtreamId) => {
            seeds = [{ ...seed, type: 'series', xtream_id: 43 }];
            playbackPosition = {
                contentType: 'episode',
                contentXtreamId: 43,
                seriesXtreamId,
                positionSeconds: 30,
            };
            choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Parent' };
            otherChoice = { mode: 'provider' };

            await createService().load();

            expect(enrichTv).toHaveBeenCalledTimes(1);
            const [query] = enrichTv.mock.calls[0];
            expect(query.matchIdentity?.itemId).toBe(
                seriesXtreamId?.toString()
            );
        }
    );

    it('recommends from the title the viewer matched by hand', async () => {
        choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Match' };
        const service = createService();

        await service.load();

        expect(enrichMovie).toHaveBeenCalledWith(
            expect.objectContaining({
                matchIdentity: {
                    provider: 'xtream',
                    playlistId: 'pl-1',
                    mediaType: 'movie',
                    itemId: '42',
                },
            })
        );
        expect(service.items()[0].title).toBe('Alpha 500');
    });

    it.each([
        { mode: 'provider' },
        { mode: 'manual', tmdbId: 605, title: 'Synthetic New Match' },
    ])(
        'keeps only the other same-titled seed when the choice changes to $mode during an outage',
        async (newChoice) => {
            seeds = [seed, { ...seed, xtream_id: 43 }];
            choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Match' };
            const service = createService();
            await service.load();
            expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
                expect.arrayContaining([100, 500])
            );

            choice = newChoice;
            enrichMovie.mockResolvedValue(null);
            await service.load();

            expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
                titles.map((_, i) => 100 + i)
            );
        }
    );

    it('retires cards from a seed deduplicated after switching to the same match offline', async () => {
        seeds = [seed, { ...seed, xtream_id: 43 }];
        choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Match' };
        const service = createService();
        await service.load();
        expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
            expect.arrayContaining([100, 500])
        );

        otherChoice = choice;
        enrichMovie.mockResolvedValue(null);
        await service.load();

        expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
            titles.map((_, i) => 500 + i)
        );
    });

    it.each([
        { mode: 'provider' },
        { mode: 'manual', tmdbId: 605, title: 'Synthetic New Match' },
    ])(
        'keeps shared recommendations from an unchanged seed when the first switches to $mode offline',
        async (newChoice) => {
            const otherSeed = {
                ...seed,
                title: 'Synthetic Other',
                xtream_id: 43,
            };
            seeds = [seed, otherSeed];
            choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Match' };
            enrichMovie.mockResolvedValue(recommendations(500));
            const service = createService();

            await service.load();
            const sharedIds = titles.map((_, i) => 500 + i);
            expect(enrichMovie).toHaveBeenCalledTimes(2);
            expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
                sharedIds
            );
            expect(service.seedTitles()).toEqual([seed.title]);

            choice = newChoice;
            enrichMovie.mockResolvedValue(null);
            await service.load();

            expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
                sharedIds
            );
            expect(service.seedTitles()).toEqual([otherSeed.title]);
        }
    );

    it('keeps a second contributor when equivalent seeds share one TMDB request', async () => {
        const otherSeed = { ...seed, xtream_id: 43 };
        seeds = [
            seed,
            { ...seed, title: 'Synthetic Second', xtream_id: 44 },
            { ...seed, title: 'Synthetic Third', xtream_id: 45 },
            otherSeed,
        ];
        enrichMovie.mockImplementation(async ({ title }: { title: string }) =>
            title === seed.title ? recommendations(500) : null
        );
        const service = createService();

        await service.load();
        const sharedIds = titles.map((_, i) => 500 + i);
        expect(enrichMovie).toHaveBeenCalledTimes(3);
        expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(sharedIds);

        choice = { mode: 'provider' };
        enrichMovie.mockResolvedValue(null);
        await service.load();

        expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(sharedIds);

        otherChoice = choice;
        await service.load();

        expect(service.items()).toEqual([]);
    });

    it.each(['Unknown', 'Synthetic Provider Title'])(
        'lets usable seeds fill the request budget ahead of a provider-only row (%s)',
        async (title) => {
            seeds = [
                {
                    ...seed,
                    title,
                    source: 'stalker',
                    stalker_item: {
                        id: '42',
                        category_id: '7',
                        info: title === 'Unknown' ? {} : { name: title },
                    },
                },
                { ...seed, title: 'Synthetic Miss One', xtream_id: 43 },
                { ...seed, title: 'Synthetic Miss Two', xtream_id: 44 },
                { ...seed, title: 'Synthetic Hit', xtream_id: 45 },
            ];
            choice = { mode: 'provider' };
            enrichMovie.mockImplementation(async (query: { title: string }) =>
                query.title === 'Synthetic Hit' ? recommendations(500) : null
            );

            const service = createService();
            await service.load();

            expect(enrichMovie).toHaveBeenCalledTimes(3);
            expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
                titles.map((_, i) => 500 + i)
            );
        }
    );

    it('uses a manual match as a seed when the provider title cannot be searched', async () => {
        seeds = [
            {
                title: 'Unknown',
                type: 'movie',
                source: 'stalker',
                playlist_id: 'pl-1',
                stalker_item: { id: '42', category_id: '7', info: {} },
            },
        ];
        choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Match' };
        const service = createService();

        await service.load();

        expect(service.items().map(({ tmdbId }) => tmdbId)).toEqual(
            titles.map((_, i) => 500 + i)
        );
        expect(service.seedTitles()).toEqual(['Synthetic Match']);
    });

    it('loads again when the seed is re-matched', async () => {
        const service = createService();
        await Promise.resolve();
        await service.load();
        expect(service.items()[0].title).toBe('Alpha 100');

        choice = { mode: 'manual', tmdbId: 604, title: 'Synthetic Match' };
        await service.load();

        expect(enrichMovie).toHaveBeenCalledTimes(2);
        expect(service.items()[0].title).toBe('Alpha 500');
    });
});
