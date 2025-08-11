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
    @Input() volume = 1;

    /**
     * Instantiate Video.js on component init
     */
    ngOnInit(): void {
        try {
            this.player = videoJs(
                this.target.nativeElement,
                {
                    ...this.options,
                    autoplay: true,
                    muted: false, // Ensure muted is false for better autoplay compatibility
                },
                () => {
                    console.log(
                        'Setting VideoJS player initial volume to:',
                        this.volume
                    );
                    this.player.volume(this.volume);

                    this.player.on('volumechange', () => {
                        const currentVolume = this.player.volume();
                        localStorage.setItem('volume', currentVolume.toString());
                    });

                    // Force play after initialization
                    this.player.ready(() => {
                        setTimeout(() => {
                            const playPromise = this.player.play();
                            if (playPromise && typeof playPromise.then === 'function') {
                                playPromise
                                    .then(() => {
                                        console.log('VideoJS autoplay started successfully');
                                    })
                                    .catch((error) => {
                                        console.warn('VideoJS autoplay failed:', error);
                                        // Retry play after a short delay
                                        setTimeout(() => {
                                            this.player.play().catch((retryError) => {
                                                console.warn('VideoJS retry play failed:', retryError);
                                            });
                                        }, 500);
                                    });
                            }
                        }, 100);
                    });

                    // Initialize aspect ratio panel only after player is ready
                    try {
                        if (this.player && typeof this.player['aspectRatioPanel'] === 'function') {
                            this.player['aspectRatioPanel']();
                        }
                    } catch (aspectRatioError) {
                        console.warn('Aspect ratio panel initialization failed:', aspectRatioError);
                    }

                    // Initialize HLS quality selector
                    try {
                        if (this.player && typeof this.player.hlsQualitySelector === 'function') {
                            this.player.hlsQualitySelector({
                                displayCurrentQuality: true,
                            });
                        }
                    } catch (qualitySelectorError) {
                        console.warn('HLS quality selector initialization failed:', qualitySelectorError);
                    }
                }
            );
        } catch (error) {
            console.error('VideoJS player initialization failed:', error);
        }
    }

    /**
     * Replaces the url source of the player with the changed source url
     * @param changes contains changed channel object
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (!this.player) {
            console.warn('VideoJS player not initialized yet');
            return;
        }

        try {
            if (changes.options?.previousValue && changes.options?.currentValue?.sources?.[0]) {
                this.player.src(changes.options.currentValue.sources[0]);
            }
            
            if (changes.volume?.currentValue !== undefined) {
                console.log(
                    'Setting VideoJS player volume to:',
                    changes.volume.currentValue
                );
                this.player.volume(changes.volume.currentValue);
            }
        } catch (error) {
            console.error('Error updating VideoJS player:', error);
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
