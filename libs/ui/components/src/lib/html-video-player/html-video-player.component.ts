import {
    Component,
    ElementRef,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { getExtensionFromUrl } from 'm3u-utils';
import { DataService } from 'services';
import { Channel } from 'shared-interfaces';

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

    private readonly dataService = inject(DataService);

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: true })
    videoPlayer!: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls!: Hls;

    /** MPEG-TS player object for raw .ts streams */
    mpegtsPlayer: mpegts.Player | null = null;

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
        // Clean up existing players
        if (this.hls) this.hls.destroy();
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }

        if (channel.url) {
            const url = channel.url + (channel.epgParams ?? '');
            const extension = getExtensionFromUrl(channel.url);

            // Set user agent if specified on channel
            if (channel.http?.['user-agent']) {
                window.electron?.setUserAgent(
                    channel.http['user-agent'],
                    channel.http.referrer
                );
            }

            // Use mpegts.js for raw .ts MPEG-TS streams
            if (extension === 'ts' && mpegts.isSupported()) {
                console.log(
                    '... switching channel (mpegts.js) to ',
                    channel.name,
                    url
                );
                this.mpegtsPlayer = mpegts.createPlayer({
                    type: 'mpegts',
                    isLive: true,
                    url: url,
                });
                this.mpegtsPlayer.attachMediaElement(
                    this.videoPlayer.nativeElement
                );
                this.mpegtsPlayer.load();
                this.handlePlayOperation();
            } else if (
                extension !== 'mp4' &&
                extension !== 'mpv' &&
                Hls &&
                Hls.isSupported()
            ) {
                // Use HLS.js for .m3u8 and other HLS streams
                console.log('... switching channel (hls.js) to ', channel.name, url);
                this.hls = new Hls();
                this.hls.attachMedia(this.videoPlayer.nativeElement);
                this.hls.loadSource(url);
                this.handlePlayOperation();
            } else {
                // Use native video player for mp4 and other formats
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

    /**
     * Save volume when user changes it
     */
    onVolumeChange(): void {
        const currentVolume = this.videoPlayer.nativeElement.volume;
        console.log('Volume changed to:', currentVolume);
        localStorage.setItem('volume', currentVolume.toString());
    }

    /**
     * Destroy player instances on component destroy and clean up event listener
     */
    ngOnDestroy(): void {
        this.videoPlayer.nativeElement.removeEventListener(
            'volumechange',
            this.onVolumeChange
        );
        if (this.hls) {
            this.hls.destroy();
        }
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }
    }
}
