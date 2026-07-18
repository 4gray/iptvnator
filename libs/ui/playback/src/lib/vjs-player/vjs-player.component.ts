import {
    Component,
    ElementRef,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewEncapsulation,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import '@yangkghjh/videojs-aspect-ratio-panel';
import { createDevLogger } from '@iptvnator/shared/interfaces';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-quality-selector-hls';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.util';
import {
    PlayerControlsComponent,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import {
    VjsAudioTracks,
    logVjsAudioTracks,
    setupVjsAudioTrackMenu,
} from './vjs-audio-tracks';
import { VjsMpegTsSession } from './vjs-mpegts-session';
import { VjsPlayerControlsBridge } from './vjs-player-controls.bridge';
import {
    createVjsPlayerOptions,
    exitOwnedVjsFullscreen,
    initializeVjsPlugins,
    queueVjsTask,
    shouldChangeVjsSource,
} from './vjs-player-setup';
import { VjsPlayerResetCoordinator } from './vjs-player-reset-coordinator';
import {
    type VideoJsPlayer,
    type VideoPlayerOptions,
    type VideoPlayerSource,
    getVideoJsTechVideo,
} from './vjs-player.types';
import { VjsVideoElementSession } from './vjs-video-element-session';

const debugVjsPlayer = createDevLogger('VjsPlayer');

@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
    imports: [
        PlayerControlsComponent,
        SeriesPlaybackNavigationControlsComponent,
    ],
    providers: [WebVideoControlsAdapter],
    standalone: true,
})
export class VjsPlayerComponent implements OnInit, OnChanges, OnDestroy {
    readonly target =
        viewChild.required<ElementRef<HTMLVideoElement>>('target');
    readonly playerRoot = viewChild<ElementRef<HTMLElement>>('playerRoot');
    readonly options = input.required<VideoPlayerOptions>();
    readonly volume = input(1);
    readonly startTime = input(0);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    readonly interactionEnabled = input(true);
    readonly showCaptions = input(false);

    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    readonly sharedControls = inject(WEB_PLAYER_SHARED_CONTROLS);
    readonly controlsAdapter = inject(WebVideoControlsAdapter);
    player!: VideoJsPlayer;

    private readonly seriesNavigationSignal =
        signal<SeriesPlaybackNavigation | null>(null);
    private readonly videoSession = new VjsVideoElementSession({
        clearPlaybackIssue: () => this.playbackIssue.emit(null),
        emitPlaybackEnded: () => this.playbackEnded.emit(),
    });
    private readonly mpegTsSession = new VjsMpegTsSession({
        player: () => this.player,
        isLive: () => this.options().isLive !== false,
        emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
    });
    private readonly resetCoordinator = new VjsPlayerResetCoordinator({
        player: () => this.player,
        fallbackVolume: () => this.volume(),
        queueTask: queueVjsTask,
        reportError: (error) =>
            debugVjsPlayer('Failed to reset Video.js player:', error),
    });
    private controlsBridge: VjsPlayerControlsBridge | null = null;
    private legacyAudioTracks: VjsAudioTracks | null = null;
    private desiredSource: VideoPlayerSource | null = null;
    private readyHandled = false;
    private destroyed = false;

