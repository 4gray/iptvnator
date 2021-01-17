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
        if (Hls.isSupported()) {
            console.log('... switching channel to ', channel.name, channel.url);
            this.hls.loadSource(channel.url);
            this.hls.attachMedia(this.videoPlayer.nativeElement);
        } else if (
            this.videoPlayer.nativeElement.canPlayType(
                'application/vnd.apple.mpegurl'
            )
        ) {
            this.videoPlayer.nativeElement.src = channel.url;
            this.videoPlayer.nativeElement.addEventListener(
                'loadedmetadata',
                () => {
                    this.videoPlayer.nativeElement.play();
                }
            );
        }
    }

    /**
     * Destroy hls instance on component destroy
     */
    ngOnDestroy(): void {
        this.hls.destroy();
    }
}
