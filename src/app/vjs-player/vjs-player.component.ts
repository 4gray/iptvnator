// vjs-player.component.ts
import {
    Component,
    ElementRef,
    Input,
    OnDestroy,
    OnInit,
    ViewChild,
    ViewEncapsulation,
    SimpleChanges,
} from '@angular/core';
import videoJs from 'video.js';

@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class VjsPlayerComponent implements OnInit, OnDestroy {
    /** DOM-element reference */
    @ViewChild('target', { static: true }) target: ElementRef;
    /** Options of VideoJs player (see: https://github.com/videojs/video.js/blob/mastertutorial-options.html) */
    @Input() options: videoJs.ComponentOptions;
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
                /* responsive: true,
                limitRenditionByPlayerDimensions: false, */
                fluid: true,
                autoplay: true,
            },
            function onPlayerReady() {
                this.volume(100);
            }
        );
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
