import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    Signal,
    signal,
    untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    getSeriesQuickStartAction,
    inlineProgressPosition,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    ExternalPlayerName,
    ExternalPlayerSession,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    XtreamSerieDetails,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';
import {
    getSeriesEpisodeMetadata,
    getSeriesPlaybackNavigation,
    inlineSeriesEpisodeState,
    type PlaybackFallbackRequest,
    type SeriesPlaybackEpisodeState,
} from '@iptvnator/ui/playback';
import { injectXtreamRecentHistory } from '../xtream-recent-history';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import {
    externalEpisodeSessionIds,
    isEpisodeLaunchPending,
    openEpisodeExternally,
    queueEpisodeChoice,
} from './serial-details-external-launch';
import { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';
import {
    SerialDetailsSeasonWatchService,
    type SerialDetailsWatchScope,
} from './serial-details-season-watch.service';
import { SerialDetailsWatchToggles } from './serial-details-watch-toggles';
import { buildSerialEpisodePlayback } from './serial-episode-playback';

export type XtreamSerieDetailsView = XtreamSerieDetails & {
    readonly series_id: number;
};

interface SerialDetailsPlaybackBindings {
    readonly selectedItem: Signal<XtreamSerieDetailsView | null>;
}

/** Page instances created so far: a recreated page must not reuse a token. */
let pageInstances = 0;

/**
 * Component-provided service that owns the episode playback concern of the
 * serial details view: inline playback state, per-episode playback
 * positions, external-player session tracking, and playback orchestration.
 */
@Injectable()
export class SerialDetailsPlaybackService {
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    readonly portalPlayer = inject(PORTAL_PLAYER);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly recordRecentItem = injectXtreamRecentHistory();
    private readonly resumeTarget = inject(XTREAM_SERIES_RESUME_TARGET);
    private readonly seasonWatch = inject(SerialDetailsSeasonWatchService);
    private readonly logger = createLogger('SerialDetailsPlayback');
    private readonly savePosition = (
        playlistId: string,
        position: PlaybackPositionData
    ) => this.playbackPositions.savePlaybackPosition(playlistId, position);

    private readonly bindings = signal<SerialDetailsPlaybackBindings | null>(
        null
    );
    private readonly currentPlaylistId = computed(
        () => this.xtreamStore.currentPlaylist()?.id ?? ''
    );
    private readonly playbackPositionState =
        new SerialDetailsPlaybackPositionState();
    private readonly watchToggles = new SerialDetailsWatchToggles({
        playbackPositions: this.playbackPositions,
        seasonWatch: this.seasonWatch,
        state: this.playbackPositionState,
        playlistId: () => this.currentPlaylistId(),
        seriesXtreamId: () => Number(this.selectedItem()?.series_id ?? 0),
        reloadStorePositions: (playlistId) =>
            this.xtreamStore.loadAllPositions(playlistId),
    });
    private lastSaveTime = 0;

    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly inlinePlaybackSessionEpisodeState =
        signal<SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null>(null);
    readonly episodePlaybackPositions = this.playbackPositionState.positions;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);
    readonly seasonWatchBatchRunning = this.seasonWatch.batchRunning;

    readonly quickStartAction = computed(() => {
        const item = this.selectedItem();
        if (!item) {
            return null;
        }

        return getSeriesQuickStartAction({
            seasons: item.episodes ?? {},
            playbackPositions: this.episodePlaybackPositions(),
        });
    });
    readonly inlineEpisodeState =
        computed<SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null>(() =>
            inlineSeriesEpisodeState(
                this.inlinePlayback(),
                this.selectedItem()?.episodes
            )
        );
    readonly inlineEpisodeMetadata = computed(() =>
        getSeriesEpisodeMetadata(this.inlineEpisodeState())
    );
    readonly inlineSeriesNavigation = computed(() =>
        getSeriesPlaybackNavigation(this.inlineEpisodeState())
    );

    constructor() {
        // A launch still closing its predecessor must not outlive the page.
        inject(DestroyRef).onDestroy(() => this.bindings.set(null));
        effect(() => {
            const ids = externalEpisodeSessionIds(
                this.externalPlayback.activeSession(),
                this.selectedItem()?.series_id,
                this.currentPlaylistId()
            );
            this.openingEpisodeId.set(ids.opening);
            this.activeEpisodeId.set(ids.active);
        });

        effect(() => {
            const target = this.resumeTarget();
            const selectedItem = this.selectedItem();
            const playlistId = this.currentPlaylistId();

            if (!target || !selectedItem || !playlistId) {
                return;
            }

            const episode = this.playbackPositionState.takeResumeEpisode({
                playlistId,
                selectedItem,
                target,
            });
            if (!episode) {
                return;
            }

            untracked(() => this.playEpisode(episode));
        });

        const unsubscribePositionUpdates =
            this.playbackPositionBridge.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    const selectedItem = this.selectedItem();

                    if (
                        data.contentType !== 'episode' ||
                        data.playlistId !== this.currentPlaylistId() ||
                        data.seriesXtreamId !==
                            Number(selectedItem?.series_id ?? 0)
                    ) {
                        return;
                    }

                    this.playbackPositionState.update(data);
                }
            ) ?? null;

        inject(DestroyRef).onDestroy(() => {
            unsubscribePositionUpdates?.();
        });
    }

    /** Connects the service to the owning component's reactive state. */
    bind(bindings: SerialDetailsPlaybackBindings): void {
        this.bindings.set(bindings);
    }

    /** Clears all playback state when switching to another series. */
    resetForNewSeries(): void {
        this.pageGeneration += 1;
        this.closeInlinePlayer();
        this.playbackPositionState.reset();
        this.openingEpisodeId.set(null);
        this.activeEpisodeId.set(null);
    }

    /** `player` forces MPV/VLC (the "…" menu); history and the launch position are recorded either way. */
    playEpisode(
        episode: XtreamSerieEpisode,
        player?: ExternalPlayerName
    ): Promise<ExternalPlayerSession | void> | void {
        // A forced launch still settling owns the next start: the latest
        // choice made meanwhile replaces its player once it settled.
        const owner = this.launchOwner();
        if (!player && owner && this.forcedLaunchPending()) {
            queueEpisodeChoice(this, owner, episode, (queued) =>
                this.playEpisode(queued)
            );
            return;
        }
        const playlist = this.xtreamStore.currentPlaylist();
        const selectedItem = this.selectedItem();
        if (!playlist || !selectedItem) {
            return;
        }

        const streamUrl = this.xtreamStore.constructEpisodeStreamUrl(episode);
        this.recordRecentItem(streamUrl, {
            xtreamId: this.route.snapshot.params['serialId'],
            contentType: 'series',
            backdropUrl: selectedItem.info?.backdrop_path?.[0],
        });
        const position = this.episodePlaybackPositions().get(
            Number(episode.id)
        );
        const { playback, episodeState } = buildSerialEpisodePlayback({
            playlistId: playlist.id,
            selectedItem,
            episode,
            streamUrl,
            startTime: position?.positionSeconds,
        });
        return this.startPlayback(playback, episodeState, player);
    }

    playQuickStartEpisode(): void {
        const action = this.quickStartAction();
        if (action && !action.disabled) {
            this.playEpisode(action.episode);
        }
    }

    playPreviousEpisode(): void {
        const previous = this.inlineEpisodeState()?.previous;
        if (previous) {
            this.playEpisode(previous);
        }
    }

    playNextEpisode(): void {
        const next = this.inlineEpisodeState()?.next;
        if (next) {
            this.playEpisode(next);
        }
    }

    handleInlinePlaybackEnded(): void {
        const navigation = this.inlineSeriesNavigation();
        if (!navigation?.autoplayEnabled || !navigation.canNext) {
            return;
        }
        this.playNextEpisode();
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.inlinePlaybackSessionEpisodeState.set(null);
        this.lastSaveTime = 0;
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        const now = Date.now();
        if (!playback?.contentInfo || now - this.lastSaveTime <= 15000) return;
        this.lastSaveTime = now;
        const position = inlineProgressPosition(playback.contentInfo, event);
        void this.savePosition(playback.contentInfo.playlistId, position);
        this.playbackPositionState.update(position);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        const token = this.pageToken();
        void this.playbackPositionState.recordExternalLaunch(
            request.playback,
            launch,
            this.savePosition,
            () => this.pageToken() === token
        );
    }

    handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        return this.watchToggles.toggleEpisode(request);
    }

    handleWatchToggleRequested(
        request: SeasonContainerSeriesPlaybackToggleRequest,
        scope: SerialDetailsWatchScope
    ): Promise<void> {
        return this.watchToggles.toggleBatch(request, scope);
    }

    async loadSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<void> {
        return this.playbackPositionState.load(playlistId, seriesXtreamId, () =>
            this.playbackPositions.getSeriesPlaybackPositions(
                playlistId,
                seriesXtreamId
            )
        );
    }

    private selectedItem(): XtreamSerieDetailsView | null {
        return this.bindings()?.selectedItem() ?? null;
    }

    /** A forced MPV/VLC launch of this series that has not settled yet. */
    readonly forcedLaunchPending = computed(() =>
        isEpisodeLaunchPending(this.launchOwner())
    );

    /** Distinguishes this page instance from one that replaced it. */
    private readonly pageInstance = ++pageInstances;
    /** Bumped for every series the page shows: a return to the same series is a new visit. */
    private pageGeneration = 0;

    /**
     * Identifies the series AND the visit: a launch's bookkeeping applies
     * only while the page still shows what it showed when the launch
     * started, not after leaving and coming back.
     */
    pageToken(): string {
        return `${this.launchOwner()}#${this.pageInstance}.${this.pageGeneration}`;
    }

    /** `playlist:series` of the page, null once it is gone or shows another series. */
    launchOwner(): string | null {
        const seriesId = this.selectedItem()?.series_id;
        return seriesId ? `${this.currentPlaylistId()}:${seriesId}` : null;
    }

    private startPlayback(
        playback: ResolvedPortalPlayback,
        episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null,
        player?: ExternalPlayerName
    ): Promise<ExternalPlayerSession | void> | void {
        this.lastSaveTime = 0;
        if (!player && this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlaybackSessionEpisodeState.set(episodeState);
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        const launch = player
            ? openEpisodeExternally(this, playback, player)
            : this.portalPlayer.openResolvedPlayback(playback, true);
        // The bookkeeping never rejects; a forced launch's failure is the
        // menu's to report, which awaits the launch it asked for.
        const token = this.pageToken();
        const stillShown = () => this.pageToken() === token;
        const settled = launch.catch((error) => {
            this.logger.warn('External launch failed', error);
            return undefined;
        });
        void this.playbackPositionState.recordExternalLaunch(
            playback,
            settled.then((session) => (stillShown() ? session : undefined)),
            this.savePosition,
            stillShown
        );
        return launch;
    }
}
