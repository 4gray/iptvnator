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
import {
    ownsContent,
    runningExternalSession,
} from './vod-details-external-session';
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
    /**
     * The LAST position seen, whichever copy produced it.
     *
     * Multi-source can put playback on a copy in another playlist, and this
     * follows it — the progress bar and the switch feed both want the stream
     * on screen, not the one the route happens to address.
     */
    readonly vodPlaybackPosition = signal<PlaybackPositionData | null>(null);

    /**
     * The ROUTE copy's own row.
     *
     * Everything that acts on the route's stream — Resume, its label, its
     * timecode — has to read this instead. Positions are keyed by (playlist,
     * stream), so once an alternative has played, `vodPlaybackPosition` names
     * a different film's row entirely and resuming from it would jump the
     * route copy to a timecode nobody reached in it.
     */
    readonly routePlaybackPosition = signal<PlaybackPositionData | null>(null);

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

    /** Mirrors an incoming position into the route's row when it owns it. */
    private trackPosition(position: PlaybackPositionData | null): void {
        this.vodPlaybackPosition.set(position);
        if (this.isRouteContent(position)) {
            this.routePlaybackPosition.set(position);
        }
    }

    private isRouteContent(position: PlaybackPositionData | null): boolean {
        return (
            !!position &&
            position.playlistId === this.xtreamStore.currentPlaylist()?.id &&
            position.contentXtreamId === this.bindings()?.vodId()
        );
    }

    /** Whether the ROUTE copy has somewhere to resume from. */
    readonly hasPlaybackPosition = computed(() => {
        const progress = getPortalPlaybackProgressPercent(
            this.routePlaybackPosition()
        );
        const inProgress = progress > 0 && progress < 90;
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
                        this.trackPosition(data);
                    }
                }
            ) ?? null;

        inject(DestroyRef).onDestroy(() => unsubscribePositionUpdates?.());
    }

    private ownsContent(
        info:
            | {
                  playlistId?: string;
                  contentXtreamId?: number;
                  contentType?: string;
              }
            | undefined
    ): boolean {
        return ownsContent(info, {
            routePlaylistId: this.xtreamStore.currentPlaylist()?.id,
            routeContentId: this.bindings()?.vodId(),
            alternative: this.bindings()?.activeSource?.() ?? null,
        });
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
        const position = this.routePlaybackPosition();
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
        return formatPlaybackPosition(this.routePlaybackPosition());
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
        onSaved: (position) => this.trackPosition(position),
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
        this.routePlaybackPosition.set(position);
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
    /** Bumped by every start; only the newest may launch after its close. */
    private startGeneration = 0;

    /**
     * What we last launched externally, remembered independently of the
     * controller's active source.
     *
     * `matchedExternalPlayback` cannot answer this during a switch: the
     * controller marks the DESTINATION active before playback is handed over,
     * so by the time we get here the running process no longer looks like
     * ours and would be left playing beside its replacement.
     */
    private launchedExternally: PlayerContentInfo | null = null;

    async startResolvedPlayback(
        playback: ResolvedPortalPlayback
    ): Promise<void> {
        const generation = ++this.startGeneration;

        // A switch REPLACES what is playing. With MPV or VLC and instance
        // reuse off, the backend spawns a second detached player otherwise —
        // both sources keep running and Stop owns only the newer one.
        const running = runningExternalSession(
            this.externalPlayback.activeSession(),
            this.launchedExternally,
            this.matchedExternalPlayback()
        );
        if (running) {
            await this.externalPlayback.closeSession(running);
        }

        // Closing is a round-trip, and a second pick across it would otherwise
        // reach this line too: both would have seen the same session, closed
        // it once, and then launched independently — two detached players
        // again, the older one holding a source the user has moved on from.
        if (generation !== this.startGeneration) {
            return;
        }

        // Same movie, different source: still a view.
        this.addToRecentlyViewed();
        this.startPlayback(playback);
    }


    private startPlayback(playback: ResolvedPortalPlayback): void {
        // EVERY start claims the generation, not just the switch path. Play,
        // Resume and Restart reach here directly, and a switch still waiting
        // on its `closeSession` would otherwise pass the check afterwards and
        // launch on top of what the user just chose.
        this.startGeneration++;
        this.positionWriter.reset();
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            this.launchedExternally = null;
            return;
        }

        this.closeInlinePlayer();
        this.launchedExternally = playback.contentInfo ?? null;
        void this.portalPlayer.openResolvedPlayback(playback, true);
    }
}
