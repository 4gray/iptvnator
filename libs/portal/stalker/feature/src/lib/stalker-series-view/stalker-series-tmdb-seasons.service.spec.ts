import { TestBed } from '@angular/core/testing';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { StalkerSeriesTmdbSeasonsService } from './stalker-series-tmdb-seasons.service';

describe('StalkerSeriesTmdbSeasonsService', () => {
    let service: StalkerSeriesTmdbSeasonsService;
    let getSeason: jest.Mock;

    const episodesOfSeason = (season: number): XtreamSerieEpisode[] => [
        {
            id: `${season}-1`,
            episode_num: 1,
            season,
            title: 'Episode 1',
        } as unknown as XtreamSerieEpisode,
    ];

    beforeEach(() => {
        getSeason = jest.fn().mockResolvedValue({
            overview: 'Season overview',
            episodes: [{ episode_number: 1, name: 'The Marshal' }],
        });
        TestBed.configureTestingModule({
            providers: [
                StalkerSeriesTmdbSeasonsService,
                {
                    provide: TmdbEnrichmentService,
                    useValue: { getSeason },
                },
            ],
        });
        service = TestBed.inject(StalkerSeriesTmdbSeasonsService);
    });

    it('fetches the title-marked season for a renumbered single-season slice', async () => {
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });

        expect(getSeason).toHaveBeenCalledWith(82856, 2);

        // Overlay still keys by the provider's season key
        const overlaid = service.overlay(
            { '1': episodesOfSeason(1) },
            82856
        );
        expect(overlaid['1'][0].title).toBe('The Marshal');
    });

    it('keeps provider numbering for multi-season items despite a marker', async () => {
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 3,
        });

        expect(getSeason).toHaveBeenCalledWith(82856, 1);
    });

    it('keeps provider numbering without fetch context', async () => {
        await service.fetchSeason(82856, '1', episodesOfSeason(1));

        expect(getSeason).toHaveBeenCalledWith(82856, 1);
    });

    it('skips a repeat fetch for the same resolved season', async () => {
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });

        expect(getSeason).toHaveBeenCalledTimes(1);
    });

    it('refetches when the same provider key resolves to another season', async () => {
        getSeason.mockResolvedValueOnce({
            overview: 'Season 2 overview',
            episodes: [{ episode_number: 1, name: 'Season 2 Episode' }],
        });
        // Per-season slices of ONE show share (tmdbId, provider key "1")
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });
        expect(getSeason).toHaveBeenCalledWith(82856, 2);

        getSeason.mockResolvedValueOnce({
            overview: 'Season 3 overview',
            episodes: [{ episode_number: 1, name: 'Season 3 Episode' }],
        });
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (3 сезон)',
            seasonCount: 1,
        });
        expect(getSeason).toHaveBeenCalledWith(82856, 3);

        // The newer resolution overwrote the entry under the shared key
        const overlaid = service.overlay({ '1': episodesOfSeason(1) }, 82856);
        expect(overlaid['1'][0].title).toBe('Season 3 Episode');
        expect(service.descriptions(82856)['1']).toBe('Season 3 overview');
    });

    it('drops the stale entry when a replacement fetch fails', async () => {
        getSeason.mockResolvedValueOnce({
            overview: 'Season 2 overview',
            episodes: [{ episode_number: 1, name: 'Season 2 Episode' }],
        });
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });

        // Replacement resolution (another slice of the show) fails —
        // the season-2 entry must not stay on screen for the new slice
        getSeason.mockResolvedValueOnce(null);
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (3 сезон)',
            seasonCount: 1,
        });

        const overlaid = service.overlay({ '1': episodesOfSeason(1) }, 82856);
        expect(overlaid['1'][0].title).toBe('Episode 1');
        expect(service.descriptions(82856)).toEqual({});

        // A later trigger retries and fills the correct season
        getSeason.mockResolvedValueOnce({
            overview: 'Season 3 overview',
            episodes: [{ episode_number: 1, name: 'Season 3 Episode' }],
        });
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (3 сезон)',
            seasonCount: 1,
        });
        const healed = service.overlay({ '1': episodesOfSeason(1) }, 82856);
        expect(healed['1'][0].title).toBe('Season 3 Episode');
    });

    it('does not cache a failed fetch, so a later trigger retries', async () => {
        getSeason.mockResolvedValueOnce(null);
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });
        await service.fetchSeason(82856, '1', episodesOfSeason(1), {
            rawTitle: 'Мандалорец (2 сезон)',
            seasonCount: 1,
        });

        expect(getSeason).toHaveBeenCalledTimes(2);
        const overlaid = service.overlay({ '1': episodesOfSeason(1) }, 82856);
        expect(overlaid['1'][0].title).toBe('The Marshal');
    });
});
