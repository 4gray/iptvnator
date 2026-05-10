import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import Hls, { type ErrorData, type ManifestParsedData } from 'hls.js';
import mpegts from 'mpegts.js';
import { getExtensionFromUrl } from 'm3u-utils';
import { DataService } from 'services';
import { Channel } from 'shared-interfaces';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    classifyUnsupportedHlsManifestCodecs,
    createPlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.util';

/**
 * This component contains the implementation of HTML5 based video player
 */
@Component({
    selector: 'app-html-video-player',
    templateUrl: './html-video-player.component.html',
    styleUrls: ['./html-video-player.component.scss'],
    standalone: true,
})
export class HtmlVideoPlayerComponent implements OnInit, OnChanges, OnDestroy {
    /** Channel to play  */
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() startTime = 0;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    @Output() playbackIssue = new EventEmitter<PlaybackDiagnostic | null>();

    private readonly dataService = inject(DataService);

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: true })
    videoPlayer!: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls!: Hls;
    /** mpegts.js player for raw MPEG-TS streams */
    private mpegtsPlayer: mpegts.Player | null = null;

    /** Captions/subtitles indicator */
    @Input() showCaptions!: boolean;

    private readonly handleNativePlaybackError = () => {
        const metadata = this.createSourceMetadata(
            this.channel?.url ?? this.videoPlayer.nativeElement.currentSrc
        );

        this.playbackIssue.emit(
            classifyNativePlaybackIssue(
                this.videoPlayer.nativeElement.error,
                metadata
            )
        );
    };

    private readonly clearPlaybackIssue = () => {
        this.playbackIssue.emit(null);
    };

    ngOnInit() {
        this.videoPlayer.nativeElement.addEventListener('volumechange', () => {
            this.onVolumeChange();
        });

        this.videoPlayer.nativeElement.addEventListener('loadedmetadata', () => {
            if (this.startTime > 0) {
                this.videoPlayer.nativeElement.currentTime = this.startTime;
            }
        });

        this.videoPlayer.nativeElement.addEventListener('timeupdate', () => {
            this.timeUpdate.emit({
                currentTime: this.videoPlayer.nativeElement.currentTime,
                duration: this.videoPlayer.nativeElement.duration,
            });
        });

        this.videoPlayer.nativeElement.addEventListener(
            'error',
            this.handleNativePlaybackError
        );
        this.videoPlayer.nativeElement.addEventListener(
            'loadeddata',
            this.clearPlaybackIssue
        );
        this.videoPlayer.nativeElement.addEventListener(
            'playing',
            this.clearPlaybackIssue
        );
    }

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && changes['channel'].currentValue) {
            this.playChannel(changes['channel'].currentValue);
        }
        if (changes['volume']?.currentValue !== undefined) {
            console.log(
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
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.pause();
            this.mpegtsPlayer.unload();
            this.mpegtsPlayer.detachMediaElement();
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }
        if (this.hls) this.hls.destroy();
        if (channel.url) {
            this.playbackIssue.emit(null);
            const url = channel.url + (channel.epgParams ?? '');
            const extension = getExtensionFromUrl(channel.url);

            // Set user agent if specified on channel
            if (channel.http?.['user-agent']) {
                window.electron?.setUserAgent(
                    channel.http['user-agent'],
                    channel.http.referrer
                );
            }

            if (extension === 'ts' && mpegts.isSupported()) {
                console.log('Using mpegts.js for TS stream:', channel.name, url);
                this.mpegtsPlayer = mpegts.createPlayer({
                    type: 'mpegts',
                    isLive: true,
                    url: url,
                });
                this.mpegtsPlayer.attachMediaElement(
                    this.videoPlayer.nativeElement
                );
                this.mpegtsPlayer.on(
                    mpegts.Events.ERROR,
                    (
                        type: string,
                        details: string,
                        info: unknown
                    ): void => {
                        this.playbackIssue.emit(
                            classifyMpegTsPlaybackIssue(
                                {
                                    type,
                                    details,
                                    info,
                                },
                                this.createSourceMetadata(url, 'video/mp2t')
                            )
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
                console.log('... switching channel to ', channel.name, url);
                this.hls = new Hls();
                this.hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                    this.handleHlsManifestParsed(url, data);
                });
                this.hls.on(Hls.Events.ERROR, (_, data) => {
                    this.handleHlsError(url, data);
                });
                this.hls.attachMedia(this.videoPlayer.nativeElement);
                this.hls.loadSource(url);
                this.handlePlayOperation();
            } else {
                console.log('Using native video player...');
                this.addSourceToVideo(
                    this.videoPlayer.nativeElement,
                    url,
                    'video/mp4'
                );
                this.videoPlayer.nativeElement.play();
            }
        }
    }

    addSourceToVideo(element: HTMLVideoElement, url: string, type: string) {
        const source = document.createElement('source');
        source.src = url;
        source.type = type;
        element.appendChild(source);
    }

    /**
     * Disables text based captions based on the global settings
     */
    disableCaptions(): void {
        for (
            let i = 0;
            i < this.videoPlayer.nativeElement.textTracks.length;
            i++
        ) {
            this.videoPlayer.nativeElement.textTracks[i].mode = 'hidden';
        }
    }

    /**
     * Handles promise based play operation
     */
    handlePlayOperation(): void {
        const playPromise = this.videoPlayer.nativeElement.play();

        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Automatic playback started!
                    if (!this.showCaptions) {
                        this.disableCaptions();
                    }
                })
                .catch(() => {
                    // Do nothing
                });
        }
    }

    private handleHlsManifestParsed(
        url: string,
        data: ManifestParsedData
    ): void {
        const metadata = this.createSourceMetadata(
            url,
            'application/x-mpegURL',
            data.levels
                .map((level) => level.audioCodec)
                .filter((codec): codec is string => Boolean(codec)),
            data.levels
                .map((level) => level.videoCodec)
                .filter((codec): codec is string => Boolean(codec))
        );
        const issue = classifyUnsupportedHlsManifestCodecs(metadata);
        if (issue) {
            this.playbackIssue.emit(issue);
        }
    }

    private handleHlsError(url: string, data: ErrorData): void {
        if (!data.fatal) {
            return;
        }

        this.playbackIssue.emit(
            classifyHlsPlaybackIssue(
                {
                    type: data.type,
                    details: data.details,
                    fatal: data.fatal,
                    message: data.error?.message,
                },
                this.createSourceMetadata(url, 'application/x-mpegURL')
            )
        );
    }

    private createSourceMetadata(
        url: string,
        mimeType?: string,
        audioCodecs: readonly string[] = [],
        videoCodecs: readonly string[] = []
    ) {
        return createPlaybackSourceMetadata({
            url,
            mimeType,
            player: InlinePlaybackPlayer.Html5,
            audioCodecs,
            videoCodecs,
        });
    }

    /**
     * Save volume when user changes it
     */
    onVolumeChange(): void {
        const currentVolume = this.videoPlayer.nativeElement.volume;
        console.log('Volume changed to:', currentVolume);
        localStorage.setItem('volume', currentVolume.toString());
    }

    /**
     * Destroy hls instance on component destroy and clean up event listener
     */
    ngOnDestroy(): void {
        this.videoPlayer.nativeElement.removeEventListener(
            'volumechange',
            this.onVolumeChange
        );
        this.videoPlayer.nativeElement.removeEventListener(
            'error',
            this.handleNativePlaybackError
        );
        this.videoPlayer.nativeElement.removeEventListener(
            'loadeddata',
            this.clearPlaybackIssue
        );
        this.videoPlayer.nativeElement.removeEventListener(
            'playing',
            this.clearPlaybackIssue
        );
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.pause();
            this.mpegtsPlayer.unload();
            this.mpegtsPlayer.detachMediaElement();
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }
        if (this.hls) {
            this.hls.destroy();
        }
    }
}
