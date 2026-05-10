import {
    Component,
    ElementRef,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewEncapsulation,
    input,
    output,
    viewChild,
} from '@angular/core';
import '@yangkghjh/videojs-aspect-ratio-panel';
import { getExtensionFromUrl } from 'm3u-utils';
import mpegts from 'mpegts.js';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-quality-selector-hls';

/**
 * This component contains the implementation of video player that is based on video.js library
 */

type VideoPlayerSource = {
    src: string;
    type?: string;
};

type VideoPlayerOptions = Record<string, unknown> & {
    autoplay?: boolean;
    sources?: VideoPlayerSource[];
};

type VideoJsAudioTrack = {
    label?: string;
    language?: string;
    enabled?: boolean;
    kind?: string;
};

type VideoJsAudioTrackList = {
    length: number;
    [index: number]: VideoJsAudioTrack;
    addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject
    ) => void;
};

type VideoJsTech = {
    el?: () => Element | null;
    vhs?: {
        playlists?: {
            main?: { mediaGroups?: { AUDIO?: Record<string, unknown> } };
            master?: { mediaGroups?: { AUDIO?: Record<string, unknown> } };
        };
    };
};

type VideoJsControlChild = {
    getChild?: (name: string) => VideoJsControlChild | null;
    addChild?: (
        name: string,
        options?: Record<string, unknown>
    ) => VideoJsControlChild | null;
    show?: () => void;
    update?: () => void;
};

type VideoJsPlayer = Omit<
    ReturnType<typeof videoJs>,
    'audioTracks' | 'tech' | 'getChild'
> & {
    qualitySelectorHls?: (options?: { displayCurrentQuality?: boolean }) => void;
    aspectRatioPanel?: () => void;
    audioTracks: () => VideoJsAudioTrackList | null;
    tech: (options?: unknown) => VideoJsTech | null;
    getChild: (name: string) => VideoJsControlChild | null;
};

@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
    standalone: true,
})
export class VjsPlayerComponent implements OnInit, OnChanges, OnDestroy {
    /** DOM-element reference */
    readonly target = viewChild.required<ElementRef<Element>>('target');
    /** Options of VideoJs player */
    readonly options = input.required<VideoPlayerOptions>();
    /** VideoJs object */
    player!: VideoJsPlayer;
    /** mpegts.js player for raw MPEG-TS streams */
    private mpegtsPlayer: mpegts.Player | null = null;
    readonly volume = input(1);
    readonly startTime = input(0);
    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();

    /**
     * Instantiate Video.js on component init
     */
    ngOnInit(): void {
        const source = this.options().sources?.[0];
        const isMpegTs = this.isMpegTsSource(source?.src);

        // For raw MPEG-TS streams, init Video.js without a source (UI/controls only)
        const vjsOptions = isMpegTs
            ? { ...this.options(), sources: [], autoplay: false }
            : { ...this.options(), autoplay: true };

        this.player = videoJs(
            this.target().nativeElement,
            vjsOptions,
            () => {
                console.log(
                    'Setting VideoJS player initial volume to:',
                    this.volume()
                );
                this.player.volume(this.volume());

                this.player.on('loadedmetadata', () => {
                    if (this.startTime() > 0) {
                        this.player.currentTime(this.startTime());
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

                // Attach mpegts.js after Video.js is ready
                if (isMpegTs) {
                    this.initMpegTs(source.src);
                }
            }
        ) as unknown as VideoJsPlayer;
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
            if (typeof this.player.aspectRatioPanel === 'function') {
                this.player.aspectRatioPanel();
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
        if (changes['options']?.previousValue) {
            const previousSource =
                changes['options'].previousValue.sources?.[0];
            const newSource = changes['options'].currentValue.sources?.[0];
            if (this.hasSourceChanged(previousSource, newSource)) {
                this.destroyMpegTs();
                if (!newSource) {
                    this.player.reset();
                } else if (this.isMpegTsSource(newSource.src)) {
                    this.player.reset();
                    this.initMpegTs(newSource.src);
                } else {
                    this.player.src(newSource);
                }
            }
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
        this.destroyMpegTs();
        if (this.player) {
            this.player.dispose();
        }
    }

    private isMpegTsSource(url?: string): boolean {
        if (!url) return false;
        return getExtensionFromUrl(url) === 'ts' && mpegts.isSupported();
    }

    private hasSourceChanged(
        previousSource: VideoPlayerSource | undefined,
        newSource: VideoPlayerSource | undefined
    ): boolean {
        return (
            previousSource?.src !== newSource?.src ||
            previousSource?.type !== newSource?.type
        );
    }

    private initMpegTs(url: string): void {
        const videoEl = this.player.tech({ IWillNotUseThisInPlugins: true })?.el();
        if (!videoEl) return;

        console.log('Using mpegts.js for TS stream:', url);
        this.mpegtsPlayer = mpegts.createPlayer({
            type: 'mpegts',
            isLive: true,
            url: url,
        });
        this.mpegtsPlayer.attachMediaElement(videoEl as HTMLVideoElement);
        this.mpegtsPlayer.load();
        this.mpegtsPlayer.play();
    }

    private destroyMpegTs(): void {
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.pause();
            this.mpegtsPlayer.unload();
            this.mpegtsPlayer.detachMediaElement();
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
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
