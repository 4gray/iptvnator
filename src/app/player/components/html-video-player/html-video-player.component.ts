import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import { Channel } from '../../../state';
import * as Hls from 'hls.js';

@Component({
    selector: 'app-html-video-player',
    templateUrl: './html-video-player.component.html',
    styleUrls: ['./html-video-player.component.scss'],
})
export class HtmlVideoPlayerComponent implements OnChanges, OnDestroy {
    /** Channel to play  */
    @Input() channel: Channel;

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: false })
    videoPlayer: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls = new Hls();

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
        const url = channel.url + channel.epgParams;
        if (Hls.isSupported()) {
            console.log('... switching channel to ', channel.name, url);
            this.hls.loadSource(url);
            this.hls.attachMedia(this.videoPlayer.nativeElement);
            this.handlePlayOperation();
        } else if (
            this.videoPlayer.nativeElement.canPlayType(
                'application/vnd.apple.mpegurl'
            )
        ) {
            this.videoPlayer.nativeElement.src = url;
            this.videoPlayer.nativeElement.addEventListener(
                'loadedmetadata',
                () => {
                    this.handlePlayOperation();
                }
            );
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
                })
                .catch((error) => console.error(error));
        }
    }

    /**
     * Destroy hls instance on component destroy
     */
    ngOnDestroy(): void {
        this.hls.destroy();
    }
}
