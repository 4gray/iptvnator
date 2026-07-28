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
    createExternalPlaybackButtonState,
    createInlinePlaybackPositionWriter,
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
import { formatPlaybackPosition } from './vod-primary-action-position';

export interface VodDetailsPlaybackBindings {
    /** Current vod id resolved from the route */
    vodId: Signal<number>;
    /** Usable metadata of the selected VOD, if any */
    vodInfo: Signal<XtreamVodInfo | null>;
    /**
     * The source playing when it is NOT the route's own. An external player
     * launched for an alternative carries that playlist's ids, so without
     * this the session belongs to no page and never offers Stop.
     */
    activeSource?: Signal<PlayerContentInfo | null>;
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

    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly vodPlaybackPosition = signal<PlaybackPositionData | null>(null);

    private readonly externalButton = createExternalPlaybackButtonState({
        session: this.externalPlayback.activeSession,
        playlistId: computed(() => this.xtreamStore.currentPlaylist()?.id),
        contentId: computed(() => this.bindings()?.vodId()),
        alsoOwns: computed(() => this.bindings()?.activeSource?.() ?? null),
    });

    readonly matchedExternalPlayback = this.externalButton.matchedSession;
    readonly externalPrimaryLabel = this.externalButton.primaryLabel;
    readonly externalPrimaryIcon = this.externalButton.primaryIcon;
    readonly isExternalLaunchPending = this.externalButton.isLaunchPending;
    readonly isExternalStopAction = this.externalButton.isStopAction;
    readonly externalPrimaryButtonState = this.externalButton.buttonState;
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
                    // An external player on an ALTERNATIVE reports under
                    // that playlist's ids; dropping those rewinds a switch.
                    if (this.ownsContent(data)) {
                        this.vodPlaybackPosition.set(data);
                    }
                }
            ) ?? null;

        inject(DestroyRef).onDestroy(() => unsubscribePositionUpdates?.());
    }

    /**
     * Whether this page owns the content a position update refers to.
     *
     * Multi-source can put playback on a movie in ANOTHER playlist, whose ids
     * the incoming rows then carry, so this has to agree with the Play/Stop
     * button's `alsoOwns` — otherwise the page offers Stop for a session whose
     * progress it silently drops.
     */
    private ownsContent(
        info:
            | {
                  playlistId?: string;
                  contentXtreamId?: number;
                  contentType?: string;
              }
            | undefined
    ): boolean {
        // An absent playlist id must never match an absent current playlist.
        if (!info?.playlistId || info.contentType !== 'vod') {
            return false;
        }

        const active = this.bindings()?.activeSource?.();
        return (
            (info.playlistId === this.xtreamStore.currentPlaylist()?.id &&
                info.contentXtreamId === this.bindings()?.vodId()) ||
            (!!active &&
                info.playlistId === active.playlistId &&
                info.contentXtreamId === active.contentXtreamId)
        );
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
        return formatPlaybackPosition(this.vodPlaybackPosition());
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.positionWriter.reset();
    }

    private readonly positionWriter = createInlinePlaybackPositionWriter({
        playback: this.inlinePlayback,
        save: (playlistId, position) =>
            void this.playbackPositions.savePlaybackPosition(
                playlistId,
                position
            ),
        onSaved: (position) => this.vodPlaybackPosition.set(position),
    });

    /**
     * @returns whether `currentTime` can be believed yet — see the writer's
     * resume latch. Multi-source reads the same answer before carrying a
     * timecode to another source.
     */
    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): boolean {
        return this.positionWriter.handleTimeUpdate(event);
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

    /**
     * The single inline-vs-external fork. Public so multi-source can switch
     * the playing source through exactly the same path a normal Play takes —
     * a second, parallel start path is how the two drift apart.
     *
     * For an inline switch this is a single `.set()` on a signal the host
     * template already renders through `@if`, so the player component and its
     * engine survive and simply re-seek to `playback.startTime`.
     */
    startResolvedPlayback(playback: ResolvedPortalPlayback): void {
        // Same movie, different source: still a view.
        this.addToRecentlyViewed();
        this.startPlayback(playback);
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.positionWriter.reset();
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.portalPlayer.openResolvedPlayback(playback, true);
    }
}
