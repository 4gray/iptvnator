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
                    this.logAudioTracks();
                    this.setupAudioTrackMenu();
                });

                // Audio tracks may be added after loadedmetadata (e.g. HLS alternate audio)
                const audioTracks = this.player.audioTracks();
                if (audioTracks) {
                    audioTracks.addEventListener('addtrack', () => {
                        console.log(
                            '[AudioTrack] addtrack event fired, total tracks:',
                            this.player.audioTracks().length
                        );
                        this.logAudioTracks();
                        this.setupAudioTrackMenu();
                    });
                    audioTracks.addEventListener('removetrack', () => {
                        console.log(
                            '[AudioTrack] removetrack event fired, total tracks:',
                            this.player.audioTracks().length
                        );
                        this.logAudioTracks();
                        this.setupAudioTrackMenu();
                    });
                    audioTracks.addEventListener('change', () => {
                        this.logAudioTracks();
                    });
                }

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

    /**
     * Logs all available audio tracks for debugging.
     */
    private logAudioTracks(): void {
        const audioTracks = this.player.audioTracks();
        console.log('[AudioTrack] Audio tracks count:', audioTracks?.length ?? 0);
        for (let i = 0; i < (audioTracks?.length ?? 0); i++) {
            const t = audioTracks[i];
            console.log(
                `[AudioTrack] Track ${i}: label="${t.label}", language="${t.language}", enabled=${t.enabled}, kind="${t.kind}"`
            );
        }

        // Also check the underlying tech for HLS audio tracks
        const tech =
            typeof this.player?.tech === 'function'
                ? this.player.tech({ IWillNotUseThisInPlugins: true })
                : null;
        const audioMediaGroups =
            tech?.vhs?.playlists?.main?.mediaGroups?.AUDIO ??
            tech?.vhs?.playlists?.master?.mediaGroups?.AUDIO;

        if (audioMediaGroups) {
            console.log(
                '[AudioTrack] HLS AUDIO media groups:',
                JSON.stringify(Object.keys(audioMediaGroups))
            );
        } else {
            console.log(
                '[AudioTrack] HLS AUDIO media groups: none found in playlist metadata'
            );
        }
    }

    /**
     * Sets up the audio track selection menu in the control bar.
     * Uses the Video.js audioTracks() API which works with both
     * native multi-audio streams and HLS.js alternate audio tracks.
     */
    private setupAudioTrackMenu(): void {
        const audioTracks = this.player.audioTracks();
        console.log(
            '[AudioTrack] setupAudioTrackMenu called, tracks:',
            audioTracks?.length ?? 0
        );
        if (!audioTracks || audioTracks.length <= 1) {
            console.log(
                '[AudioTrack] Skipping menu: need >1 tracks, have',
                audioTracks?.length ?? 0
            );
            console.log(
                '[AudioTrack] If VLC/MPV show more tracks, the HLS manifest likely does not expose alternate audio via EXT-X-MEDIA'
            );
            return;
        }

        const controlBar = this.player.getChild('controlBar');
        if (!controlBar) {
            return;
        }

        let audioButton =
            controlBar.getChild('audioTrackButton') ??
            controlBar.getChild('AudioTrackButton');
        if (!audioButton) {
            audioButton = controlBar.addChild('audioTrackButton', {});
        }

        if (audioButton) {
            audioButton.show?.();
            audioButton.update?.();
        }
    }
}
