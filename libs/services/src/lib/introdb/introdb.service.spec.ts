import { TestBed } from '@angular/core/testing';
import type { IntroDbEpisodeSegments } from '@iptvnator/shared/interfaces';
import { TmdbApiService } from '../tmdb/tmdb-api.service';
import { TmdbRuntimeService } from '../tmdb/tmdb-runtime.service';
import { IntroDbService, type IntroDbEpisodeLookup } from './introdb.service';
import { searchTvMazeImdbId } from './tvmaze-imdb-lookup';

jest.mock('./tvmaze-imdb-lookup', () => ({
    searchTvMazeImdbId: jest.fn(),
}));

const segments: IntroDbEpisodeSegments = {
    intro: { startSeconds: 60, endSeconds: 110 },
    recap: null,
    outro: null,
};

describe('IntroDbService', () => {
    const tvMaze = searchTvMazeImdbId as jest.MockedFunction<
        typeof searchTvMazeImdbId
    >;
    let getIntroDbSegments: jest.Mock;
    let getTvExternalIds: jest.Mock;
    let tmdbEnabled: boolean;
    let service: IntroDbService;

    const lookup = (
        overrides: Partial<IntroDbEpisodeLookup> = {}
    ): IntroDbEpisodeLookup => ({
        tmdbId: 1396,
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 2,
        ...overrides,
    });

    beforeEach(() => {
        tvMaze.mockReset().mockResolvedValue('tt0903747');
        getIntroDbSegments = jest.fn().mockResolvedValue(segments);
        getTvExternalIds = jest
            .fn()
            .mockResolvedValue({ id: 1396, imdb_id: 'tt0903747' });
        tmdbEnabled = true;
        (window as unknown as { electron: unknown }).electron = {
            getIntroDbSegments,
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: TmdbApiService, useValue: { getTvExternalIds } },
                {
                    provide: TmdbRuntimeService,
                    useValue: {
                        isEnabled: () => tmdbEnabled,
                        apiKey: () => 'tmdb-test-key',
                    },
                },
            ],
        });
        service = TestBed.inject(IntroDbService);
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('resolves the IMDb id through TMDB and asks the main process', async () => {
        await expect(service.getEpisodeSegments(lookup())).resolves.toBe(
            segments
        );

        expect(getTvExternalIds).toHaveBeenCalledWith(1396, 'tmdb-test-key');
        expect(tvMaze).not.toHaveBeenCalled();
        expect(getIntroDbSegments).toHaveBeenCalledWith({
            imdbId: 'tt0903747',
            seasonNumber: 1,
            episodeNumber: 2,
        });
    });

    it('falls back to TVmaze when TMDB is off or knows no IMDb id', async () => {
        tmdbEnabled = false;
        await service.getEpisodeSegments(lookup());
        expect(getTvExternalIds).not.toHaveBeenCalled();
        expect(tvMaze).toHaveBeenCalledWith('Breaking Bad');

        tmdbEnabled = true;
        getTvExternalIds.mockResolvedValue({ id: 99, imdb_id: null });
        await service.getEpisodeSegments(lookup({ tmdbId: 99 }));
        expect(tvMaze).toHaveBeenCalledTimes(2);
    });

    it('remembers answers but asks again after a miss', async () => {
        await service.getEpisodeSegments(lookup());
        await service.getEpisodeSegments(lookup());
        expect(getTvExternalIds).toHaveBeenCalledTimes(1);
        expect(getIntroDbSegments).toHaveBeenCalledTimes(1);

        getIntroDbSegments.mockResolvedValue(null);
        await service.getEpisodeSegments(lookup({ episodeNumber: 3 }));
        await service.getEpisodeSegments(lookup({ episodeNumber: 3 }));
        expect(getIntroDbSegments).toHaveBeenCalledTimes(3);
    });

    it('does nothing without the Electron bridge or a usable episode', async () => {
        await expect(
            service.getEpisodeSegments(lookup({ seasonNumber: 0 }))
        ).resolves.toBeNull();

        delete (window as unknown as { electron?: unknown }).electron;
        expect(service.isAvailable).toBe(false);
        await expect(service.getEpisodeSegments(lookup())).resolves.toBeNull();

        expect(getTvExternalIds).not.toHaveBeenCalled();
        expect(tvMaze).not.toHaveBeenCalled();
    });
});
