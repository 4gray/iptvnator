import {
    Component,
    OnDestroy,
    Signal,
    ViewEncapsulation,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { StorageMap } from '@ngx-pwa/local-storage';
import {
    type PlaybackDiagnostic,
    type PlaybackDiagnosticCode,
    type PlaybackFallbackRequest,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    STORE_KEY,
    VideoPlayer,
    type Channel,
    type ResolvedPortalPlayback,
    type Settings,
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
import {
    type PlaybackBinding,
    PlaybackRecoverySession,
} from './playback-recovery-session';
import { WebPlayerApplicationHandoffCoordinator } from './web-player-application-handoff';
import {
    createWebPlayerApplicationState,
    type WebPlayerApplicationToken,
    type WebPlayerSourceRevisionToken,
} from './web-player-application-state';
import { resolveWebPlayerMediaTitle } from './web-player-playback-state';
import {
    createWebPlayerRecommendations,
    isPlaybackExternallyTransferable,
    toInlinePlaybackPlayer,
    toVideoPlayer,
} from './web-player-recovery-policy';

function resolveWebPlayerSharedControls(): boolean {
    const storedValue = inject(SettingsStore).webPlayerSharedControls?.();
    return typeof storedValue === 'boolean'
        ? storedValue
        : WEB_PLAYER_SHARED_CONTROLS_ENABLED;
}

interface PlaybackApplicationOwnership {
    readonly binding: PlaybackBinding | null;
    readonly embeddedMpv: boolean;
    readonly isLive: boolean;
    readonly sourceRevision: WebPlayerSourceRevisionToken;
    readonly token: WebPlayerApplicationToken;
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
    private readonly storage = inject(StorageMap);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly recoverySession = new PlaybackRecoverySession();
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

    readonly settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings | undefined>;
    readonly showCaptions = computed(
        () => this.settingsStore.showCaptions?.() ?? false
    );
    readonly reloadToken = signal(0);
    readonly playbackDiagnostic = signal<PlaybackDiagnostic | null>(null);
    readonly recoveryPending = this.recoverySession.switchPending;
    readonly activeBinding = this.recoverySession.activeBinding;

    channel: Channel | undefined;
    vjsOptions: VideoPlayerOptions | undefined;

    readonly selectedPlayer = computed<VideoPlayer>(() => {
        const temporary = this.recoverySession.temporaryPlayerOverride();
        return temporary
            ? toVideoPlayer(temporary)
            : (this.playerOverride() ??
                  this.settings()?.player ??
                  VideoPlayer.VideoJs);
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
    readonly effectiveStartTime = computed(() =>
        this.recoverySession.resumeStartTime(
            this.startTime(),
            this.resolvedIsLive()
        )
    );
    readonly visiblePlaybackDiagnostic = computed(() =>
        this.selectedPlayer() === VideoPlayer.EmbeddedMpv
            ? null
            : this.playbackDiagnostic()
    );
    readonly playbackInteractionEnabled = computed(
        () => this.visiblePlaybackDiagnostic() === null
    );
    readonly resolvedMediaTitle = computed(() =>
        resolveWebPlayerMediaTitle(this.mediaTitle(), this.resolvedPlayback())
    );
    readonly playbackExternallyTransferable = computed(() =>
        isPlaybackExternallyTransferable(this.resolvedPlayback())
    );
    readonly recordingFolder = computed(
        () => this.settings()?.recordingFolder ?? ''
    );
    get supportsManagedExternalPlayers(): boolean {
        return this.runtime.supportsManagedExternalPlayers;
    }
    readonly recommendations = computed(() => {
        const binding = this.activeBinding();
        const token = this.playbackApplicationToken();
        return createWebPlayerRecommendations({
            diagnostic: this.visiblePlaybackDiagnostic(),
            binding:
                binding && this.applicationHandoff.owns(binding, token)
                    ? binding
                    : null,
            attemptedTargets: this.recoverySession.attemptedTargets(),
            managedExternalPlayersAvailable:
                this.runtime.supportsManagedExternalPlayers,
            playbackExternallyTransferable:
                this.playbackExternallyTransferable(),
            isLive: this.resolvedIsLive(),
            alternativeSourceCount: this.alternativeSources().length,
        });
    });
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
            this.syncRecoverySession();
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
            if (target === null) {
                this.applicationHandoff.release();
                this.recoverySession.clearPlaybackBinding();
                this.playbackDiagnostic.set(null);
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
                    this.playbackDiagnostic.set(null);
                }
            );
        });
    }

    ngOnDestroy(): void {
        this.applicationHandoff.destroy();
    }

    handlePlaybackIssue(
        issue: PlaybackDiagnostic | null,
        binding: PlaybackBinding
    ): void {
        this.syncRecoverySession();
        if (!this.recoverySession.accepts(binding)) {
            return;
        }
        if (
            !this.applicationHandoff.owns(
                binding,
                this.playbackApplicationToken()
            )
        ) {
            this.applicationHandoff.invalidate();
            this.recoverySession.clearPlaybackBinding();
            this.playbackDiagnostic.set(null);
            return;
        }
        if (!issue) {
            this.recoverySession.settle(binding);
            this.playbackDiagnostic.set(null);
            return;
        }
        if (!this.recoverySession.recordFailure(binding)) {
            return;
        }
        this.playbackDiagnostic.set(issue);
        this.playbackFailed.emit(issue.code);
    }

    handleTimeUpdate(
        event: { currentTime: number; duration: number },
        ownership: PlaybackApplicationOwnership
    ): void {
        if (!this.ownsPlaybackApplication(ownership)) {
            return;
        }

        this.recoverySession.recordTimeUpdate(event, ownership.isLive);
        this.timeUpdate.emit(event);
    }

    requestRecommendedPlayer(target: PlaybackRecommendationTarget): void {
        const diagnostic = this.visiblePlaybackDiagnostic();
        if (!diagnostic) {
            return;
        }
        const available = this.recommendations().some(
            (item) => item.action === 'player' && item.target === target
        );
        if (!available) {
            if (target !== 'mpv' && target !== 'vlc') {
                this.recoverySession.recordInlineAttempt(target);
            }
            return;
        }
        if (target === 'mpv' || target === 'vlc') {
            this.recoverySession.recordExternalAttempt(target);
            this.externalFallbackRequested.emit({
                player: target,
                playback: this.resolvedPlayback(),
                diagnostic,
            });
            return;
        }
        this.recoverySession.beginPlayerSwitch(target, this.resolvedIsLive());
    }

    retryPlayback(): void {
        if (!this.recoverySession.beginRetry()) {
            return;
        }
        this.reloadToken.update((value) => value + 1);
    }

    private syncRecoverySession(): void {
        const sessionKey = this.playbackSessionKey();
        if (untracked(() => this.recoverySession.syncSession(sessionKey))) {
            this.playbackDiagnostic.set(null);
        }
    }

    private ownsPlaybackApplication(
        ownership: PlaybackApplicationOwnership
    ): boolean {
        if (
            ownership.token !== this.playbackApplicationToken() ||
            ownership.sourceRevision !== this.playbackSourceRevisionToken()
        ) {
            return false;
        }
        if (ownership.binding) {
            return (
                !ownership.embeddedMpv &&
                this.applicationHandoff.owns(ownership.binding, ownership.token)
            );
        }
        return (
            ownership.embeddedMpv &&
            this.selectedPlayer() === VideoPlayer.EmbeddedMpv
        );
    }
}
