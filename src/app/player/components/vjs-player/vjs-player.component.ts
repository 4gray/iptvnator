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
import '@yangkghjh/videojs-aspect-ratio-panel';

@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class VjsPlayerComponent implements OnInit, OnDestroy {
    /** DOM-element reference */
    @ViewChild('target', { static: true }) target: ElementRef;
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
