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
import mpegts from 'mpegts.js';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-quality-selector-hls';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
    getPlaybackMediaExtensionFromUrl,
} from '../playback-diagnostics/playback-diagnostics.util';

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
    qualitySelectorHls?: (options?: {
        displayCurrentQuality?: boolean;
    }) => void;
    aspectRatioPanel?: () => void;
    audioTracks: () => VideoJsAudioTrackList | null;
    tech: (options?: unknown) => VideoJsTech | null;
    getChild: (name: string) => VideoJsControlChild | null;
    error: () => { code?: number; message?: string } | null;
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
    readonly playbackIssue = output<PlaybackDiagnostic | null>();

    private readonly clearPlaybackIssue = () => {
        this.playbackIssue.emit(null);
    };

    /**
     * Instantiate Video.js on component init
     */
    ngOnInit(): void {
        const source = this.options().sources?.[0];
        const isMpegTs = this.isMpegTsSource(source?.src);
        const targetVideo = this.target().nativeElement as HTMLVideoElement;
        targetVideo.addEventListener('loadeddata', this.clearPlaybackIssue);
        targetVideo.addEventListener('playing', this.clearPlaybackIssue);

        // For raw MPEG-TS streams, init Video.js without a source (UI/controls only)
        const vjsOptions = isMpegTs
            ? { ...this.options(), sources: [], autoplay: false }
            : { ...this.options(), autoplay: true };

        this.player = videoJs(this.target().nativeElement, vjsOptions, () => {
            console.log(
                'Setting VideoJS player initial volume to:',
                this.volume()
            );
            this.player.volume(this.volume());

            this.player.on('loadedmetadata', () => {
                if (this.startTime() > 0) {
                    this.player.currentTime(this.startTime());
                }
                this.playbackIssue.emit(null);
                this.logAudioTracks();
                this.setupAudioTrackMenu();
            });

            this.player.on('error', () => {
                this.handleVideoJsPlaybackError();
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
        }) as unknown as VideoJsPlayer;
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
                this.playbackIssue.emit(null);
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
        this.removeNativePlaybackListeners();
        if (this.player) {
            this.player.dispose();
        }
    }

    private isMpegTsSource(url?: string): boolean {
        if (!url) return false;
        const extension = getPlaybackMediaExtensionFromUrl(url);
        return (extension === 'ts' || !extension) && mpegts.isSupported();
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

    private removeNativePlaybackListeners(): void {
        try {
            const targetVideo = this.target().nativeElement as HTMLVideoElement;
            targetVideo.removeEventListener(
                'loadeddata',
                this.clearPlaybackIssue
            );
            targetVideo.removeEventListener('playing', this.clearPlaybackIssue);
        } catch {
            // Required viewChild can be unavailable when a shallow unit test destroys an unrendered component.
        }
    }

    private initMpegTs(url: string): void {
        const videoEl = this.player
            .tech({ IWillNotUseThisInPlugins: true })
            ?.el();
        if (!videoEl) return;

        console.log('Using mpegts.js for TS stream:', url);
        this.mpegtsPlayer = mpegts.createPlayer({
            type: 'mpegts',
            isLive: true,
            url: url,
        });
        this.mpegtsPlayer.attachMediaElement(videoEl as HTMLVideoElement);
        this.mpegtsPlayer.on(
            mpegts.Events.ERROR,
            (type: string, details: string, info: unknown): void => {
                this.playbackIssue.emit(
                    classifyMpegTsPlaybackIssue(
                        {
                            type,
                            details,
                            info,
                        },
                        this.createSourceMetadata(url, 'video/mp2t')
                    )
                );
            }
        );
        this.mpegtsPlayer.load();
        this.mpegtsPlayer.play();
    }

    private handleVideoJsPlaybackError(): void {
        const source = this.options().sources?.[0];
        const targetVideo = this.target().nativeElement as HTMLVideoElement;
        const videoJsError =
            typeof this.player?.error === 'function'
                ? this.player.error()
                : null;
        const nativeError = targetVideo?.error ?? null;

        this.playbackIssue.emit(
            classifyNativePlaybackIssue(
                videoJsError ?? nativeError,
                this.createSourceMetadata(
                    source?.src ?? targetVideo?.currentSrc ?? '',
                    source?.type
                )
            )
        );
    }

    private createSourceMetadata(url: string, mimeType?: string) {
        return createPlaybackSourceMetadata({
            url,
            mimeType,
            player: InlinePlaybackPlayer.VideoJs,
        });
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
        console.log(
            '[AudioTrack] Audio tracks count:',
            audioTracks?.length ?? 0
        );
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
