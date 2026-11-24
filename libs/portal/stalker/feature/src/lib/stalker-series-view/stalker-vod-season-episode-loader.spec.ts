import { signal } from '@angular/core';
import type { VodSeriesSeasonVm } from '@iptvnator/portal/stalker/data-access';
import { StalkerVodSeasonEpisodeLoader } from './stalker-vod-season-episode-loader';

function season(id: string): VodSeriesSeasonVm {
    return {
        id,
        name: 'Synthetic Season',
        video_id: 'video-1',
        season_number: '1',
        episodes: [],
        isLoading: false,
        isExpanded: false,
    };
}

function setup() {
    const ownerKey = signal('series-a');
    const seasons = signal([season('season-a1'), season('season-a2')]);
    const fetchEpisodes = jest.fn<
        Promise<VodSeriesSeasonVm['episodes']>,
        [string, string, () => boolean]
    >();
    const loader = new StalkerVodSeasonEpisodeLoader({
        ownerKey,
        seasons,
        fetchEpisodes,
        logError: jest.fn(),
    });
    return { ownerKey, seasons, fetchEpisodes, loader };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('saved progress season loading', () => {
    it('continues the current series after an older request settles', async () => {
        const { ownerKey, seasons, fetchEpisodes, loader } = setup();
        let finishFirst!: (episodes: []) => void;
        fetchEpisodes
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishFirst = resolve))
            )
            .mockResolvedValue([]);
        loader.hydrateForSavedProgress(ownerKey());
        const oldRequestIsCurrent = fetchEpisodes.mock.calls[0][2];

        ownerKey.set('series-b');
        seasons.set([season('season-b1'), season('season-b2')]);
        loader.hydrateForSavedProgress(ownerKey());

        expect(oldRequestIsCurrent()).toBe(false);
        expect(fetchEpisodes).toHaveBeenCalledTimes(1);
        finishFirst([]);
        await settle();

        expect(fetchEpisodes.mock.calls.map(([, id]) => id)).toEqual([
            'season-a1',
            'season-b1',
            'season-b2',
        ]);
        expect(seasons().every((item) => item.episodesLoaded)).toBe(true);
    });

    it('retires the current request and stops loading seasons on destroy', async () => {
        const { ownerKey, seasons, fetchEpisodes, loader } = setup();
        let finishFirst!: (episodes: []) => void;
        fetchEpisodes.mockImplementationOnce(
            () => new Promise((resolve) => (finishFirst = resolve))
        );
        loader.hydrateForSavedProgress(ownerKey());
        const requestIsCurrent = fetchEpisodes.mock.calls[0][2];

        loader.destroy();
        expect(requestIsCurrent()).toBe(false);
        finishFirst([]);
        await settle();

        expect(fetchEpisodes).toHaveBeenCalledTimes(1);
        expect(seasons()[0].episodesLoaded).toBeUndefined();
    });

    it('skips a failed request during background loading and allows manual retry', async () => {
        const { ownerKey, seasons, fetchEpisodes, loader } = setup();
        fetchEpisodes
            .mockRejectedValueOnce(new Error('Synthetic portal failure'))
            .mockResolvedValue([]);
        loader.hydrateForSavedProgress(ownerKey());
        await settle();

        expect(fetchEpisodes.mock.calls.map(([, id]) => id)).toEqual([
            'season-a1',
            'season-a2',
        ]);
        expect(seasons()[0].episodesLoaded).toBeUndefined();
        await expect(loader.load(seasons()[0])).resolves.toBe(true);
        expect(seasons()[0].episodesLoaded).toBe(true);
    });
});
