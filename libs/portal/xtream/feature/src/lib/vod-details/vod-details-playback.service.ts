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
import {
    resolveXtreamVodPlaybackSource,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    ExternalPlayerSession,
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamVodDetails,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import {
    closeRunningExternalSession,
    ownsContent,
    runningExternalSession,
} from './vod-details-external-session';
import {
    createExternalLaunchOwner,
    startRouteOwnedPlayback,
} from './vod-details-external-launch-owner';
import { settleOwnedExternalLaunch } from './vod-details-external-launch';
import { resolveXtreamVodPlaybackPresentation } from './vod-details-playback-presentation';
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
    /** Retires a source resolution that the accepted fallback now supersedes. */
    supersedePendingSwitch: () => void;
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
    private positionLoadGeneration = 0;
    private destroyed = false;

    /** Signals bound from the host component via `bind()` */
    private readonly bindings = signal<VodDetailsPlaybackBindings | null>(null);
    private readonly externalLaunchOwner = createExternalLaunchOwner(
        () => this.xtreamStore.currentPlaylist()?.id,
        () => this.bindings()?.vodId()
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
        alsoOwns: computed(
            () =>
                this.externalLaunchOwner.current() ??
                this.bindings()?.activeSource?.() ??
                null
        ),
    });

    readonly matchedExternalPlayback = this.externalButton.matchedSession;
    readonly externalPrimaryLabel = this.externalButton.primaryLabel;
    readonly externalPrimaryIcon = this.externalButton.primaryIcon;
    readonly isExternalLaunchPending = computed(
        () =>
            this.externalLaunchGeneration() !== null ||
            this.externalButton.isLaunchPending()
    );
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

        inject(DestroyRef).onDestroy(() => {
            this.destroyed = true;
            this.positionLoadGeneration++;
            unsubscribePositionUpdates?.();
        });
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

    async playVod(vodItem: XtreamVodDetails | null): Promise<boolean> {
        if (!vodItem) {
            return false;
        }

        const source = resolveXtreamVodPlaybackSource(vodItem);
        if (!source) {
            return false;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return false;
        }

        const presentation = resolveXtreamVodPlaybackPresentation(vodItem);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.bindings()?.vodId();
        const id =
            routeVodId != null &&
            Number.isSafeInteger(routeVodId) &&
            routeVodId > 0
                ? routeVodId
                : source.streamId;

        this.logger.debug('playVod resolved ID', { id, vodItem });

        const contentInfo: PlayerContentInfo = {
            playlistId: playlist.id,
            contentXtreamId: id,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: presentation.title,
            thumbnail: presentation.posterUrl,
            contentInfo,
        };

        return await this.startPlayback(playback);
    }

    async resumeVod(vodItem: XtreamVodDetails | null): Promise<boolean> {
        if (!vodItem) {
            return false;
        }

        const source = resolveXtreamVodPlaybackSource(vodItem);
        if (!source) {
            return false;
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return false;
        }

        const presentation = resolveXtreamVodPlaybackPresentation(vodItem);
        // Master's sparse-details fallback: a provider that omits the route
        // id still has the stream id on the resolved source.
        const routeVodId = this.bindings()?.vodId();
        const vodId =
            routeVodId != null &&
            Number.isSafeInteger(routeVodId) &&
            routeVodId > 0
                ? routeVodId
                : source.streamId;
        // The ROUTE copy's row, not the last position seen: Resume starts the
        // route's stream, and an alternative's timecode belongs to a
        // different (playlist, stream) key.
        const position = this.routePlaybackPosition();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        const contentInfo: PlayerContentInfo = {
            playlistId: playlist.id,
            contentXtreamId: vodId,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: presentation.title,
            thumbnail: presentation.posterUrl,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        return await this.startPlayback(playback);
    }

    onPrimaryAction(vodItem: XtreamVodDetails | null): void {
        if (!vodItem) {
            return;
        }

        if (this.isExternalStopAction()) {
            void this.stopExternalPlayback().catch(() => undefined);
            return;
        }

        if (this.hasPlaybackPosition()) {
            void this.resumeVod(vodItem);
            return;
        }

        void this.playVod(vodItem);
    }

    stopExternalPlayback(): Promise<void> {
        return this.externalPlayback.closeSession(this.matchedExternalPlayback());
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
        const routeIdentity = this.externalLaunchOwner.captureRoute();
        this.bindings()?.supersedePendingSwitch();
        const generation = ++this.startGeneration;
        this.claimExternalLaunch(request.playback, generation);
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void this.settleExternalLaunch(
            generation,
            () => this.externalLaunchOwner.ownsRoute(routeIdentity),
            launch
        );
    }

    async loadPosition(playlistId: string, vodId: number): Promise<void> {
        const generation = ++this.positionLoadGeneration;
        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );
        if (
            this.destroyed ||
            generation !== this.positionLoadGeneration ||
            this.xtreamStore.currentPlaylist()?.id !== playlistId ||
            this.bindings()?.vodId() !== vodId
        ) {
            return;
        }

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
     * Kept independently of the controller so a refresh or an overlapping
     * handoff cannot make the exact process this page launched look foreign
     * before its teardown has been confirmed. Its route owner prevents a
     * reused component from attributing that process to a different movie.
     */
    private launchedExternallyGeneration = 0;
    private readonly externalLaunchGeneration = signal<number | null>(null);

    async startResolvedPlayback(
        playback: ResolvedPortalPlayback,
        isCurrent: () => boolean = () => true
    ): Promise<boolean> {
        if (this.externalLaunchGeneration() !== null) {
            return false;
        }
        const runningSession = runningExternalSession(
            this.externalPlayback.activeSession(),
            this.externalLaunchOwner.retained(),
            this.matchedExternalPlayback()
        );
        // A still-opening process has no exact closer yet. Denying this
        // replacement must not supersede that launch generation, or its late
        // successful result would be closed even though nothing replaced it.
        if (runningSession && !runningSession.canClose) {
            return false;
        }

        const generation = ++this.startGeneration;

        // A switch REPLACES what is playing. With MPV or VLC and instance
        // reuse off, the backend spawns a second detached player otherwise —
        // both sources keep running and Stop owns only the newer one.
        const previousPlayerClosed = await closeRunningExternalSession(
            runningSession,
            (session) => this.externalPlayback.closeSession(session),
            (message, error) => this.logger.warn(message, error)
        );

        // Closing is a round-trip, and a second pick across it would otherwise
        // reach this line too: both would have seen the same session, closed
        // it once, and then launched independently — two detached players
        // again, the older one holding a source the user has moved on from.
        if (
            !previousPlayerClosed ||
            generation !== this.startGeneration ||
            !isCurrent()
        ) {
            return false;
        }

        // Same movie, different source: still a view.
        this.addToRecentlyViewed();
        return await this.applyPlayback(playback, isCurrent);
    }

    private startPlayback(playback: ResolvedPortalPlayback): Promise<boolean> {
        return startRouteOwnedPlayback(this.externalLaunchOwner, (isCurrent) =>
            this.startResolvedPlayback(playback, isCurrent)
        );
    }

    private async applyPlayback(
        playback: ResolvedPortalPlayback,
        isCurrent: () => boolean = () => true
    ): Promise<boolean> {
        // EVERY start claims the generation, not just the switch path. Play,
        // Resume and Restart reach here directly, and a switch still waiting
        // on its `closeSession` would otherwise pass the check afterwards and
        // launch on top of what the user just chose.
        const generation = ++this.startGeneration;
        this.positionWriter.reset();
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            this.externalLaunchOwner.clear();
            this.externalLaunchGeneration.set(null);
            return true;
        }

        this.closeInlinePlayer();
        this.claimExternalLaunch(playback, generation);
        const launch = this.portalPlayer.openResolvedPlayback(playback, true);
        return await this.settleExternalLaunch(
            generation,
            isCurrent,
            launch
        );
    }

    private claimExternalLaunch(
        playback: ResolvedPortalPlayback,
        generation: number
    ): void {
        this.externalLaunchOwner.set(playback.contentInfo);
        this.launchedExternallyGeneration = generation;
        this.externalLaunchGeneration.set(generation);
    }

    private async settleExternalLaunch(
        generation: number,
        isCurrent: () => boolean,
        launch: Promise<ExternalPlayerSession | void>
    ): Promise<boolean> {
        return await settleOwnedExternalLaunch({
            launch,
            owns: () => generation === this.startGeneration && isCurrent(),
            close: (session) => this.externalPlayback.closeSession(session),
            warnCloseFailure: (error) =>
                this.logger.warn(
                    'Closing a superseded external player failed.',
                    error
                ),
            clearPending: () => this.clearExternalLaunchPending(generation),
            clearOwnership: () =>
                this.clearExternalLaunchOwnership(generation),
        });
    }

    private clearExternalLaunchOwnership(generation: number): void {
        if (this.launchedExternallyGeneration === generation) {
            this.externalLaunchOwner.clear();
        }
    }

    private clearExternalLaunchPending(generation: number): void {
        if (this.externalLaunchGeneration() === generation) {
            this.externalLaunchGeneration.set(null);
        }
    }
}
