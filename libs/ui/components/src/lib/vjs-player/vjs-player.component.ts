import {
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
    ViewChild,
    ViewEncapsulation,
} from '@angular/core';
import '@yangkghjh/videojs-aspect-ratio-panel';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-quality-selector-hls';

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
    @ViewChild('target', { static: true }) target!: ElementRef<Element>;
    /** Options of VideoJs player */
    @Input() options!: any;
    /** VideoJs object */
    player!: any;
    @Input() volume = 1;
    @Input() startTime = 0;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();

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
            () => {
                console.log(
                    'Setting VideoJS player initial volume to:',
                    this.volume
                );
                this.player.volume(this.volume);

                this.player.on('loadedmetadata', () => {
                    if (this.startTime > 0) {
                        this.player.currentTime(this.startTime);
                    }
                });

                this.player.on('volumechange', () => {
                    const currentVolume = this.player.volume();
                    localStorage.setItem('volume', currentVolume.toString());
                });

                this.player.on('timeupdate', () => {
                    this.timeUpdate.emit({
                        currentTime: this.player.currentTime(),
                        duration: this.player.duration(),
                    });
                });
            }
        );
        try {
            if (typeof this.player.qualitySelectorHls === 'function') {
                this.player.qualitySelectorHls({
                    displayCurrentQuality: true,
                });
            }
        } catch (e) {
            console.warn('qualitySelectorHls plugin failed to initialize:', e);
        }
        try {
            if (typeof this.player['aspectRatioPanel'] === 'function') {
                this.player['aspectRatioPanel']();
            }
        } catch (e) {
            console.warn('aspectRatioPanel plugin failed to initialize:', e);
        }
    }

    /**
     * Replaces the url source of the player with the changed source url
     * @param changes contains changed channel object
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['options'].previousValue) {
            this.player.src(changes['options'].currentValue.sources[0]);
        }
        if (changes['volume']?.currentValue !== undefined && this.player) {
            console.log(
                'Setting VideoJS player volume to:',
                changes['volume'].currentValue
            );
            this.player.volume(changes['volume'].currentValue);
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
