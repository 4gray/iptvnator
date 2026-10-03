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
    isLiveExternalPlayerSession,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    getSeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    ExternalPlayerName,
    PlaybackPositionData,
    PlayerContentInfo,
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
    type PlaybackFallbackRequest,
    resolveSeriesPlaybackEpisodeState,
    type SeriesPlaybackEpisodeState,
} from '@iptvnator/ui/playback';
import { injectXtreamRecentHistory } from '../xtream-recent-history';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import { openEpisodeExternally } from './serial-details-external-launch';
import { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';
import {
    SerialDetailsSeasonWatchService,
    type SerialDetailsWatchScope,
} from './serial-details-season-watch.service';

export type XtreamSerieDetailsView = XtreamSerieDetails & {
    readonly series_id: number;
};

interface SerialDetailsPlaybackBindings {
    readonly selectedItem: Signal<XtreamSerieDetailsView | null>;
}

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
            this.getInlineEpisodeState()
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
            const session = this.externalPlayback.activeSession();
            const selectedItem = this.selectedItem();
            const playlistId = this.currentPlaylistId();

            if (
                !session?.contentInfo ||
                !selectedItem?.series_id ||
                !playlistId ||
                session.contentInfo.contentType !== 'episode' ||
                session.contentInfo.playlistId !== playlistId ||
                session.contentInfo.seriesXtreamId !==
                    Number(selectedItem.series_id)
            ) {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(null);
                return;
            }

            if (session.status === 'launching') {
                this.openingEpisodeId.set(session.contentInfo.contentXtreamId);
                this.activeEpisodeId.set(null);
                return;
            }

            if (isLiveExternalPlayerSession(session)) {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(session.contentInfo.contentXtreamId);
                return;
            }

            this.openingEpisodeId.set(null);
            this.activeEpisodeId.set(null);
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
        this.closeInlinePlayer();
        this.playbackPositionState.reset();
        this.openingEpisodeId.set(null);
        this.activeEpisodeId.set(null);
    }

    /** `player` forces MPV/VLC (the "…" menu); history and the launch position are recorded either way. */
    playEpisode(
        episode: XtreamSerieEpisode,
        player?: ExternalPlayerName
    ): void {
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
        const contentInfo: PlayerContentInfo = {
            playlistId: playlist.id,
            contentXtreamId: Number(episode.id),
            contentType: 'episode',
            seriesXtreamId: Number(selectedItem.series_id),
            seasonNumber: Number(episode.season),
            episodeNumber: Number(episode.episode_num),
        };

        const position = this.episodePlaybackPositions().get(
            Number(episode.id)
        );

        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: episode.title,
            thumbnail: selectedItem.info.cover,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        const episodeState = resolveSeriesPlaybackEpisodeState({
            episodesBySeason: selectedItem.episodes,
            currentEpisodeId: episode.id,
            fallbackSeasonNumber: Number(episode.season),
            fallbackEpisodeNumber: Number(episode.episode_num),
        });
        this.startPlayback(playback, episodeState, player);
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
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return;

        this.lastSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };
        void this.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.playbackPositionState.update(position);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void this.playbackPositionState.recordExternalLaunch(
            request.playback,
            launch,
            this.savePosition
        );
    }

    async handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.currentPlaylistId();
        if (!playlistId) {
            return;
        }

        if (request.nextPosition) {
            await this.playbackPositions.savePlaybackPosition(
                playlistId,
                request.nextPosition
            );
            this.playbackPositionState.update(request.nextPosition);
        } else {
            await this.playbackPositions.clearPlaybackPosition(
                playlistId,
                request.contentXtreamId,
                'episode'
            );
            this.playbackPositionState.remove(request.contentXtreamId);
        }
        await this.refreshStorePositions(playlistId);
    }

    async handleWatchToggleRequested(
        request: SeasonContainerSeriesPlaybackToggleRequest,
        scope: SerialDetailsWatchScope
    ): Promise<void> {
        const playlistId = this.currentPlaylistId();
        const seriesXtreamId = Number(this.selectedItem()?.series_id ?? 0);
        const persisted = await this.seasonWatch.handle(
            request,
            playlistId,
            this.playbackPositionState,
            () =>
                this.currentPlaylistId() === playlistId &&
                Number(this.selectedItem()?.series_id ?? 0) === seriesXtreamId,
            scope
        );
        if (persisted) {
            await this.refreshStorePositions(playlistId);
        }
    }

    /**
     * The catalog reads series progress from XtreamStore, whose positions
     * load once per playlist (XtreamCatalogFacadeService.initialize), so a
     * toggle must push the change back or badges go stale on return. Skipped
     * after a playlist switch — the store then holds the other playlist.
     */
    private async refreshStorePositions(playlistId: string): Promise<void> {
        if (this.currentPlaylistId() !== playlistId) {
            return;
        }
        try {
            await this.xtreamStore.loadAllPositions(playlistId);
        } catch (error) {
            // The toggle itself succeeded; a failed refresh keeps the store
            // populated-but-stale, which beats wiping it with a bad read.
            console.warn(
                '[SerialDetailsPlayback] Store position refresh failed',
                error
            );
        }
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

    /** `playlist:series` of the page, null once it is gone or shows another series. */
    launchOwner(): string | null {
        const seriesId = this.selectedItem()?.series_id;
        return seriesId ? `${this.currentPlaylistId()}:${seriesId}` : null;
    }

    private startPlayback(
        playback: ResolvedPortalPlayback,
        episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null,
        player?: ExternalPlayerName
    ): void {
        this.lastSaveTime = 0;
        if (!player && this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlaybackSessionEpisodeState.set(episodeState);
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.playbackPositionState.recordExternalLaunch(
            playback,
            player
                ? openEpisodeExternally(this, playback, player)
                : this.portalPlayer.openResolvedPlayback(playback, true),
            this.savePosition
        );
    }

    private getInlineEpisodeState(): SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null {
        const playback = this.inlinePlayback();
        const episodesBySeason = this.selectedItem()?.episodes;
        const currentEpisodeId = playback?.contentInfo?.contentXtreamId;

        if (
            !episodesBySeason ||
            playback?.contentInfo?.contentType !== 'episode' ||
            currentEpisodeId === undefined
        ) {
            return null;
        }

        return resolveSeriesPlaybackEpisodeState({
            episodesBySeason,
            currentEpisodeId,
            fallbackSeasonNumber: playback.contentInfo.seasonNumber,
            fallbackEpisodeNumber: playback.contentInfo.episodeNumber,
        });
    }
}
