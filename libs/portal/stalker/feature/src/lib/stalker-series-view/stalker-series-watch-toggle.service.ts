import { Injectable, Signal, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
    createLogger,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import {
    isVodSeasonHydrationPending,
    StalkerStore,
    type StalkerSelectedVodItem,
    type VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    buildSeriesWatchToggleRequest,
    type SeasonContainerPlaybackToggleRequest,
    type SeasonContainerSeasonPlaybackToggleRequest,
    type SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { toStalkerSeriesId } from './stalker-series-id';
import { StalkerSeriesPositionsService } from './stalker-series-positions.service';
import {
    runStalkerWatchToggleBatch,
    SEASON_WATCH_FEEDBACK,
    SERIES_WATCH_FEEDBACK,
    type StalkerWatchToggleFeedback,
} from './stalker-series-watch-batch';

interface StalkerSeriesWatchToggleBindings {
    readonly displayItem: Signal<StalkerSelectedVodItem | null>;
    /** `playlist:series` of the series on screen. */
    readonly currentSeriesKey: Signal<string>;
    readonly isVodSeries: Signal<boolean>;
    readonly vodSeriesSeasons: Signal<VodSeriesSeasonVm[]>;
    readonly mappedSeasons: Signal<Record<string, XtreamSerieEpisode[]>>;
    /** Episodes playing or launching, which a series toggle never marks. */
    readonly excludedEpisodeIds: () => ReadonlySet<number>;
    /** Resolves true when the portal answered, false when the request failed. */
    readonly loadEpisodesForSeason: (
        season: VodSeriesSeasonVm
    ) => Promise<boolean>;
}

/**
 * Watched toggles of the Stalker series view: one episode, a season or the
 * whole series (which also backs "Reset progress"). Component-scoped
 * (provide it in the component's `providers`).
 */
@Injectable()
export class StalkerSeriesWatchToggleService {
    private readonly stalkerStore = inject(StalkerStore);
    private readonly positions = inject(StalkerSeriesPositionsService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    // Optional: absent in collection-detail mounts outside the catalog.
    private readonly catalogFacade = inject(StalkerCatalogFacadeService, {
        optional: true,
    });
    private readonly logger = createLogger('StalkerSeriesView');
    private readonly bindings = signal<StalkerSeriesWatchToggleBindings | null>(
        null
    );
    readonly seasonWatchBatchRunning = signal(false);
    /**
     * The episode chosen while a watched/reset batch still rewrote the rows
     * a start resumes from; the last choice plays once the batch settled,
     * and only on the series it was made for.
     */
    private choiceHeldForBatch: {
        readonly seriesKey: string;
        readonly play: () => void;
    } | null = null;

    bind(bindings: StalkerSeriesWatchToggleBindings): void {
        this.bindings.set(bindings);
    }

    /** Holds `play` until the running batch settled, replacing an earlier choice. */
    holdChoice(play: () => void): void {
        this.choiceHeldForBatch = {
            seriesKey: this.currentSeriesKey(),
            play,
        };
    }

    async handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!playlistId) {
            return;
        }

        if (request.nextPosition) {
            await this.positions.persistSeriesPosition(
                playlistId,
                request.nextPosition
            );
        } else {
            await this.positions.clearSeriesPosition(
                playlistId,
                request.contentXtreamId
            );
        }
        // Keep the catalog grid's progress badge in sync (ownership-checked
        // inside the facade; no-op outside the catalog context). A failed
        // refresh keeps the cache populated-but-stale.
        await this.catalogFacade
            ?.refreshPositions(playlistId)
            .catch((error: unknown) =>
                this.logger.warn('Catalog position refresh failed', error)
            );
    }

    async handleSeasonPlaybackToggleRequested(
        request: SeasonContainerSeasonPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (
            !playlistId ||
            request.requests.length === 0 ||
            this.seasonWatchBatchRunning()
        ) {
            return;
        }
        // The mutation context already keeps a stale batch out of the next
        // series' state; the snackbars need the same ownership so feedback
        // for the old season is not presented on a newly opened page.
        const seriesXtreamId = this.shownSeriesId();
        const stillCurrent = () =>
            this.stalkerStore.currentPlaylist()?._id === playlistId &&
            this.shownSeriesId() === seriesXtreamId;

        this.seasonWatchBatchRunning.set(true);
        try {
            await this.runWatchToggleBatch(
                request,
                playlistId,
                stillCurrent,
                SEASON_WATCH_FEEDBACK
            );
        } finally {
            this.endWatchBatch();
        }
    }

    async handleSeriesPlaybackToggleRequested(
        request: SeasonContainerSeriesPlaybackToggleRequest
    ): Promise<void> {
        const bindings = this.bindings();
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!bindings || !playlistId || this.seasonWatchBatchRunning()) {
            return;
        }
        const pendingSeasons = bindings.isVodSeries()
            ? bindings
                  .vodSeriesSeasons()
                  .filter((season) => isVodSeasonHydrationPending(season))
            : [];
        // An empty request is only meaningful when unloaded seasons remain:
        // every loaded episode is watched, so the container could not build
        // a target list, but hydration below may still surface unwatched
        // episodes to mark.
        if (request.requests.length === 0 && pendingSeasons.length === 0) {
            return;
        }

        const seriesXtreamId = this.shownSeriesId();
        const stillCurrent = () =>
            this.stalkerStore.currentPlaylist()?._id === playlistId &&
            this.shownSeriesId() === seriesXtreamId;

        this.seasonWatchBatchRunning.set(true);
        try {
            let effective: SeasonContainerSeriesPlaybackToggleRequest | null =
                request;
            if (pendingSeasons.length > 0) {
                const hydrated = await this.hydrateSeasonsForSeriesToggle(
                    bindings,
                    pendingSeasons,
                    stillCurrent
                );
                if (hydrated !== 'complete') {
                    if (hydrated === 'failed' && stillCurrent()) {
                        this.notifySeasonWatchToggle(
                            SERIES_WATCH_FEEDBACK.failed
                        );
                    }
                    return;
                }
                // The reconcile effect only flushes on the next change-
                // detection tick; rebuild the maps synchronously so the
                // batch below sees the hydrated episodes' scoped and legacy
                // rows (see applyReconciledSeriesPositions).
                this.positions.applyReconciledSeriesPositions();
                effective = buildSeriesWatchToggleRequest({
                    seasons: bindings.mappedSeasons(),
                    seriesId: seriesXtreamId,
                    playlistId,
                    isEpisodeWatched: (episode) =>
                        isPortalPlaybackWatched(
                            this.positions
                                .episodePlaybackPositions()
                                .get(Number(episode.id))
                        ),
                    excludedEpisodeIds: bindings.excludedEpisodeIds(),
                    // Keep the direction the user clicked; re-inference over
                    // the now-complete data could flip a "mark" into an
                    // unwatch when everything turned out watched.
                    markWatched: request.markWatched,
                });
                if (!effective) {
                    if (stillCurrent()) {
                        this.notifySeasonWatchToggle(
                            SERIES_WATCH_FEEDBACK.marked,
                            { count: 0 }
                        );
                    }
                    return;
                }
            }

            await this.runWatchToggleBatch(
                effective,
                playlistId,
                stillCurrent,
                SERIES_WATCH_FEEDBACK
            );
        } finally {
            this.endWatchBatch();
        }
    }

    private currentSeriesKey(): string {
        return this.bindings()?.currentSeriesKey() ?? '';
    }

    private shownSeriesId(): number {
        return toStalkerSeriesId(this.bindings()?.displayItem()?.id ?? 0);
    }

    /**
     * The batch settled: the choice held meanwhile goes through the usual
     * gates, unless the viewer switched series since. Episode identities
     * overlap across series, so it must never resolve against another one.
     */
    private endWatchBatch(): void {
        this.seasonWatchBatchRunning.set(false);
        const held = this.choiceHeldForBatch;
        this.choiceHeldForBatch = null;
        if (held && held.seriesKey === this.currentSeriesKey()) {
            held.play();
        }
    }

    /**
     * Sequential on purpose: loadEpisodesForSeason snapshots the season VM
     * array before its writes, so concurrent calls clobber each other's
     * loading flags; and one request at a time keeps the portal load bounded.
     */
    private async hydrateSeasonsForSeriesToggle(
        bindings: StalkerSeriesWatchToggleBindings,
        pendingSeasons: readonly VodSeriesSeasonVm[],
        stillCurrent: () => boolean
    ): Promise<'complete' | 'failed' | 'superseded'> {
        for (const season of pendingSeasons) {
            // A tab click may have loaded this season meanwhile.
            const current = bindings
                .vodSeriesSeasons()
                .find((candidate) => candidate.id === season.id);
            if (!current || !isVodSeasonHydrationPending(current)) {
                continue;
            }
            const answered = await bindings.loadEpisodesForSeason(current);
            if (!stillCurrent()) {
                return 'superseded';
            }
            if (!answered) {
                return 'failed';
            }
        }
        return 'complete';
    }

    private runWatchToggleBatch(
        request: SeasonContainerSeriesPlaybackToggleRequest,
        playlistId: string,
        stillCurrent: () => boolean,
        feedback: StalkerWatchToggleFeedback
    ): Promise<void> {
        return runStalkerWatchToggleBatch({
            request,
            playlistId,
            stillCurrent,
            feedback,
            persist: (id, position) =>
                this.positions.persistSeriesPosition(id, position),
            clear: (id, contentXtreamId) =>
                this.positions.clearSeriesPosition(id, contentXtreamId),
            refreshCatalogPositions: (id) =>
                this.catalogFacade
                    ?.refreshPositions(id)
                    .catch((error: unknown) =>
                        this.logger.warn(
                            'Catalog position refresh failed',
                            error
                        )
                    ),
            notify: (key, params) => this.notifySeasonWatchToggle(key, params),
            logger: this.logger,
        });
    }

    private notifySeasonWatchToggle(key: string, params?: object): void {
        this.snackBar.open(
            this.translateService.instant(key, params),
            undefined,
            { duration: 5000 }
        );
    }
}
