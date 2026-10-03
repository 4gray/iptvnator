import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    createLogger,
    formatSeriesEpisodeCode,
    type SeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type ExternalPlayerName,
    type PlayerContentInfo,
    type ResolvedPortalPlayback,
    type XtreamCategory,
    type XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    buildSeriesMenuSections,
    SERIES_MENU_ACTION,
    type SeasonContainerComponent,
    type VodMoreMenuSection,
} from '@iptvnator/ui/components';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

interface SerialDetailsMenuBindings {
    readonly selectedItem: Signal<XtreamSerieDetailsView | null>;
    readonly quickStart: Signal<SeriesQuickStartAction | null>;
    readonly seasonContainer: Signal<SeasonContainerComponent | undefined>;
    /** The route's category id; the name comes from the store's list. */
    readonly categoryId: Signal<string>;
    readonly episodePositions: Signal<ReadonlyMap<number, unknown>>;
    /** An episode plays or launches: its next tick would undo a reset. */
    readonly playbackActive: Signal<boolean>;
    /** A forced launch has not published its session yet: bulk watched actions would include it. */
    readonly startPending: Signal<boolean>;
    readonly resetProgress: () => Promise<void>;
    /** Series and visit on screen; a launch's failure is reported to that page only. */
    readonly pageToken: () => string;
    /** The regular episode start forced to MPV/VLC, so history and the launch position are recorded. */
    readonly openEpisodeExternally: (
        episode: XtreamSerieEpisode,
        player: ExternalPlayerName
    ) => Promise<unknown> | void;
}

/**
 * The "…" menu of the Xtream series page: season and series watched toggles
 * and the season download (driven through the season container's
 * presenters), reset progress, external player and stream URL of the next
 * episode, the category and Continue Watching.
 */
@Injectable()
export class SerialDetailsMenuService {
    private readonly xtreamStore = inject(XtreamStore);
    /** Optional: hosts without the data source simply get no history row. */
    private readonly dataSource = inject(XTREAM_DATA_SOURCE, {
        optional: true,
    });
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('SerialDetailsMenu');
    private readonly bindings = signal<SerialDetailsMenuBindings | null>(null);

    bind(bindings: SerialDetailsMenuBindings): void {
        this.bindings.set(bindings);
        // The recently viewed list tells whether "Hide from Continue
        // Watching" applies; the catalog does not load it on its own.
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (playlistId) {
            this.xtreamStore.loadRecentItems({ id: playlistId });
        }
    }

    readonly externalPlayer = computed<ExternalPlayerName>(() =>
        this.settingsStore.player() === VideoPlayer.VLC ? 'vlc' : 'mpv'
    );

    private readonly seriesId = computed(() =>
        Number(this.bindings()?.selectedItem()?.series_id ?? 0)
    );

    /**
     * The episode the menu's rows act on. A completed series has a quick
     * start too, a disabled one naming the last episode: nothing to launch
     * or copy there.
     */
    private readonly startableQuickStart = computed(() => {
        const quickStart = this.bindings()?.quickStart() ?? null;
        return quickStart && !quickStart.disabled ? quickStart : null;
    });

    /** Any episode with a saved position: "Reset progress" applies. */
    private readonly hasProgress = computed(
        () => (this.bindings()?.episodePositions().size ?? 0) > 0
    );

