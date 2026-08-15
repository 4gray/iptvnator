import {
    Component,
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

    channel: Channel | undefined;
    vjsOptions: VideoPlayerOptions | undefined;

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
        return temporary
            ? toVideoPlayer(temporary)
            : this.renderablePlayer();
    });
    private readonly applicationState = createWebPlayerApplicationState({
        playback: this.playback,
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
        playback: this.playback,
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
            this.channel = undefined;
            this.vjsOptions = undefined;
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
                    this.channel = handoff.channel;
                    this.vjsOptions = handoff.vjsOptions;
                }
            );
        });
    }

    ngOnDestroy(): void {
        this.externalRecovery.destroy();
        this.applicationHandoff.destroy();
    }

    handlePlaybackIssue(
        issue: PlaybackDiagnostic | null,
        binding: PlaybackBinding
    ): void {
        this.recovery.handlePlaybackIssue(issue, binding);
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
