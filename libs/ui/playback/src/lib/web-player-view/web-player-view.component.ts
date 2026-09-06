import {
    Component,
    ElementRef,
    Injector,
    OnDestroy,
    ViewEncapsulation,
    computed,
    effect,
    inject,
    input,
    linkedSignal,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import {
    type PlaybackDiagnostic,
    type PlaybackDiagnosticCode,
    type PlaybackFallbackRequest,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type Channel,
    type RecordingStartMetadata,
    type RecordingStoppedEvent,
    type ResolvedPortalPlayback,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import { ArtPlayerComponent } from '../art-player/art-player.component';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { FullscreenChannelPanelComponent } from '../fullscreen-channel-panel/fullscreen-channel-panel.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
import {
    type PlayerMediaTitle,
    WEB_PLAYER_SHARED_CONTROLS,
    WEB_PLAYER_SHARED_CONTROLS_ENABLED,
} from '../player-controls';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import type { VideoPlayerOptions } from '../vjs-player/vjs-player.types';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';
import { ExternalPlaybackRecoveryCoordinator } from './external-playback-recovery-coordinator';
import {
    type PlaybackBinding,
    PlaybackRecoverySession,
} from './playback-recovery-session';
import { WebPlayerApplicationHandoffCoordinator } from './web-player-application-handoff';
import {
    ownsPlaybackApplication,
    type PlaybackApplicationOwnership,
} from './web-player-application-ownership';
import { createWebPlayerApplicationState } from './web-player-application-state';
import { resolveWebPlayerMediaTitle } from './web-player-playback-state';
import { createChannelPanelAvailability } from './web-player-channel-panel-state';
import { WebPlayerLiveAutoFormat } from './web-player-live-auto-format';
import { WebPlayerRecoveryController } from './web-player-recovery-controller';
import {
    isPlaybackExternallyTransferable,
    resolveRenderableWebPlayer,
    toInlinePlaybackPlayer,
    toVideoPlayer,
} from './web-player-recovery-policy';

function resolveWebPlayerSharedControls(): boolean {
    const storedValue = inject(SettingsStore).webPlayerSharedControls?.();
    const fallback = WEB_PLAYER_SHARED_CONTROLS_ENABLED;
    return typeof storedValue === 'boolean' ? storedValue : fallback;
}

@Component({
    selector: 'app-web-player-view',
    templateUrl: './web-player-view.component.html',
    styleUrls: ['./web-player-view.component.scss'],
    host: { class: 'web-player-view' },
    imports: [
        ArtPlayerComponent,
        EmbeddedMpvPlayerComponent,
        FullscreenChannelPanelComponent,
        HtmlVideoPlayerComponent,
        PlaybackDiagnosticPanelComponent,
        VjsPlayerComponent,
    ],
    providers: [
        {
            provide: WEB_PLAYER_SHARED_CONTROLS,
            useFactory: resolveWebPlayerSharedControls,
        },
    ],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent implements OnDestroy {
    /**
     * DOM fullscreen owner handed to every rendered player. Applications are
     * remounted per token (`@for ... track application.token` below), and
     * the Fullscreen API exits the moment its element leaves the document,
     * so a fullscreen owned by the player shell would end with every
     * episode, channel, or alternative-source switch. This host element
     * spans all applications of one mount: fullscreen entered on episode 1
     * is still in place when episode 2's engine mounts, and the fresh
     * controls pick it up through `ControlsFullscreen.sync()`. It is also
     * the stage the fullscreen channel panel tracks, so the panel sits inside
     * the fullscreen element and survives the same remounts.
     */
    readonly fullscreenSurface: HTMLElement = inject(ElementRef<HTMLElement>)
        .nativeElement;
    private readonly embeddedMpvPlayer =
        viewChild<EmbeddedMpvPlayerComponent>('embeddedMpvPlayer');
    readonly channelPanelAvailable = createChannelPanelAvailability(
        () => this.renderedApplications().some((app) => app.embeddedMpv),
        () => this.embeddedMpvPlayer()?.support() ?? null
    );
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK, {
        optional: true,
    });
    private readonly recoverySession = new PlaybackRecoverySession();
    private readonly externalRecovery = new ExternalPlaybackRecoveryCoordinator(
        this.externalPlayback
    );
    private readonly applicationHandoff =
        new WebPlayerApplicationHandoffCoordinator(
            inject(ElectronStreamHeadersService),
            this.recoverySession
        );

    readonly streamUrl = input.required<string>();
    readonly playbackSessionKey = input.required<string>();
    readonly title = input('');
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly startTime = input(0);
    readonly volume = input(1);
    readonly playerOverride = input<VideoPlayer | null>(null);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly alternativeSources = input<VodSourceDescriptor[]>([]);
    /** Channel/EPG snapshot for the embedded-MPV recording tracker. */
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);

    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly alternativeSourceRequested = output<string>();
    readonly sourceCheckRequested = output<string>();
    readonly playbackFailed = output<PlaybackDiagnosticCode>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    /** Re-emitted embedded-MPV clean recording stop (stop enrichment). */
    readonly recordingStopped = output<RecordingStoppedEvent>();

    readonly showCaptions = computed(
        () => this.settingsStore.showCaptions?.() ?? false
    );
    readonly reloadToken = signal(0);
    readonly externalRecoveryState = this.externalRecovery.states;
    readonly externalRecoveryPending = this.externalRecovery.pending;
    readonly recoveryPending = computed(
        () =>
            this.recoverySession.switchPending() ||
            this.externalRecoveryPending()
    );
    readonly activeBinding = this.recoverySession.activeBinding;

    /**
     * Source handed to the rendered engine. Signals, not plain fields: in
     * Electron the handoff lands in the stream-header IPC promise, after the
     * change-detection pass that mounted the application, and this view sits
     * under OnPush hosts (`PortalInlinePlayerComponent`) — a plain field set
     * there was only rendered when something else happened to dirty the
     * subtree, which used to be the fullscreen exit on every episode switch.
     */
    readonly channel = signal<Channel | undefined>(undefined);
    readonly vjsOptions = signal<VideoPlayerOptions | undefined>(undefined);

    // Resolved from the live SettingsStore signal, not a mount-time storage
    // snapshot: a saved player change (settings page, command palette) must
    // reach an already-mounted player without a remount. A saved managed
    // MPV/VLC retains the mounted engine (resolveRenderableWebPlayer),
    // because this view can neither render nor launch external players.
    private readonly renderablePlayer = linkedSignal({
        source: () =>
            this.playerOverride() ??
            this.settingsStore.player?.() ??
            VideoPlayer.VideoJs,
        computation: resolveRenderableWebPlayer,
    });
    readonly selectedPlayer = computed<VideoPlayer>(() => {
        const temporary = this.recoverySession.temporaryPlayerOverride();
        return temporary ? toVideoPlayer(temporary) : this.renderablePlayer();
    });
    private readonly liveAutoFormat = new WebPlayerLiveAutoFormat({
        playback: this.playback,
        sessionKey: this.playbackSessionKey,
        player: this.selectedPlayer,
        intent: this.reloadToken,
        autoEnabled: () =>
            (this.settingsStore.streamFormat?.() ?? 'auto') === 'auto',
        injector: inject(Injector),
    });
    private readonly applicationState = createWebPlayerApplicationState({
        playback: this.liveAutoFormat.playback,
        streamUrl: this.streamUrl,
        title: this.title,
        startTime: this.startTime,
        selectedPlayer: this.selectedPlayer,
        reloadToken: this.reloadToken,
    });
    readonly resolvedPlayback = this.applicationState.playback;
    readonly resolvedIsLive = this.applicationState.isLive;
    readonly playbackSourceRevisionToken = this.applicationState.sourceRevision;
    readonly playbackApplicationToken = this.applicationState.token;
    readonly playbackExternallyTransferable = computed(() =>
        isPlaybackExternallyTransferable(this.resolvedPlayback())
    );
    private readonly recovery = new WebPlayerRecoveryController({
        recoverySession: this.recoverySession,
        externalRecovery: this.externalRecovery,
        applicationHandoff: this.applicationHandoff,
        playbackSessionKey: this.playbackSessionKey,
        playback: this.liveAutoFormat.playback,
        streamUrl: this.streamUrl,
        startTime: this.startTime,
        selectedPlayer: this.selectedPlayer,
        reloadToken: this.reloadToken,
        playbackApplicationToken: this.playbackApplicationToken,
        resolvedPlayback: this.resolvedPlayback,
        resolvedIsLive: this.resolvedIsLive,
        playbackExternallyTransferable: this.playbackExternallyTransferable,
        alternativeSourceCount: () => this.alternativeSources().length,
        managedExternalPlayersAvailable: () =>
            this.runtime.supportsManagedExternalPlayers,
        tryAutoLiveFormat: (issue) => this.liveAutoFormat.tryFallback(issue),
        emitPlaybackFailed: (code) => this.playbackFailed.emit(code),
        emitExternalFallbackRequested: (request) =>
            this.externalFallbackRequested.emit(request),
    });
    readonly playbackDiagnostic = this.recovery.playbackDiagnostic;
    readonly visiblePlaybackDiagnostic =
        this.recovery.visiblePlaybackDiagnostic;
    readonly recommendations = this.recovery.recommendations;
    readonly effectiveStartTime = computed(() =>
        this.recoverySession.resumeStartTime(
            this.startTime(),
            this.resolvedIsLive()
        )
    );
    readonly playbackInteractionEnabled = computed(
        () => this.visiblePlaybackDiagnostic() === null
    );
    readonly resolvedMediaTitle = computed(() =>
        resolveWebPlayerMediaTitle(this.mediaTitle(), this.resolvedPlayback())
    );
    readonly recordingFolder = computed(
        () => this.settingsStore.recordingFolder?.() ?? ''
    );
    get supportsManagedExternalPlayers(): boolean {
        return this.runtime.supportsManagedExternalPlayers;
    }
    readonly renderedApplications = computed<
        readonly PlaybackApplicationOwnership[]
    >(() => {
        if (this.liveAutoFormat.pending()) return [];
        const binding = this.activeBinding();
        const embeddedMpv =
            this.selectedPlayer() === VideoPlayer.EmbeddedMpv && !binding;
        if (!binding && !embeddedMpv) {
            return [];
        }

        return [
            Object.freeze({
                binding,
                embeddedMpv,
                isLive: this.resolvedIsLive(),
                sourceRevision: this.playbackSourceRevisionToken(),
                token: this.playbackApplicationToken(),
            }),
        ];
    });

    constructor() {
        effect(() => {
            const session = this.externalPlayback?.activeSession() ?? null;
            untracked(() => this.externalRecovery.observe(session));
        });
        effect(() => {
            // Session sync may clear a temporary player override. Run it before
            // tracking intent so that reset is folded into this application.
            this.recovery.syncSession();
            if (this.liveAutoFormat.pending()) return;
            void this.recovery.diagnosticIntentToken();
            const sourceRevision = this.playbackSourceRevisionToken();
            untracked(() =>
                this.recoverySession.syncSourceRevision(sourceRevision)
            );
            const token = this.playbackApplicationToken();
            const playback = untracked(this.resolvedPlayback);
            const isLive = untracked(this.resolvedIsLive);
            const selectedPlayer = untracked(this.selectedPlayer);
            const reloadToken = untracked(this.reloadToken);
            const target = toInlinePlaybackPlayer(selectedPlayer);
            this.channel.set(undefined);
            this.vjsOptions.set(undefined);
            this.recovery.clearDiagnostic();
            if (target === null) {
                this.applicationHandoff.release();
                this.recoverySession.clearPlaybackBinding();
                return;
            }
            const binding = untracked(() =>
                this.recoverySession.beginPlayback(target)
            );
            this.applicationHandoff.apply(
                playback,
                isLive,
                reloadToken,
                binding,
                token,
                () => this.playbackApplicationToken(),
                (handoff) => {
                    this.channel.set(handoff.channel);
                    this.vjsOptions.set(handoff.vjsOptions);
                }
            );
        });
    }

    ngOnDestroy(): void {
        this.liveAutoFormat.destroy();
        this.externalRecovery.destroy();
        this.applicationHandoff.destroy();
    }

    handlePlaybackIssue(
        issue: PlaybackDiagnostic | null,
        binding: PlaybackBinding
    ): void {
        this.recovery.handlePlaybackIssue(issue, binding);
    }

    handlePlaybackStarted(binding: PlaybackBinding): void {
        this.recovery.syncSession();
        if (
            this.applicationHandoff.owns(
                binding,
                this.playbackApplicationToken()
            ) &&
            !this.liveAutoFormat.pending()
        )
            this.liveAutoFormat.started();
    }

    handleTimeUpdate(
        event: { currentTime: number; duration: number },
        ownership: PlaybackApplicationOwnership
    ): void {
        if (
            !ownsPlaybackApplication({
                ownership,
                currentToken: this.playbackApplicationToken(),
                currentSourceRevision: this.playbackSourceRevisionToken(),
                bindingOwned: ownership.binding
                    ? this.applicationHandoff.owns(
                          ownership.binding,
                          ownership.token
                      )
                    : false,
                embeddedMpvSelected:
                    this.selectedPlayer() === VideoPlayer.EmbeddedMpv,
            })
        ) {
            return;
        }

        this.recoverySession.recordTimeUpdate(event, ownership.isLive);
        this.timeUpdate.emit(event);
    }

    requestRecommendedPlayer(target: PlaybackRecommendationTarget): void {
        this.recovery.requestRecommendedPlayer(target);
    }

    retryPlayback(): void {
        this.recovery.retryPlayback();
    }
}
