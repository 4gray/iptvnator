import {
    DestroyRef,
    Injectable,
    Signal,
    computed,
    inject,
    signal,
} from '@angular/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    getPortalPlaybackProgressPercent,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamVodDetails,
    XtreamVodInfo,
    getXtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';

export interface VodDetailsPlaybackBindings {
    /** Current vod id resolved from the route */
    vodId: Signal<number>;
    /** Usable metadata of the selected VOD, if any */
    vodInfo: Signal<XtreamVodInfo | null>;
}

/**
 * Component-provided service that owns the playback concern of the VOD
 * details route: inline playback state, playback positions, external
 * player sessions, and play/resume actions.
 */
@Injectable()
export class VodDetailsPlaybackService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    private readonly logger = createLogger('VodDetailsPlayback');

    /** Signals bound from the host component via `bind()` */
    private readonly bindings = signal<VodDetailsPlaybackBindings | null>(
        null
    );
    private lastSaveTime = 0;

    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly vodPlaybackPosition = signal<PlaybackPositionData | null>(null);

    readonly matchedExternalPlayback = computed(() => {
        const session = this.externalPlayback.activeSession();
        const vodId = this.bindings()?.vodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;

        if (
            !session?.contentInfo ||
            !playlistId ||
            session.status === 'error' ||
            session.status === 'closed'
        ) {
            return null;
        }

        const contentInfo = session.contentInfo;
        if (
            contentInfo.playlistId !== playlistId ||
            contentInfo.contentType !== 'vod' ||
            contentInfo.contentXtreamId !== vodId
        ) {
            return null;
        }

        return session;
    });
    readonly externalPrimaryLabel = computed(() => {
        const session = this.matchedExternalPlayback();
        if (!session) {
            return null;
        }

        const player = session.player.toUpperCase();
        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
            case 'playing':
                return `Stop ${player}`;
            default:
                return null;
        }
    });
    readonly externalPrimaryIcon = computed(() => {
        const session = this.matchedExternalPlayback();
        switch (session?.status) {
            case 'launching':
                return 'hourglass_top';
            case 'opened':
            case 'playing':
                return 'stop_circle';
            default:
                return 'play_arrow';
        }
    });
    readonly isExternalLaunchPending = computed(
        () => this.matchedExternalPlayback()?.status === 'launching'
    );
    readonly isExternalStopAction = computed(() => {
        const status = this.matchedExternalPlayback()?.status;
        return status === 'opened' || status === 'playing';
    });
    readonly externalPrimaryButtonState = computed(() => {
        if (this.isExternalLaunchPending()) {
            return 'launching';
        }

        return this.isExternalStopAction() ? 'stop' : 'idle';
    });
    readonly vodPlaybackProgress = computed(() =>
        getPortalPlaybackProgressPercent(this.vodPlaybackPosition())
    );

    readonly hasPlaybackPosition = computed(() => {
        const inProgress =
            this.vodPlaybackProgress() > 0 && this.vodPlaybackProgress() < 90;
        this.logger.debug('hasPlaybackPosition check', {
            vodId: this.bindings()?.vodId(),
            inProgress,
        });
        return inProgress;
    });

    constructor() {
        const unsubscribePositionUpdates =
            this.playbackPositionBridge.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    const playlistId = this.xtreamStore.currentPlaylist()?.id;
                    const vodId = this.bindings()?.vodId();

                    if (
                        data.contentType !== 'vod' ||
                        data.playlistId !== playlistId ||
                        data.contentXtreamId !== vodId
                    ) {
                        return;
                    }

                    this.vodPlaybackPosition.set(data);
                }
            ) ?? null;

        inject(DestroyRef).onDestroy(() => unsubscribePositionUpdates?.());
    }

    /** Wires the host component's context signals. Call once at construction. */
    bind(bindings: VodDetailsPlaybackBindings): void {
        this.bindings.set(bindings);
    }

    playVod(vodItem: XtreamVodDetails | null): void {
        if (!vodItem) {
            return;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        const info = getXtreamVodInfo(vodItem);
        this.addToRecentlyViewed();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.bindings()?.vodId();
        const id =
            routeVodId != null && Number.isFinite(routeVodId)
                ? routeVodId
                : Number(
                      vodItem.movie_data?.stream_id ||
                          (vodItem as { stream_id?: number }).stream_id
                  );

        this.logger.debug('playVod resolved ID', { id, vodItem });

        const contentInfo: PlayerContentInfo = {
            playlistId: playlist.id,
            contentXtreamId: id,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: info?.name ?? vodItem.movie_data?.name ?? 'Unknown',
            thumbnail: info?.movie_image,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    resumeVod(vodItem: XtreamVodDetails | null): void {
        if (!vodItem) {
            return;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        const info = getXtreamVodInfo(vodItem);
        this.addToRecentlyViewed();
        const vodId = this.bindings()?.vodId() ?? NaN;
        const position = this.vodPlaybackPosition();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        const contentInfo: PlayerContentInfo = {
            playlistId: playlist.id,
            contentXtreamId: vodId,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: info?.name ?? vodItem.movie_data?.name ?? 'Unknown',
            thumbnail: info?.movie_image,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    onPrimaryAction(vodItem: XtreamVodDetails | null): void {
        if (!vodItem) {
            return;
        }

        if (this.isExternalStopAction()) {
            void this.stopExternalPlayback();
            return;
        }

        if (this.hasPlaybackPosition()) {
            this.resumeVod(vodItem);
            return;
        }

        this.playVod(vodItem);
    }

    async stopExternalPlayback(): Promise<void> {
        await this.externalPlayback.closeSession(
            this.matchedExternalPlayback()
        );
    }

    formatPosition(): string {
        const position = this.vodPlaybackPosition();
        if (!position) return '';

        const date = new Date(0);
        date.setSeconds(position.positionSeconds);
        const timeString = date.toISOString().substr(11, 8);
        return timeString.startsWith('00:') ? timeString.substr(3) : timeString;
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
        this.vodPlaybackPosition.set(position);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }

    async loadPosition(playlistId: string, vodId: number): Promise<void> {
        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );
        this.vodPlaybackPosition.set(position);
    }

    private addToRecentlyViewed(): void {
        this.xtreamStore.addRecentItem({
            xtreamId: this.bindings()?.vodId() ?? NaN,
            contentType: 'movie',
            playlist: this.xtreamStore.currentPlaylist,
            backdropUrl: this.bindings()?.vodInfo()?.backdrop_path?.[0],
        });
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.portalPlayer.openResolvedPlayback(playback, true);
    }
}
