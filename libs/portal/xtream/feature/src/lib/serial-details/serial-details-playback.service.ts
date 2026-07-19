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
    getSeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamSerieDetails,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { SeasonContainerPlaybackToggleRequest } from '@iptvnator/ui/components';
import {
    getSeriesEpisodeMetadata,
    getSeriesPlaybackNavigation,
    type PlaybackFallbackRequest,
    resolveSeriesPlaybackEpisodeState,
    type SeriesPlaybackEpisodeState,
} from '@iptvnator/ui/playback';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';

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
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly resumeTarget = inject(XTREAM_SERIES_RESUME_TARGET);

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
    readonly episodePlaybackPositions = this.playbackPositionState.positions;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);

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

            if (session.status === 'opened' || session.status === 'playing') {
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

    playEpisode(episode: XtreamSerieEpisode): void {
        const playlist = this.xtreamStore.currentPlaylist();
        const selectedItem = this.selectedItem();
        if (!playlist || !selectedItem) {
            return;
        }

        this.addToRecentlyViewed(this.route.snapshot.params.serialId);

        const streamUrl = this.xtreamStore.constructEpisodeStreamUrl(episode);
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

        this.startPlayback(playback);
    }

    playQuickStartEpisode(): void {
        const action = this.quickStartAction();
        if (!action || action.disabled) {
            return;
        }

        this.playEpisode(action.episode);
    }

    playPreviousEpisode(): void {
        const previous = this.inlineEpisodeState()?.previous;
        if (!previous) {
            return;
        }
        this.playEpisode(previous);
    }

    playNextEpisode(): void {
        const next = this.inlineEpisodeState()?.next;
        if (!next) {
            return;
        }
        this.playEpisode(next);
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
        void this.playbackPositionState.recordExternalLaunch(
            request.playback,
            this.portalPlayer.openExternalPlayback(
                request.playback,
                request.player
            ),
            (playlistId, position) =>
                this.playbackPositions.savePlaybackPosition(
                    playlistId,
                    position
                )
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
            return;
        }

        await this.playbackPositions.clearPlaybackPosition(
            playlistId,
            request.contentXtreamId,
            'episode'
        );
        this.playbackPositionState.remove(request.contentXtreamId);
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

    private addToRecentlyViewed(xtreamId: number): void {
        this.xtreamStore.addRecentItem({
            xtreamId,
            contentType: 'series',
            playlist: this.xtreamStore.currentPlaylist,
            backdropUrl: this.selectedItem()?.info?.backdrop_path?.[0],
        });
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.playbackPositionState.recordExternalLaunch(
            playback,
            this.portalPlayer.openResolvedPlayback(playback, true),
            (playlistId, position) =>
                this.playbackPositions.savePlaybackPosition(
                    playlistId,
                    position
                )
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