    ngOnInit(): void {
        this.desiredSource = this.options().sources?.[0] ?? null;
        this.seriesNavigationSignal.set(this.seriesNavigation());
        if (this.sharedControls) {
            this.controlsAdapter.setContext({
                seriesNavigation: this.seriesNavigationSignal,
            });
        }

        const vjsOptions = createVjsPlayerOptions(
            this.options(),
            this.mpegTsSession.isSupportedSource(this.desiredSource?.src),
            this.sharedControls
        );
        this.player = videoJs(
            this.target().nativeElement,
            vjsOptions,
            this.handlePlayerReady
        ) as unknown as VideoJsPlayer;
        this.bindPlayerEvents();
        initializeVjsPlugins(this.player);
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['seriesNavigation']) {
            this.seriesNavigationSignal.set(this.seriesNavigation());
        }
        if (changes['options']?.previousValue && this.player) {
            const previousOptions = changes['options']
                .previousValue as VideoPlayerOptions;
            const currentOptions = changes['options']
                .currentValue as VideoPlayerOptions;
            if (
                shouldChangeVjsSource(previousOptions, currentOptions, (url) =>
                    this.mpegTsSession.isSupportedSource(url)
                )
            ) {
                this.changeSource(currentOptions.sources?.[0] ?? null);
            } else {
                this.controlsBridge?.refreshInputs();
            }
        }
        if (changes['showCaptions']) {
            this.controlsBridge?.refreshInputs();
        }
        if (changes['interactionEnabled']?.currentValue === false) {
            exitOwnedVjsFullscreen(
                this.sharedControls,
                this.playerRoot()?.nativeElement,
                (error) =>
                    debugVjsPlayer(
                        'Failed to exit Video.js player fullscreen:',
                        error
                    )
            );
        }
        if (changes['volume']?.currentValue !== undefined && this.player) {
            debugVjsPlayer(
                'Setting VideoJS player volume to:',
                changes['volume'].currentValue
            );
            this.player.volume(changes['volume'].currentValue);
        }
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.resetCoordinator.destroy();
        this.controlsBridge?.destroy();
        this.controlsBridge = null;
        this.legacyAudioTracks?.clear();
        this.legacyAudioTracks = null;
        this.mpegTsSession.destroy();
        this.videoSession.destroy();
        if (this.player) {
            this.unbindPlayerEvents();
            this.player.dispose();
        }
    }

    private readonly handlePlayerReady = () => {
        if (this.destroyed || this.readyHandled) {
            return;
        }
        if (!this.player) {
            queueVjsTask(this.handlePlayerReady);
            return;
        }
        this.readyHandled = true;
        debugVjsPlayer(
            'Setting VideoJS player initial volume to:',
            this.volume()
        );
        this.player.volume(this.volume());
        this.initializeLegacyAudioTracks();
        const video = this.bindCurrentTechVideo();
        if (video && this.resetCoordinator.canApplyReadySource()) {
            this.activateSource(this.desiredSource, video);
        }
    };

    private readonly handleLoadedMetadata = () => {
        this.bindCurrentTechVideo();
        if (this.startTime() > 0) {
            this.player.currentTime(this.startTime());
        }
        this.playbackIssue.emit(null);
        this.legacyAudioTracks?.bind();
        logVjsAudioTracks(this.player);
        setupVjsAudioTrackMenu(this.player);
        this.controlsBridge?.refreshInputs();
    };

    private readonly handleVideoJsError = () => {
        const source = this.desiredSource;
        const video =
            this.videoSession.video() ??
            getVideoJsTechVideo(this.player) ??
            this.target().nativeElement;
        const playerError =
            typeof this.player.error === 'function'
                ? this.player.error()
                : null;
        this.mpegTsSession.syncDuration();
        this.playbackIssue.emit(
            classifyNativePlaybackIssue(
                playerError ?? video.error,
                createPlaybackSourceMetadata({
                    url: source?.src ?? video.currentSrc ?? '',
                    mimeType: source?.type,
                    player: InlinePlaybackPlayer.VideoJs,
                })
            )
        );
    };

    private readonly handleVolumeChange = () => {
        if (this.resetCoordinator.shouldSuppressVolumeChange()) {
            return;
        }
        const currentVolume = this.player.volume() ?? this.volume();
        localStorage.setItem('volume', currentVolume.toString());
    };

    private readonly handleTimeUpdate = () => {
        this.timeUpdate.emit({
            currentTime: this.player.currentTime() ?? 0,
            duration: this.player.duration() ?? 0,
        });
    };

    private readonly handlePlayerReset = () => {
        this.player.volume(this.resetCoordinator.handlePlayerReset());
        this.controlsBridge?.clearSource();
        this.legacyAudioTracks?.clear();
        this.mpegTsSession.destroy();
        this.restoreDesiredSourceAfterReset(true);
    };

    private readonly handlePauseForReset = () => {
        this.resetCoordinator.handlePause();
    };

    private changeSource(source: VideoPlayerSource | null): void {
        this.playbackIssue.emit(null);
        this.controlsBridge?.clearSource();
        this.legacyAudioTracks?.clear();
        this.mpegTsSession.destroy();
        this.desiredSource = source;
        this.resetCoordinator.clearSourceApplied();

        if (!source || this.mpegTsSession.isSupportedSource(source.src)) {
            this.resetCoordinator.requestReset();
            return;
        }

        if (this.resetCoordinator.cancelPendingReset()) {
            return;
        }
        this.player.src(source);
        this.controlsBridge?.setSource();
        this.resetCoordinator.markSourceApplied();
    }

    private restoreDesiredSourceAfterReset(allowRetry: boolean): void {
        if (this.destroyed) {
            return;
        }
        const video = this.bindCurrentTechVideo();
        if (!video) {
            if (allowRetry) {
                queueVjsTask(() => this.restoreDesiredSourceAfterReset(false));
            }
            return;
        }

        const source = this.desiredSource;
        if (!source) {
            this.resetCoordinator.markSourceApplied();
            return;
        }
        if (this.mpegTsSession.isSupportedSource(source.src)) {
            this.activateSource(source, video);
            return;
        }

        this.player.src(source);
        this.controlsBridge?.setSource();
        this.legacyAudioTracks?.bind();
        this.resetCoordinator.markSourceApplied();
    }

    private activateSource(
        source: VideoPlayerSource | null,
        video: HTMLVideoElement
    ): void {
        if (!source) {
            this.resetCoordinator.markSourceApplied();
            return;
        }
        this.controlsBridge?.setSource();
        this.legacyAudioTracks?.bind();
        if (this.mpegTsSession.isSupportedSource(source.src)) {
            debugVjsPlayer('Using mpegts.js for TS stream:', source.src);
            this.mpegTsSession.start(source.src, video);
        }
        this.resetCoordinator.markSourceApplied();
    }

    private bindCurrentTechVideo(): HTMLVideoElement | null {
        const video = getVideoJsTechVideo(this.player);
        if (!video) {
            return null;
        }
        this.videoSession.bind(video);
        if (this.sharedControls) {
            if (!this.controlsBridge) {
                this.controlsBridge = new VjsPlayerControlsBridge({
                    player: this.player,
                    adapter: this.controlsAdapter,
                    isLive: () => this.options().isLive !== false,
                    showCaptions: () => this.showCaptions(),
                });
                this.controlsBridge.attach(video);
            } else {
                this.controlsBridge.rebind(video);
            }
        }
        return video;
    }

    private initializeLegacyAudioTracks(): void {
        if (this.sharedControls || this.legacyAudioTracks) {
            return;
        }
        this.legacyAudioTracks = new VjsAudioTracks({
            player: this.player,
            refresh: () => undefined,
        });
        this.legacyAudioTracks.bind();
    }

    private bindPlayerEvents(): void {
        this.player.on('loadedmetadata', this.handleLoadedMetadata);
        this.player.on('error', this.handleVideoJsError);
        this.player.on('volumechange', this.handleVolumeChange);
        this.player.on('timeupdate', this.handleTimeUpdate);
        this.player.on('pause', this.handlePauseForReset);
        this.player.on('playerreset', this.handlePlayerReset);
    }

    private unbindPlayerEvents(): void {
        this.player.off('loadedmetadata', this.handleLoadedMetadata);
        this.player.off('error', this.handleVideoJsError);
        this.player.off('volumechange', this.handleVolumeChange);
        this.player.off('timeupdate', this.handleTimeUpdate);
        this.player.off('pause', this.handlePauseForReset);
        this.player.off('playerreset', this.handlePlayerReset);
    }
}
