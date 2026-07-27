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
    /**
     * The source actually playing when it is NOT the route's own — supplied by
     * multi-source. An external player launched for an alternative carries
     * that playlist's ids, so without this the session belongs to no page and
     * its Stop button never appears.
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
    private lastSaveTime = 0;
    /** Cleared on every start; latches once playback reaches startTime. */
    private resumeSettled = false;

    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly vodPlaybackPosition = signal<PlaybackPositionData | null>(null);

    readonly matchedExternalPlayback = computed(() => {
        const session = this.externalPlayback.activeSession();

        if (
            !session?.contentInfo ||
            !this.xtreamStore.currentPlaylist()?.id ||
            session.status === 'error' ||
            session.status === 'closed'
        ) {
            return null;
        }

        return this.ownsContent(session.contentInfo) ? session : null;
    });

    /**
     * Whether this page owns the content an external session or a position
     * update refers to.
     *
     * Multi-source can put playback on a movie in ANOTHER playlist, and its
     * session ids and position rows then carry that playlist's identity. One
     * predicate for both consumers: when they disagree, the page shows a Stop
     * button for a session whose progress it is throwing away.
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
                    // An external player running an ALTERNATIVE reports under
                    // that playlist's ids. Dropping those updates would leave
                    // the resume point at wherever playback started, and a
                    // later switch would rewind the whole session.
                    if (this.ownsContent(data)) {
                        this.vodPlaybackPosition.set(data);
                    }
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
        this.resumeSettled = false;
    }

    /**
     * @returns whether `currentTime` can be believed yet — false while the
     * engine is still on its way to `startTime`. Multi-source switching needs
     * the same answer, and one latch has to serve both or they disagree.
     */
    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): boolean {
        const playback = this.inlinePlayback();
        // Nothing to persist against and the latch never ran, so the answer is
        // whatever it already was — not a fresh "no".
        if (!playback?.contentInfo) return this.resumeSettled;

        // A resuming engine can emit timeupdates at ~0 before it finishes
        // seeking to startTime. Writing one would overwrite the very position
        // we are resuming from — which a source switch would then inherit.
        //
        // This is a one-shot latch, not a filter: once playback has reached
        // the resume point the guard is done, so a deliberate seek backwards
        // is still saved normally.
        if (!this.resumeSettled) {
            const startTime = playback.startTime ?? 0;
            if (startTime > 0 && event.currentTime < startTime - 5)
                return false;
            this.resumeSettled = true;
        }

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return true;

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
        return true;
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
        this.startPlayback(playback);
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        this.resumeSettled = false;
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.portalPlayer.openResolvedPlayback(playback, true);
    }
}
