import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
    ViewEncapsulation,
} from '@angular/core';
import '@yangkghjh/videojs-aspect-ratio-panel';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-hls-quality-selector';

/**
 * This component contains the implementation of video player that is based on video.js library
 */
@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
    standalone: true,
})
export class VjsPlayerComponent implements OnInit, OnChanges, OnDestroy {
    /** DOM-element reference */
    @ViewChild('target', { static: true }) target: ElementRef<Element>;
    /** Options of VideoJs player */
    @Input() options: videoJs.PlayerOptions;
    /** VideoJs object */
    player: videoJs.Player;

    /**
     * Instantiate Video.js on component init
     */
    ngOnInit(): void {
        this.player = videoJs(
            this.target.nativeElement,
            {
                ...this.options,
                autoplay: true,
            },
            function onPlayerReady() {
                this.volume(100);
            }
        );
        this.player.hlsQualitySelector({
            displayCurrentQuality: true,
        });
        this.player['aspectRatioPanel']();
    }

    /**
     * Replaces the url source of the player with the changed source url
     * @param changes contains changed channel object
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.options.previousValue) {
            this.player.src(changes.options.currentValue.sources[0]);
        }
    }

    /**
     * Removes the players HTML reference on destroy
     */
    ngOnDestroy(): void {
        if (this.player) {
            this.player.dispose();
        }
    }
}
