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
    PlaybackSourceKind,
    resolvePlaybackUrlSourceKind,
} from '@iptvnator/playback/util';
import {
    type LegacyPlayerShortcuts,
    PlayerControlsComponent,
    type PlayerMediaTitle,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { exitOwnedFullscreen } from '../web-video-support/exit-owned-fullscreen.util';
import {
    clearNativeVideoSources,
    resolveNativeSourceMimeType,
    setNativeVideoSource,
} from '../web-video-support/web-video-native-source.util';
import { WebVideoSourceTracks } from '../web-video-support/web-video-source-tracks';
import { attachHtmlVideoLegacyShortcuts } from './html-video-legacy-shortcuts';
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
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    /** See `PlayerControlsComponent.fullscreenTarget`; null keeps the shell. */
    readonly fullscreenTarget = input<HTMLElement | null>(null);
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
    /**
     * Legacy (vendor-chrome) counterpart of {@link controlsBridge}: without
     * shared controls there is no adapter to feed, but the `showCaptions`
     * preference still has to reach the active source engine.
     */
    private captionTracks: WebVideoSourceTracks | null = null;
    private videoSession: HtmlVideoElementSession | null = null;
    private legacyShortcuts: LegacyPlayerShortcuts | null = null;

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
        } else {
            this.captionTracks = new WebVideoSourceTracks({
                video: this.videoPlayer.nativeElement,
                showCaptions: () => this.showCaptions(),
                vendorCaptionControls: true,
            });
            this.legacyShortcuts = attachHtmlVideoLegacyShortcuts({
                video: () => this.videoPlayer.nativeElement,
                hostElement: () => this.playerRoot()?.nativeElement ?? null,
                isAvailable: () => this.interactionEnabled(),
                isLive: () => this.isLive(),
                play: () => this.handlePlayOperation(),
            });
        }
        if (this.controlsSource) {
            this.bindControlsSource(this.controlsSource);
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
            this.captionTracks?.refreshInputs();
        }
        if (changes['interactionEnabled']?.currentValue === false) {
            exitOwnedFullscreen(
                this.sharedControls,
                this.fullscreenTarget() ?? this.playerRoot()?.nativeElement,
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
            const sourceKind = resolvePlaybackUrlSourceKind(channel.url);

            // The scoped Electron header override is owned by
            // WebPlayerViewComponent, which configures the full header set
            // (incl. portal Cookie/Authorization) before this component
            // receives the channel. Re-issuing the three-header call here
            // would overwrite that richer override.

            if (sourceKind === PlaybackSourceKind.Dash) {
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
                sourceKind === PlaybackSourceKind.MpegTs &&
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
                sourceKind !== PlaybackSourceKind.Native &&
                Hls &&
                Hls.isSupported()
            ) {
                // HLS manifests, plus raw MPEG-TS when mpegts.js is
                // unavailable (the historical engine order). Native
                // containers never reach hls.js: fed an .mkv it raised a
                // manifest error over media the browser plays by itself.
                debugHtmlPlayer('Starting HLS playback');
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
                    resolveNativeSourceMimeType(channel.url)
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
        this.captionTracks?.setSource(source);
    }

    private clearControlsSource(): void {
        this.controlsBridge?.clearSource();
        this.captionTracks?.clearSource();
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
        this.legacyShortcuts?.detach();
        this.legacyShortcuts = null;
        this.controlsBridge?.destroy();
        this.controlsBridge = null;
        this.captionTracks?.destroy();
        this.captionTracks = null;
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
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
            emitTimeUpdate: (value) => this.timeUpdate.emit(value),
            emitPlaybackEnded: () => this.playbackEnded.emit(),
        });
        return this.videoSession;
    }
}
