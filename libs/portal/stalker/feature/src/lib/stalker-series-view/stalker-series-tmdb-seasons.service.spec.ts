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
});
