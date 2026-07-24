import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    input,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
    viewChild,
    ViewChild,
    signal,
} from '@angular/core';
import Hls, { type ErrorData, type ManifestParsedData } from 'hls.js';
import mpegts from 'mpegts.js';
import { Channel, createDevLogger } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    getPlaybackMediaExtensionFromUrl,
} from '../playback-diagnostics/playback-diagnostics.util';
import {
    PlayerControlsComponent,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { exitOwnedFullscreen } from '../web-video-support/exit-owned-fullscreen.util';
import {
    clearNativeVideoSources,
    setNativeVideoSource,
} from '../web-video-support/web-video-native-source.util';
import { HtmlVideoElementSession } from './html-video-element-session';
import {
    emitFatalHlsPlaybackError,
    emitMpegTsPlaybackError,
    emitUnsupportedHlsManifestCodecs,
} from './html-video-player-diagnostics';
import {
    HtmlVideoPlayerControlsBridge,
    type HtmlVideoControlsSource,
} from './html-video-player-controls.bridge';

const debugHtmlPlayer = createDevLogger('HtmlVideoPlayer');

/**
 * This component contains the implementation of HTML5 based video player
 */
@Component({
    selector: 'app-html-video-player',
    templateUrl: './html-video-player.component.html',
    styleUrls: ['./html-video-player.component.scss'],
    imports: [
        PlayerControlsComponent,
        SeriesPlaybackNavigationControlsComponent,
    ],
    providers: [WebVideoControlsAdapter],
    standalone: true,
})
export class HtmlVideoPlayerComponent implements OnInit, OnChanges, OnDestroy {
    /** Channel to play  */
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() startTime = 0;
    @Input() seriesNavigation: SeriesPlaybackNavigation | null = null;
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly showCaptions = input(false);
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    @Output() playbackIssue = new EventEmitter<PlaybackDiagnostic | null>();
    @Output() playbackEnded = new EventEmitter<void>();
    @Output() previousEpisodeRequested = new EventEmitter<void>();
    @Output() nextEpisodeRequested = new EventEmitter<void>();

    readonly sharedControls = inject(WEB_PLAYER_SHARED_CONTROLS);
    readonly controlsAdapter = inject(WebVideoControlsAdapter);
    private readonly seriesNavigationSignal =
        signal<SeriesPlaybackNavigation | null>(null);

    /** Video player DOM element */
    readonly playerRoot = viewChild<ElementRef<HTMLElement>>('playerRoot');

    @ViewChild('videoPlayer', { static: true })
    videoPlayer!: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls: Hls | null = null;
    /** mpegts.js player for raw MPEG-TS streams */
    private mpegtsPlayer: mpegts.Player | null = null;
    /** Shaka session for DASH (.mpd) streams, created on first use */
    private shakaSession: ShakaVideoSession | null = null;
    private controlsSource: HtmlVideoControlsSource | null = null;
    private controlsBridge: HtmlVideoPlayerControlsBridge | null = null;
    private videoSession: HtmlVideoElementSession | null = null;

    ngOnInit() {
        if (this.sharedControls) {
            this.seriesNavigationSignal.set(this.seriesNavigation);
            this.controlsAdapter.setContext({
                seriesNavigation: this.seriesNavigationSignal,
            });
            this.controlsBridge = new HtmlVideoPlayerControlsBridge({
                video: this.videoPlayer.nativeElement,
                adapter: this.controlsAdapter,
                isLive: () => this.isLive(),
                showCaptions: () => this.showCaptions(),
            });
            this.controlsBridge.attach();
            if (this.controlsSource) {
                this.controlsBridge.setSource(this.controlsSource);
            }
        }
        this.getVideoSession().attach();
    }

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['seriesNavigation']) {
            this.seriesNavigationSignal.set(this.seriesNavigation);
        }
        if (changes['channel'] && changes['channel'].currentValue) {
            this.playChannel(changes['channel'].currentValue);
        }
        if (changes['isLive'] || changes['showCaptions']) {
            this.controlsBridge?.refreshInputs();
        }
        if (changes['interactionEnabled']?.currentValue === false) {
            exitOwnedFullscreen(
                this.sharedControls,
                this.playerRoot()?.nativeElement,
                (error) =>
                    debugHtmlPlayer(
                        'Failed to exit HTML5 player fullscreen:',
                        error
                    )
            );
        }
        if (changes['volume']?.currentValue !== undefined) {
            debugHtmlPlayer(
                'Setting HTML5 player volume to:',
                changes['volume'].currentValue
            );
            this.videoPlayer.nativeElement.volume =
                changes['volume'].currentValue;
        }
    }

    /**
     * Starts to play the given channel
     * @param channel given channel object
     */
    playChannel(channel: Channel): void {
        this.clearControlsSource();
        this.destroyMpegtsPlayer();
        this.destroyHls();
        this.shakaSession?.stop();
        clearNativeVideoSources(this.videoPlayer.nativeElement);
        if (channel.url) {
            this.playbackIssue.emit(null);
            const url = channel.url + (channel.epgParams ?? '');
            const extension = getPlaybackMediaExtensionFromUrl(channel.url);

            void window.electron
                ?.setUserAgent(
                    channel.http?.['user-agent'],
                    channel.http?.referrer,
                    channel.url
                )
                .catch((error: unknown) => {
                    console.warn(
                        '[HtmlVideoPlayer] Failed to configure Electron request headers:',
                        error
                    );
                });

            if (extension === 'mpd') {
                debugHtmlPlayer(
                    'Using Shaka Player for DASH stream:',
                    channel.name,
                    url
                );
                const session = this.getShakaSession();
                this.bindControlsSource({ kind: 'shaka', session });
                session.start(
                    this.videoPlayer.nativeElement,
                    url,
                    channel.drm
                );
                if (channel.drm && !channel.drm.supported) {
                    // No source is loaded for unsupported DRM; reset the
                    // element so the previous stream cannot resume playing
                    // underneath the diagnostic banner.
                    this.videoPlayer.nativeElement.load();
                } else {
                    this.handlePlayOperation();
                }
            } else if (
                (extension === 'ts' || !extension) &&
                mpegts.isSupported()
            ) {
                debugHtmlPlayer(
                    'Using mpegts.js for TS stream:',
                    channel.name,
                    url
                );
                this.mpegtsPlayer = mpegts.createPlayer({
                    type: 'mpegts',
                    isLive: this.isLive(),
                    url: url,
                });
                this.mpegtsPlayer.attachMediaElement(
                    this.videoPlayer.nativeElement
                );
                this.bindControlsSource({ kind: 'mpegts' });
                this.mpegtsPlayer.on(
                    mpegts.Events.ERROR,
                    (type: string, details: string, info: unknown): void => {
                        emitMpegTsPlaybackError(
                            url,
                            { type, details, info },
                            (issue) => this.playbackIssue.emit(issue)
                        );
                    }
                );
                this.mpegtsPlayer.load();
                this.handlePlayOperation();
            } else if (
                extension !== 'mp4' &&
                extension !== 'mpv' &&
                Hls &&
                Hls.isSupported()
            ) {
                debugHtmlPlayer('Switching channel to:', channel.name, url);
                const hls = new Hls();
                this.hls = hls;
                hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                    this.handleHlsManifestParsed(url, data);
                });
                hls.on(Hls.Events.ERROR, (_, data) => {
                    this.handleHlsError(url, data);
                });
                hls.attachMedia(this.videoPlayer.nativeElement);
                this.bindControlsSource({ kind: 'hls', hls });
                hls.loadSource(url);
                this.handlePlayOperation();
            } else {
                debugHtmlPlayer('Using native video player');
                setNativeVideoSource(
                    this.videoPlayer.nativeElement,
                    url,
                    'video/mp4'
                );
                this.bindControlsSource({ kind: 'native' });
                this.videoPlayer.nativeElement.load();
                this.handlePlayOperation();
            }
        }
    }

    private bindControlsSource(source: HtmlVideoControlsSource): void {
        this.controlsSource = source;
        this.controlsBridge?.setSource(source);
    }

    private clearControlsSource(): void {
        this.controlsBridge?.clearSource();
        this.controlsSource = null;
    }

    private destroyMpegtsPlayer(): void {
        const player = this.mpegtsPlayer;
        this.mpegtsPlayer = null;
        if (!player) {
            return;
        }
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
    }

    private destroyHls(): void {
        const hls = this.hls;
        this.hls = null;
        hls?.destroy();
    }

    private getShakaSession(): ShakaVideoSession {
        this.shakaSession ??= new ShakaVideoSession({
            player: InlinePlaybackPlayer.Html5,
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
            showCaptions: () => this.showCaptions(),
        });
        return this.shakaSession;
    }

    /**
     * Disables text based captions based on the global settings
     */
    disableCaptions(): void {
        this.getVideoSession().disableCaptions();
    }

    /**
     * Handles promise based play operation
     */
    handlePlayOperation(): void {
        this.getVideoSession().play();
    }

    private handleHlsManifestParsed(
        url: string,
        data: ManifestParsedData
    ): void {
        emitUnsupportedHlsManifestCodecs(url, data, (issue) =>
            this.playbackIssue.emit(issue)
        );
    }

    private handleHlsError(url: string, data: ErrorData): void {
        emitFatalHlsPlaybackError(url, data, (issue) =>
            this.playbackIssue.emit(issue)
        );
    }

    /**
     * Destroy hls instance on component destroy and clean up event listener
     */
    ngOnDestroy(): void {
        this.controlsBridge?.destroy();
        this.controlsBridge = null;
        this.controlsSource = null;
        this.videoSession?.destroy();
        this.videoSession = null;
        this.destroyMpegtsPlayer();
        this.destroyHls();
        this.shakaSession?.destroy();
        this.shakaSession = null;
    }

    private getVideoSession(): HtmlVideoElementSession {
        this.videoSession ??= new HtmlVideoElementSession({
            video: this.videoPlayer.nativeElement,
            getChannelUrl: () => this.channel?.url,
            getStartTime: () => this.startTime,
            showCaptions: () => this.showCaptions(),
            sharedControls: () => this.sharedControls,
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
            emitTimeUpdate: (value) => this.timeUpdate.emit(value),
            emitPlaybackEnded: () => this.playbackEnded.emit(),
        });
        return this.videoSession;
    }
}
