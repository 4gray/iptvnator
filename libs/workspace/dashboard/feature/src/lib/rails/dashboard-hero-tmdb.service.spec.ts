import { TestBed } from '@angular/core/testing';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { DashboardHeroTmdbService } from './dashboard-hero-tmdb.service';

describe('DashboardHeroTmdbService', () => {
    const tvDetails = {
        id: 100,
        backdrop_path: '/serial.jpg',
        vote_average: 7.4,
        vote_count: 12,
        genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Comedy' }],
    };

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
        // Stalker embedded-series items are typed 'movie' in activity rows
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

    it('does not retry as TV when the movie lookup succeeds', async () => {
        enrichMovie.mockResolvedValue({ ...tvDetails, id: 200 });
        const service = createService();

        await service.getExtras({ title: 'Heat', type: 'movie' });

        expect(enrichTv).not.toHaveBeenCalled();
    });

    it('memoizes results per title and type', async () => {
        const service = createService();

        await service.getExtras({ title: 'The Boys', type: 'series' });
        await service.getExtras({ title: 'The Boys', type: 'series' });

        expect(enrichTv).toHaveBeenCalledTimes(1);
    });
});
