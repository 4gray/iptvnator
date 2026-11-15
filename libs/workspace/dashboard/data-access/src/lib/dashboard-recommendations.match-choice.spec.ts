import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
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
    let enrichMovie: jest.Mock;
    let seeds: object[];

    function createService(): DashboardRecommendationsService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => true,
                        enrichMovie,
                        enrichTv: jest.fn(async () => null),
                        language: () => 'en-US',
                        // The choice belongs to the first seed only.
                        getMatches: async () => ({
                            read: (identity: { itemId: string }) =>
                                identity.itemId === '42' ? choice : null,
                        }),
                    },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: {
                        isAvailable: true,
                        matchTitles: async (queries: string[]) =>
                            queries.map(
                                (queryTitle, i): CatalogTitleMatch => ({
                                    queryTitle,
                                    playlistId: 'pl-1',
                                    playlistName: 'Synthetic Portal',
                                    categoryId: 7,
                                    xtreamId: 1000 + i,
                                    type: 'movie',
                                    trailingYear: null,
                                })
                            ),
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
                        playlists: () => [{ _id: 'pl-1' }],
                    },
                },
            ],
        });
        return TestBed.inject(DashboardRecommendationsService);
    }

    beforeEach(() => {
        choice = null;
        seeds = [seed];
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

    it('drops an opted-out seed from a rail kept while TMDB is unreachable', async () => {
        const other = {
            title: 'Synthetic Other',
            type: 'movie',
            source: 'xtream',
            playlist_id: 'pl-1',
            xtream_id: 43,
        };
        seeds = [seed, other];
        const service = createService();
        await service.load();
        expect(service.items().some((item) => item.seedTitle === seed.title)).toBe(
            true
        );

        // The viewer takes the seed off TMDB; the other seed's lookup finds
        // nothing (the enrichment layer answers an offline lookup with null).
        choice = { mode: 'provider' };
        enrichMovie.mockResolvedValue(null);
        await service.load();

        expect(enrichMovie).toHaveBeenCalledTimes(3);
        expect(service.items().length).toBeGreaterThan(0);
        expect(
            service.items().some((item) => item.seedTitle === seed.title)
        ).toBe(false);
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
