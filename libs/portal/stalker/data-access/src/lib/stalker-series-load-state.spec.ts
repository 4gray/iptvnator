import type { VodSeriesSeasonVm } from './stalker-series.adapters';
import {
    getVodSeasonLoadStates,
    isVodSeasonHydrationPending,
} from './stalker-series-load-state';

function season(
    key: string,
    overrides: Partial<VodSeriesSeasonVm> = {}
): VodSeriesSeasonVm {
    return {
        id: `id-${key}`,
        video_id: 'v1',
        name: `Season ${key}`,
        season_number: key,
        episodes: [],
        isLoading: false,
        isExpanded: false,
        episodesLoaded: false,
        ...overrides,
    } as VodSeriesSeasonVm;
}

describe('stalker series load state', () => {
    it('reports in-flight, unanswered and loaded seasons for the fullscreen panel', () => {
        const states = getVodSeasonLoadStates([
            season('1', {
                episodes: [{ id: 'e1' } as never],
                episodesLoaded: true,
            }),
            season('2', { isLoading: true }),
            season('3'),
            // Answered with nothing: loaded-and-empty, not pending.
            season('4', { episodesLoaded: true }),
        ]);

        expect(states).toEqual({ '2': 'loading', '3': 'unloaded' });
    });

    it('treats an answered empty season as hydrated', () => {
        expect(isVodSeasonHydrationPending(season('1'))).toBe(true);
        expect(
            isVodSeasonHydrationPending(season('1', { episodesLoaded: true }))
        ).toBe(false);
    });
});
