import { TestBed } from '@angular/core/testing';
import { TmdbEnrichmentService } from '@iptvnator/services';
import {
    DashboardHeroTmdbItem,
    DashboardHeroTmdbService,
} from './dashboard-hero-tmdb.service';

describe('DashboardHeroTmdbService', () => {
    const tvDetails = {
        id: 100,
        backdrop_path: '/serial.jpg',
        vote_average: 7.4,
        vote_count: 12,
        genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Comedy' }],
    };

    /**
     * A Stalker recently-viewed entry as stored after the detail view merged
     * TMDB into it: an embedded-VOD series, so the activity row is typed
     * 'movie' while TMDB knows it as a show.
     */
    const stalkerItem: DashboardHeroTmdbItem = {
        title: 'Холод (10 серий)',
        type: 'movie',
        stalker_item: {
            id: '17573',
            category_id: '7',
            series: [1, 2, 3],
            title: 'Холод (10 серий)',
            info: {
                name: 'Холод (10 серий)',
                o_name: 'Kholod',
                releasedate: '2026',
                tmdb_id: 318354,
            },
        },
    } as unknown as DashboardHeroTmdbItem;

    /** A plain VOD entry: nothing marks it as a series, so it leads with movie */
    const plainVodItem = {
        title: 'The Matrix',
        type: 'movie',
        stalker_item: {
            id: '42',
            category_id: 'vod',
            title: 'The Matrix',
            info: {
                name: 'The Matrix',
                releasedate: '1999-03-31',
                tmdb_id: 603,
            },
        },
    } as unknown as DashboardHeroTmdbItem;

    let isEnabled: jest.Mock;
    let enrichMovie: jest.Mock;
    let enrichTv: jest.Mock;

    function createService(): DashboardHeroTmdbService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled, enrichMovie, enrichTv },
                },
            ],
        });
        return TestBed.inject(DashboardHeroTmdbService);
    }

    beforeEach(() => {
        isEnabled = jest.fn().mockReturnValue(true);
        enrichMovie = jest.fn().mockResolvedValue(null);
        enrichTv = jest.fn().mockResolvedValue(tvDetails);
    });

    it('returns null when TMDB is disabled or the item is live', async () => {
        isEnabled.mockReturnValue(false);
        const service = createService();
        await expect(
            service.getExtras({ title: 'X', type: 'movie' })
        ).resolves.toBeNull();

        isEnabled.mockReturnValue(true);
        await expect(
            service.getExtras({ title: 'X', type: 'live' })
        ).resolves.toBeNull();
        expect(enrichMovie).not.toHaveBeenCalled();
    });

    it('falls back to a TV lookup for movie-typed items without a movie match', async () => {
        const service = createService();

        const extras = await service.getExtras({
            title: 'Между нами химия (8 серий)',
            type: 'movie',
        });

        expect(enrichMovie).toHaveBeenCalledTimes(1);
        expect(enrichTv).toHaveBeenCalledTimes(1);
        expect(extras?.backdropUrl).toContain('/serial.jpg');
        expect(extras?.rating).toBe('7.4');
        expect(extras?.genres).toEqual(['Drama', 'Comedy']);
    });

    it('does not retry a series-typed item as a movie', async () => {
        // 'movie' is the answer every row falls back to, so it earns a
        // retry; 'tv' is only reached on positive evidence and must not be
        // traded for a same-titled film — the gate cannot tell an
        // adaptation sharing its show's name and year from the show itself.
        enrichTv.mockResolvedValue(null);
        const service = createService();

        await expect(
            service.getExtras({ title: 'Fargo', type: 'series' })
        ).resolves.toBeNull();
        expect(enrichMovie).not.toHaveBeenCalled();
    });

    it('does not retry as TV when the movie lookup succeeds', async () => {
        enrichMovie.mockResolvedValue({ ...tvDetails, id: 200 });
        const service = createService();

        await service.getExtras({ title: 'Heat', type: 'movie' });

        expect(enrichTv).not.toHaveBeenCalled();
    });

    it('memoizes results per lookup identity', async () => {
        const service = createService();

        await service.getExtras({ title: 'The Boys', type: 'series' });
        await service.getExtras({ title: 'The Boys', type: 'series' });

        expect(enrichTv).toHaveBeenCalledTimes(1);
    });

    describe('stalker items', () => {
        it('queries with the year, original title and id the detail view used', async () => {
            // Without these the search runs on the title alone, and the
            // confidence gate rejects any title TMDB knows more than once.
            const service = createService();

            const extras = await service.getExtras(stalkerItem);

            expect(enrichMovie).not.toHaveBeenCalled();
            expect(enrichTv).toHaveBeenCalledWith({
                title: 'Холод (10 серий)',
                originalTitle: 'Kholod',
                tmdbId: 318354,
                year: 2026,
            });
            expect(extras?.backdropUrl).toContain('/serial.jpg');
        });

        it('never carries the id into the other media type', async () => {
            // /movie/<tv id> resolves to an unrelated film whose details
            // would then be shown as this item's — so the retry drops it.
            enrichMovie.mockResolvedValue(null);
            const service = createService();

            await service.getExtras(plainVodItem);

            expect(enrichMovie).toHaveBeenCalledWith(
                expect.objectContaining({ tmdbId: 603, year: 1999 })
            );
            expect(enrichTv).toHaveBeenCalledWith(
                expect.objectContaining({ tmdbId: undefined, year: 1999 })
            );
        });

        it('does not retry a series as a movie', async () => {
            enrichTv.mockResolvedValue(null);
            const service = createService();

            await expect(service.getExtras(stalkerItem)).resolves.toBeNull();
            expect(enrichMovie).not.toHaveBeenCalled();
        });

        it('does not search for an entry that has no usable name', async () => {
            const service = createService();

            await expect(
                service.getExtras({
                    title: 'Unknown',
                    type: 'movie',
                    stalker_item: { id: '1' },
                } as unknown as DashboardHeroTmdbItem)
            ).resolves.toBeNull();
            expect(enrichMovie).not.toHaveBeenCalled();
            expect(enrichTv).not.toHaveBeenCalled();
        });

        it('keys same-titled items apart by the facts behind them', async () => {
            const service = createService();
            const remake = {
                ...stalkerItem,
                stalker_item: {
                    ...(stalkerItem.stalker_item as object),
                    info: {
                        name: 'Холод (10 серий)',
                        releasedate: '1984',
                    },
                },
            } as DashboardHeroTmdbItem;

            expect(service.keyFor(stalkerItem)).not.toBe(service.keyFor(remake));

            await service.getExtras(stalkerItem);
            await service.getExtras(remake);

            expect(enrichTv).toHaveBeenCalledTimes(2);
        });
    });
});
