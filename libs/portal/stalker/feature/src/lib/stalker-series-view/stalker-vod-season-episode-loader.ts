import type { WritableSignal } from '@angular/core';
import {
    getVodSeriesSeasonKey,
    type VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';

/** What the loader needs from the page that shows the seasons. */
export interface StalkerVodSeasonEpisodeLoaderHost {
    /** Seasons of the series on screen; a load writes its loading flag and episodes here. */
    readonly seasons: WritableSignal<VodSeriesSeasonVm[]>;
    /** Identity of the series on screen: part of the key in-flight loads are shared by. */
    readonly ownerKey: () => string;
    readonly fetchEpisodes: (
        videoId: string,
        seasonId: string
    ) => Promise<VodSeriesSeasonVm['episodes']>;
    readonly logError: (message: string, error: unknown) => void;
}

/** Lazy episode loads of Ministra VOD-series seasons (`is_series=1`). */
export class StalkerVodSeasonEpisodeLoader {
    private readonly loads = new Map<
        string,
        { season: VodSeriesSeasonVm; promise: Promise<boolean> }
    >();

    constructor(private readonly host: StalkerVodSeasonEpisodeLoaderHost) {}

    /**
     * Loads episodes for a specific VOD season.
     *
     * Single-flight per season: a tab click, the spillover prefetch, the
     * quick-start recursion, and the series-toggle hydration can all ask for
     * the same season — a second concurrent request would duplicate portal
     * traffic, and its failure could abort a series toggle whose original
     * request succeeded.
     */
    /** Resolves true when the portal answered, false when the request failed. */
    load(season: VodSeriesSeasonVm): Promise<boolean> {
        const key = JSON.stringify([
            this.host.ownerKey(),
            season.video_id,
            season.id,
            getVodSeriesSeasonKey(season),
        ]);
        const inFlight = this.loads.get(key);
        if (inFlight && this.host.seasons().includes(inFlight.season)) {
            return inFlight.promise;
        }
        const load = this.fetch(season).finally(() => {
            if (this.loads.get(key)?.promise === load) {
                this.loads.delete(key);
            }
        });
        const loadingSeason = this.host
            .seasons()
            .find(
                (candidate) =>
                    candidate.id === season.id &&
                    candidate.video_id === season.video_id
            );
        if (loadingSeason) {
            this.loads.set(key, {
                season: loadingSeason,
                promise: load,
            });
        }
        return load;
    }

    private async fetch(season: VodSeriesSeasonVm): Promise<boolean> {
        // Set loading state in local signal
        const seasons = this.host.seasons();
        const index = seasons.findIndex(
            (s) =>
                s.id === season.id &&
                s.video_id === season.video_id &&
                getVodSeriesSeasonKey(s) === getVodSeriesSeasonKey(season)
        );
        if (index === -1) return false;

        const updatedSeasons = [...seasons];
        const loadingSeason = { ...updatedSeasons[index], isLoading: true };
        updatedSeasons[index] = loadingSeason;
        this.host.seasons.set(updatedSeasons);

        try {
            const episodes = await this.host.fetchEpisodes(
                season.video_id,
                season.id
            );

            // Update with loaded episodes
            const newSeasons = [...this.host.seasons()];
            // Only the exact loading VM owns this response. A navigation or
            // refresh can reuse provider ids while replacing the season list.
            const newIndex = newSeasons.indexOf(loadingSeason);
            if (newIndex !== -1) {
                newSeasons[newIndex] = {
                    ...newSeasons[newIndex],
                    episodes: episodes,
                    // Even an EMPTY answer marks the season loaded: the
                    // portal spoke, so it must stop counting as "unloaded"
                    // (label/verdict gating and series-toggle hydration).
                    episodesLoaded: true,
                    isLoading: false,
                };
                this.host.seasons.set(newSeasons);
            }
            return newIndex !== -1;
        } catch (error) {
            this.host.logError('Failed to load episodes', error);
            const newSeasons = [...this.host.seasons()];
            const newIndex = newSeasons.indexOf(loadingSeason);
            if (newIndex !== -1) {
                newSeasons[newIndex] = {
                    ...newSeasons[newIndex],
                    isLoading: false,
                };
                this.host.seasons.set(newSeasons);
            }
            return false;
        }
    }
}
