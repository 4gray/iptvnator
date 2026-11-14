import type { WritableSignal } from '@angular/core';
import { isExtrasSeason } from '@iptvnator/portal/shared/util';
import {
    getVodSeriesSeasonKey,
    isVodSeasonHydrationPending,
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
        seasonId: string,
        isCurrent: () => boolean
    ) => Promise<VodSeriesSeasonVm['episodes']>;
    readonly logError: (message: string, error: unknown) => void;
}

/** Lazy episode loads of Ministra VOD-series seasons (`is_series=1`). */
export class StalkerVodSeasonEpisodeLoader {
    private readonly loads = new Map<
        string,
        { season: VodSeriesSeasonVm; promise: Promise<boolean> }
    >();
    private hydrationOwnerKey: string | null = null;
    private hydrationInFlight = false;
    private destroyed = false;
    private readonly failedSeasons = new WeakSet<VodSeriesSeasonVm>();

    constructor(private readonly host: StalkerVodSeasonEpisodeLoaderHost) {}

    /**
     * Loads pending regular seasons sequentially when a lazy VOD series
     * has saved positions, so the picker and quick start can show progress.
     */
    hydrateForSavedProgress(ownerKey: string | null): void {
        this.hydrationOwnerKey = ownerKey;
        this.hydrateNextSeason();
    }

    destroy(): void {
        this.destroyed = true;
    }

    private hydrateNextSeason(): void {
        if (
            this.destroyed ||
            this.hydrationInFlight ||
            !this.hydrationOwnerKey ||
            this.hydrationOwnerKey !== this.host.ownerKey()
        ) {
            return;
        }
        const seasons = this.host.seasons();
        const hasRegularRun = seasons.some(
            (season) =>
                !isExtrasSeason(getVodSeriesSeasonKey(season), null) &&
                (season.episodes.length > 0 ||
                    isVodSeasonHydrationPending(season))
        );
        const nextSeason = seasons.find(
            (season) =>
                !this.failedSeasons.has(season) &&
                !(
                    hasRegularRun &&
                    isExtrasSeason(getVodSeriesSeasonKey(season), null)
                ) &&
                isVodSeasonHydrationPending(season)
        );
        if (!nextSeason) {
            return;
        }
        this.hydrationInFlight = true;
        void this.load(nextSeason).finally(() => {
            this.hydrationInFlight = false;
            this.hydrateNextSeason();
        });
    }

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
        if (this.destroyed) return Promise.resolve(false);
        const ownerKey = this.host.ownerKey();
        const key = JSON.stringify([
            ownerKey,
            season.video_id,
            season.id,
            getVodSeriesSeasonKey(season),
        ]);
        const inFlight = this.loads.get(key);
        if (inFlight && this.host.seasons().includes(inFlight.season)) {
            return inFlight.promise;
        }
        const seasons = this.host.seasons();
        const index = seasons.findIndex(
            (candidate) =>
                candidate.id === season.id &&
                candidate.video_id === season.video_id &&
                getVodSeriesSeasonKey(candidate) ===
                    getVodSeriesSeasonKey(season)
        );
        if (index === -1) return Promise.resolve(false);

        const updatedSeasons = [...seasons];
        const loadingSeason = { ...updatedSeasons[index], isLoading: true };
        updatedSeasons[index] = loadingSeason;
        this.host.seasons.set(updatedSeasons);
        // Only the exact loading VM owns this response. Navigation or
        // refresh can reuse provider ids while replacing the season list.
        const isCurrent = () =>
            !this.destroyed &&
            this.host.ownerKey() === ownerKey &&
            this.host.seasons().includes(loadingSeason);

        const load = this.fetch(loadingSeason, isCurrent)
            .then((updatedSeason) => {
                const current = this.host.seasons();
                const index = current.indexOf(loadingSeason);
                if (!isCurrent()) return false;
                const updated = [...current];
                updated[index] = updatedSeason;
                this.host.seasons.set(updated);
                return !this.failedSeasons.has(updatedSeason);
            })
            .finally(() => {
                if (this.loads.get(key)?.promise === load) {
                    this.loads.delete(key);
                }
            });
        this.loads.set(key, { season: loadingSeason, promise: load });
        return load;
    }

    private async fetch(
        season: VodSeriesSeasonVm,
        isCurrent: () => boolean
    ): Promise<VodSeriesSeasonVm> {
        try {
            const episodes = await this.host.fetchEpisodes(
                season.video_id,
                season.id,
                isCurrent
            );
            // An empty answer is also a loaded season.
            return {
                ...season,
                episodes,
                episodesLoaded: true,
                isLoading: false,
            };
        } catch (error) {
            if (isCurrent())
                this.host.logError('Failed to load episodes', error);
            const failedSeason = { ...season, isLoading: false };
            this.failedSeasons.add(failedSeason);
            return failedSeason;
        }
    }
}
