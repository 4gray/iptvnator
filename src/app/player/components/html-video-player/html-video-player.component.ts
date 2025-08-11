import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
    inject,
} from '@angular/core';
import Hls from 'hls.js';
import { Channel } from '../../../../../shared/channel.interface';
import { CHANNEL_SET_USER_AGENT } from '../../../../../shared/ipc-commands';
import { getExtensionFromUrl } from '../../../../../shared/playlist.utils';
import { DataService } from '../../../services/data.service';
import { VideoPreBufferService } from '../../../services/video-prebuffer.service';

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
    @Input() channel: Channel;
    dataService: DataService; // Declare the dataService property
    private readonly preBufferService = inject(VideoPreBufferService);
    @Input() volume = 1;

    constructor(dataService: DataService) {
        this.dataService = dataService; // Inject the DataService
    }

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: true })
    videoPlayer: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls: Hls;

    /** Captions/subtitles indicator */
    @Input() showCaptions!: boolean;

    ngOnInit() {
        this.videoPlayer.nativeElement.addEventListener('volumechange', () => {
            this.onVolumeChange();
        });
    }

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel && changes.channel.currentValue) {
            this.playChannel(changes.channel.currentValue);
        }
        if (changes.volume?.currentValue !== undefined) {
            console.log(
                'Setting HTML5 player volume to:',
                changes.volume.currentValue
            );
            this.videoPlayer.nativeElement.volume = changes.volume.currentValue;
        }
    }

    /**
     * Starts to play the given channel
     * @param channel given channel object
     */
    playChannel(channel: Channel): void {
        if (this.hls) this.hls.destroy();
        if (channel.url) {
            const url = channel.url + (channel.epgParams ?? '');
            const extension = getExtensionFromUrl(channel.url);

            // Check if we have pre-buffered data for this URL
            const preBufferedVideo = this.preBufferService.getPreBufferedVideo(url);
            if (preBufferedVideo?.isReady) {
                console.log('Using pre-buffered video data for:', channel.name);
                this.usePreBufferedVideo(preBufferedVideo);
                return;
            }

            // Send IPC event and handle the response
            this.dataService
                .sendIpcEvent(CHANNEL_SET_USER_AGENT, {
                    userAgent: channel.http?.['user-agent'] ?? '',
                    referer: channel.http?.referrer ?? '',
                    origin: channel.http?.origin ?? '',
                })
                .then(() => {
                    if (
                        extension !== 'mp4' &&
                        extension !== 'mpv' &&
                        Hls &&
                        Hls.isSupported()
                    ) {
                        console.log(
                            '... switching channel to ',
                            channel.name,
                            url
                        );
                        this.hls = new Hls();
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
                        this.handlePlayOperation();
                    }
                })
                .catch((error) => {
                    console.error('Error setting user agent:', error);
                    // Continue playback even if setting user agent fails
                    if (
                        extension !== 'mp4' &&
                        extension !== 'mpv' &&
                        Hls &&
                        Hls.isSupported()
                    ) {
                        this.hls = new Hls();
                        this.hls.attachMedia(this.videoPlayer.nativeElement);
                        this.hls.loadSource(url);
                        this.handlePlayOperation();
                    } else {
                        this.addSourceToVideo(
                            this.videoPlayer.nativeElement,
                            url,
                            'video/mp4'
                        );
                        this.handlePlayOperation();
                    }
                });
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
        // Add a small delay to ensure the video element is ready
        setTimeout(() => {
            const playPromise = this.videoPlayer.nativeElement.play();

            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        // Automatic playback started!
                        console.log('HTML5 video autoplay started successfully');
                        if (!this.showCaptions) {
                            this.disableCaptions();
                        }
                    })
                    .catch((error) => {
                        console.warn('HTML5 video autoplay failed:', error);
                        // Try to play again after a short delay
                        setTimeout(() => {
                            this.videoPlayer.nativeElement.play().catch((retryError) => {
                                console.warn('HTML5 video retry play failed:', retryError);
                            });
                        }, 500);
                    });
            }
        }, 100);
    }

    /**
     * Use pre-buffered video data for instant playback
     */
    private usePreBufferedVideo(preBufferedVideo: any): void {
        if (preBufferedVideo.hls) {
            // Use pre-buffered HLS data
            this.hls = preBufferedVideo.hls;
            this.hls.attachMedia(this.videoPlayer.nativeElement);
            this.handlePlayOperation();
        } else if (preBufferedVideo.videoElement) {
            // Use pre-buffered regular video data
            const preBufferedSrc = preBufferedVideo.videoElement.src;
            this.addSourceToVideo(this.videoPlayer.nativeElement, preBufferedSrc, 'video/mp4');
            this.handlePlayOperation();
        }
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
        if (this.hls) {
            this.hls.destroy();
        }
    }
}