    private readonly category = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.bindings()?.categoryId() ?? '';
        if (!categoryId) {
            return null;
        }
        const categories =
            this.xtreamStore.serialCategories() as ReadonlyArray<{
                category_id?: string | number;
                category_name?: string;
            }>;
        const found = categories.find(
            (candidate) => String(candidate.category_id) === categoryId
        );
        return {
            category_id: String(found?.category_id ?? categoryId),
            category_name: found?.category_name,
        };
    });

    /** Whether the series row sits in this playlist's recently viewed list. */
    private readonly inContinueWatching = computed(() => {
        const seriesId = this.seriesId();
        if (!seriesId || !this.dataSource) {
            return false;
        }
        // Xtream ids collide across live, movies and series: the row has to
        // be the series' own.
        return (
            this.hasProgress() &&
            this.xtreamStore
                .recentItems()
                .some(
                    (item) =>
                        item.type === 'series' &&
                        Number(item.xtream_id) === seriesId
                )
        );
    });

    readonly sections = computed<VodMoreMenuSection[]>(() => {
        const container = this.bindings()?.seasonContainer();
        const watch = container?.watchPresenter;
        const download = container?.downloadPresenter;
        const quickStart = this.startableQuickStart();
        const category = this.category();
        const episodeCode = quickStart
            ? formatSeriesEpisodeCode(
                  quickStart.episode.season,
                  quickStart.episode.episode_num
              )
            : null;
        return buildSeriesMenuSections({
            seasonWatchVisible: watch?.seasonWatchToggleVisible() ?? false,
            seasonFullyWatched: watch?.selectedSeasonFullyWatched() ?? false,
            seasonEligibleCount: watch?.seasonWatchEligibleCount() ?? 0,
            seasonActionDisabled:
                (this.bindings()?.startPending() ?? false) ||
                (container?.seasonWatchBatchRunning() ?? false) ||
                (!(watch?.selectedSeasonFullyWatched() ?? false) &&
                    (watch?.seasonWatchEligibleCount() ?? 0) === 0),
            seriesMenuVisible: watch?.seriesMenuVisible() ?? false,
            seriesFullyWatched: watch?.seriesFullyWatched() ?? false,
            seriesEligibleCount: watch?.seriesWatchEligibleCount() ?? 0,
            seriesCountKnown: watch?.seriesCountKnown() ?? true,
            seriesActionDisabled:
                (this.bindings()?.startPending() ?? false) ||
                (watch?.seriesActionDisabled() ?? true),
            hasProgress: this.hasProgress(),
            playbackActive: this.bindings()?.playbackActive() ?? false,
            startPending: this.bindings()?.startPending() ?? false,
            watchBatchRunning: container?.seasonWatchBatchRunning() ?? false,
            sourcesCount: 0,
            externalPlayerHint:
                quickStart && this.runtime.supportsManagedExternalPlayers
                    ? this.externalPlayer() === 'vlc'
                        ? 'VLC'
                        : 'MPV'
                    : null,
            copyUrlEpisodeCode: episodeCode,
            downloadVisible: download?.presentationVisible() ?? false,
            downloadCount: download?.eligibleEpisodeCount() ?? 0,
            downloadDisabled: download?.seasonDisabled() ?? true,
            downloadBusy: download?.batchRunning() ?? false,
            categoryName: category?.category_name ?? null,
            inContinueWatching: this.inContinueWatching(),
        });
    });

    async run(actionId: string): Promise<void> {
        const container = this.bindings()?.seasonContainer();
        switch (actionId) {
            case SERIES_MENU_ACTION.SeasonWatched:
                container?.watchPresenter.toggleSeasonWatched();
                return;
            case SERIES_MENU_ACTION.SeriesWatched:
                container?.watchPresenter.toggleSeriesWatched();
                return;
            case SERIES_MENU_ACTION.ResetProgress:
                await this.bindings()?.resetProgress();
                return;
            case SERIES_MENU_ACTION.DownloadSeason:
                await container?.downloadPresenter.enqueueSeason();
                return;
            case SERIES_MENU_ACTION.ExternalPlayer:
                await this.openExternal();
                return;
            case SERIES_MENU_ACTION.CopyUrl:
                await this.copyStreamUrl();
                return;
            case SERIES_MENU_ACTION.ShowInCategory:
                this.showInCategory();
                return;
            case SERIES_MENU_ACTION.HideFromContinueWatching:
                await this.hideFromContinueWatching();
                return;
        }
    }

    /** The next episode, resolved the way the inline player would play it. */
    private buildEpisodePlayback(): ResolvedPortalPlayback | null {
        const quickStart = this.startableQuickStart();
        const item = this.bindings()?.selectedItem();
        const playlist = this.xtreamStore.currentPlaylist();
        if (!quickStart || !item || !playlist) {
            return null;
        }
        const episode = quickStart.episode;
        const contentInfo: PlayerContentInfo = {
            playlistId: playlist.id,
            contentXtreamId: Number(episode.id),
            contentType: 'episode',
            seriesXtreamId: Number(item.series_id),
            seasonNumber: Number(episode.season),
            episodeNumber: Number(episode.episode_num),
        };
        return {
            streamUrl: this.xtreamStore.constructEpisodeStreamUrl(episode),
            title: episode.title,
            thumbnail: item.info?.cover,
            ...(quickStart.position?.positionSeconds &&
            quickStart.kind === 'resume'
                ? { startTime: quickStart.position.positionSeconds }
                : {}),
            contentInfo,
        };
    }

    private async openExternal(): Promise<void> {
        const bindings = this.bindings();
        const episode = this.startableQuickStart()?.episode;
        if (!bindings || !episode) {
            return;
        }
        const token = bindings.pageToken();
        try {
            await bindings.openEpisodeExternally(
                episode,
                this.externalPlayer()
            );
        } catch (error) {
            this.logger.warn('External episode launch failed', error);
            // The page is reused across series and visits: a failure that
            // lands after the viewer moved on (or came back) is not the
            // current visit's problem.
            if (bindings.pageToken() === token) {
                this.notify('PORTALS.PLAYBACK_ERROR');
            }
        }
    }

    private async copyStreamUrl(): Promise<void> {
        const playback = this.buildEpisodePlayback();
        if (!playback) {
            return;
        }
        try {
            await navigator.clipboard.writeText(playback.streamUrl);
            this.notify('PORTALS.STREAM_URL_COPIED');
        } catch (error) {
            this.logger.warn('Copying the stream URL failed', error);
            this.notify('DOWNLOADS.URL_COPY_FAILED');
        }
    }

    private showInCategory(): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const categoryId = this.category()?.category_id;
        if (!playlistId || categoryId === undefined || categoryId === null) {
            return;
        }
        void this.router.navigate([
            '/workspace/xtreams',
            playlistId,
            'series',
            String(categoryId),
        ]);
    }

    private async hideFromContinueWatching(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const seriesId = this.seriesId();
        if (!playlistId || !seriesId || !this.dataSource) {
            return;
        }
        try {
            const content = await this.dataSource.getContentByXtreamId(
                seriesId,
                playlistId,
                'series'
            );
            if (!content?.id) {
                return;
            }
            await this.dataSource.removeRecentItem(content.id, playlistId);
            // The refreshed list drops the row, and brings it back once the
            // series is played again.
            this.xtreamStore.loadRecentItems({ id: playlistId });
            this.notify('PORTALS.DETAIL.HIDDEN_FROM_CONTINUE_WATCHING');
        } catch (error) {
            this.logger.warn('Hiding the series from history failed', error);
        }
    }

    private notify(key: string): void {
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration: 3000,
        });
    }
}
