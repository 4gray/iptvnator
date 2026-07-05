import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import type { TmdbTrendingEntry } from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { DashboardTrendingService } from './dashboard-trending.service';

describe('DashboardTrendingService', () => {
    const entry = (
        overrides: Partial<TmdbTrendingEntry> = {}
    ): TmdbTrendingEntry => ({
        tmdbId: 603,
        mediaType: 'movie',
        title: 'The Matrix',
        year: 1999,
        posterUrl: null,
        rating: '8.2',
        popularity: 100,
        ...overrides,
    });

    const match = (
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle: 'The Matrix',
        playlistId: 'pl-1',
        playlistName: 'My Portal',
        categoryId: 7,
        xtreamId: 42,
        type: 'movie',
        trailingYear: null,
        ...overrides,
    });

    let getTrendingWeek: jest.Mock;
    let matchTitles: jest.Mock;
    let isEnabled: jest.Mock;

    function createService(
        options: { matchingAvailable?: boolean } = {}
    ): DashboardTrendingService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled, getTrendingWeek },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: {
                        isAvailable: options.matchingAvailable ?? true,
                        matchTitles,
                    },
                },
            ],
        });
        return TestBed.inject(DashboardTrendingService);
    }

    beforeEach(() => {
        isEnabled = jest.fn().mockReturnValue(true);
        getTrendingWeek = jest.fn().mockResolvedValue([entry()]);
        matchTitles = jest.fn().mockResolvedValue([match()]);
    });

    it('does nothing when TMDB is disabled', async () => {
        isEnabled.mockReturnValue(false);
        const service = createService();

        await service.load();

        expect(getTrendingWeek).not.toHaveBeenCalled();
        expect(service.items()).toEqual([]);
    });

    it('does nothing without the Electron title matcher (PWA)', async () => {
        const service = createService({ matchingAvailable: false });

        await service.load();

        expect(getTrendingWeek).not.toHaveBeenCalled();
    });

    it('attaches library matches to trending entries', async () => {
        const service = createService();

        await service.load();

        expect(service.items()).toHaveLength(1);
        expect(service.items()[0].match?.playlistName).toBe('My Portal');
        expect(service.loading()).toBe(false);
    });

    it('rejects year-incompatible base-tier matches', async () => {
        getTrendingWeek.mockResolvedValue([
            entry({ title: 'Blade Runner', year: 1982 }),
        ]);
        matchTitles.mockResolvedValue([
            match({ queryTitle: 'Blade Runner', trailingYear: 2049 }),
        ]);
        const service = createService();

        await service.load();

        expect(service.items()[0].match).toBeNull();
    });

    it('loads only once per session', async () => {
        const service = createService();

        await service.load();
        await service.load();

        expect(getTrendingWeek).toHaveBeenCalledTimes(1);
    });
});
