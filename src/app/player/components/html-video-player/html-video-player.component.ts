import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import Hls from 'hls.js';
import { Channel } from '../../../../../shared/channel.interface';
import { CHANNEL_SET_USER_AGENT } from '../../../../../shared/ipc-commands';
import { getExtensionFromUrl } from '../../../../../shared/playlist.utils';
import { DataService } from '../../../services/data.service';

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
                        this.videoPlayer.nativeElement.play();
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
                        this.videoPlayer.nativeElement.play();
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
        const playPromise = this.videoPlayer.nativeElement.play();

        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Automatic playback started!
                    if (!this.showCaptions) {
                        this.disableCaptions();
                    }
                })
                .catch(() => {});
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
