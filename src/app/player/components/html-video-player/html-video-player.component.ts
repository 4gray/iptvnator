import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import Hls from 'hls.js';
import { Channel } from '../../../../../shared/channel.interface';
import { getExtensionFromUrl } from '../../../../../shared/playlist.utils';

/**
 * This component contains the implementation of HTML5 based video player
 */
@Component({
    selector: 'app-html-video-player',
    templateUrl: './html-video-player.component.html',
    styleUrls: ['./html-video-player.component.scss'],
    standalone: true,
})
export class HtmlVideoPlayerComponent implements OnChanges, OnDestroy {
    /** Channel to play  */
    @Input() channel: Channel;

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: true })
    videoPlayer: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls: Hls;

    /** Captions/subtitles indicator */
    @Input() showCaptions!: boolean;

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel && changes.channel.currentValue) {
            this.playChannel(changes.channel.currentValue);
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
            if (
                extension !== 'mp4' &&
                extension !== 'mpv' &&
                Hls &&
                Hls.isSupported()
            ) {
                console.log('... switching channel to ', channel.name, url);
                this.hls = new Hls();
                this.hls.attachMedia(this.videoPlayer.nativeElement);
                this.hls.loadSource(url);
                this.handlePlayOperation();
            } else {
                console.error('something wrong with hls.js init...');
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
                .catch(() => {});
        }
    }

    /**
     * Destroy hls instance on component destroy
     */
    ngOnDestroy(): void {
        if (this.hls) {
            this.hls.destroy();
        }
    }
}
