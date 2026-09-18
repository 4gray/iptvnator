import type { VodSeriesSeasonVm } from './stalker-series.adapters';
import { getVodSeriesSeasonKey } from './stalker-series.adapters';

/**
 * True for a lazy VOD season the portal has never answered for. A season
 * that answered with zero episodes is loaded-and-empty, not pending —
 * treating it as pending would keep series labels countless forever and
 * make every series toggle re-fetch it.
 */
export function isVodSeasonHydrationPending(
    season: VodSeriesSeasonVm
): boolean {
    return season.episodes.length === 0 && !season.episodesLoaded;
}

export type VodSeasonLoadState = 'loading' | 'unloaded';

/**
 * Per-season load state for the fullscreen episode panel, keyed like the
 * season container's map: `loading` while a request is on the wire,
 * `unloaded` while the portal has not answered — after a failed request too,
 * where the panel offers a retry. Loaded seasons are absent.
 */
export function getVodSeasonLoadStates(
    seasons: readonly VodSeriesSeasonVm[]
): Record<string, VodSeasonLoadState> {
    const states: Record<string, VodSeasonLoadState> = {};
    for (const season of seasons) {
        if (season.isLoading) {
            states[getVodSeriesSeasonKey(season)] = 'loading';
        } else if (isVodSeasonHydrationPending(season)) {
            states[getVodSeriesSeasonKey(season)] = 'unloaded';
        }
    }
    return states;
}
