import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
} from '@angular/core';
import Artplayer from 'artplayer';
import * as dashjs from 'dashjs';
import flvjs from 'flv.js';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Channel } from 'shared-interfaces';
import { CodecError } from '../vjs-player/vjs-player.component';

// Extend Artplayer type to include custom player instances
interface ArtplayerExtended extends Artplayer {
    hls?: Hls;
    mpegts?: mpegts.Player;
    flv?: flvjs.Player;
    dash?: dashjs.MediaPlayerClass;
}

Artplayer.AUTO_PLAYBACK_TIMEOUT = 10000;

@Component({
    selector: 'app-art-player',
    imports: [],
    template: `<div #artplayer class="artplayer-container"></div>`,
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }
            .artplayer-container {
                width: 100%;
                height: 100%;
            }
        `,
    ],
})
export class ArtPlayerComponent implements OnInit, OnDestroy, OnChanges {
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() showCaptions = false;
    /** Emits when a codec error is detected */
    @Output() codecError = new EventEmitter<CodecError>();

    private player!: Artplayer;
    /** Track if we've already shown a codec error for current stream */
    private codecErrorShown = false;

    private readonly elementRef = inject(ElementRef);

    ngOnInit(): void {
        this.initPlayer();
    }

    ngOnDestroy(): void {
        this.destroyPlayer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && !changes['channel'].firstChange) {
            this.codecErrorShown = false;
            this.destroyPlayer();
            this.initPlayer();
        }
    }

    private destroyPlayer(): void {
        if (this.player) {
            this.player.destroy();
        }
    }

    /**
     * HLS.js handler for .m3u8 streams
     */
    private playM3u8 = (
        video: HTMLVideoElement,
        url: string,
        art: Artplayer
    ): void => {
        const player = art as ArtplayerExtended;
        if (Hls.isSupported()) {
            if (player.hls) {
                player.hls.destroy();
            }
            const hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(video);
            player.hls = hls;
            art.on('destroy', () => hls.destroy());
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
        } else {
            art.notice.show = 'Unsupported playback format: m3u8';
        }
    };

    /**
     * mpegts.js handler for .ts MPEG-TS streams
     */
    private playTs = (
        video: HTMLVideoElement,
        url: string,
        art: Artplayer
    ): void => {
        const player = art as ArtplayerExtended;
        if (mpegts.isSupported()) {
            if (player.mpegts) {
                player.mpegts.destroy();
            }
            const mpegtsPlayer = mpegts.createPlayer({
                type: 'mpegts',
                isLive: true,
                url: url,
            });

            // Listen for mpegts.js errors
            mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
                this.handleMpegtsError(errorType, errorDetail, errorInfo);
            });

            mpegtsPlayer.attachMediaElement(video);
            mpegtsPlayer.load();
            player.mpegts = mpegtsPlayer;
            art.on('destroy', () => mpegtsPlayer.destroy());
        } else {
            art.notice.show = 'Unsupported playback format: ts';
        }
    };

    /**
     * flv.js handler for .flv streams
     */
    private playFlv = (
        video: HTMLVideoElement,
        url: string,
        art: Artplayer
    ): void => {
        const player = art as ArtplayerExtended;
        if (flvjs.isSupported()) {
            if (player.flv) {
                player.flv.destroy();
            }
            const flv = flvjs.createPlayer({ type: 'flv', url });
            flv.attachMediaElement(video);
            flv.load();
            player.flv = flv;
            art.on('destroy', () => flv.destroy());
        } else {
            art.notice.show = 'Unsupported playback format: flv';
        }
    };

    /**
     * dash.js handler for .mpd MPEG-DASH streams
     */
    private playMpd = (
        video: HTMLVideoElement,
        url: string,
        art: Artplayer
    ): void => {
        const player = art as ArtplayerExtended;
        if (dashjs.supportsMediaSource()) {
            if (player.dash) {
                player.dash.destroy();
            }
            const dash = dashjs.MediaPlayer().create();
            dash.initialize(video, url, art.option.autoplay);
            player.dash = dash;
            art.on('destroy', () => dash.destroy());
        } else {
            art.notice.show = 'Unsupported playback format: mpd';
        }
    };

    /**
     * Handle mpegts.js errors and detect codec issues
     */
    private handleMpegtsError(errorType: string, errorDetail: string, errorInfo?: any): void {
        console.error('mpegts.js error:', errorType, errorDetail, errorInfo);

        // Check for codec-related errors
        const errorMessage = errorInfo?.msg || errorInfo?.message || String(errorInfo) || '';

        // Detect unsupported audio codecs (EC-3, AC-3, etc.)
        if (errorMessage.includes('ec-3') ||
            errorMessage.includes('ac-3') ||
            errorMessage.includes('audio/mp4') && errorMessage.includes('unsupported')) {
            if (!this.codecErrorShown) {
                this.codecErrorShown = true;
                const codec = this.extractCodecFromError(errorMessage);
                this.codecError.emit({
                    type: 'unsupported_audio',
                    codec: codec,
                    message: `Unsupported audio codec: ${codec}. Use VLC or MPV for full codec support.`
                });
            }
        }
        // Detect unsupported video codecs (HEVC in some browsers, etc.)
        else if (errorMessage.includes('hev1') ||
                 errorMessage.includes('hvc1') ||
                 errorMessage.includes('video/mp4') && errorMessage.includes('unsupported')) {
            if (!this.codecErrorShown) {
                this.codecErrorShown = true;
                const codec = this.extractCodecFromError(errorMessage);
                this.codecError.emit({
                    type: 'unsupported_video',
                    codec: codec,
                    message: `Unsupported video codec: ${codec}. Use VLC or MPV for full codec support.`
                });
            }
        }
    }

    /**
     * Extract codec name from error message
     */
    private extractCodecFromError(errorMessage: string): string {
        // Match common codec patterns
        const codecPatterns = [
            /codecs=['"]?([a-zA-Z0-9.-]+)['"]?/i,
            /(ec-3|ac-3|hev1|hvc1|avc1|mp4a)/i
        ];

        for (const pattern of codecPatterns) {
            const match = errorMessage.match(pattern);
            if (match) {
                return match[1].toUpperCase();
            }
        }
        return 'unknown';
    }

    private initPlayer(): void {
        const el = this.elementRef.nativeElement.querySelector(
            '.artplayer-container'
        );
        const url = this.channel.url + (this.channel.epgParams || '');
        const videoType = this.getVideoType(this.channel.url);
        const isLive = ['m3u8', 'ts', 'flv'].includes(videoType);

        this.player = new Artplayer({
            container: el,
            url: url,
            volume: this.volume,
            isLive: isLive,
            autoplay: true,
            type: videoType,
            pip: true,
            autoPlayback: true,
            autoSize: true,
            autoMini: true,
            screenshot: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            playsInline: true,
            airplay: true,
            backdrop: true,
            mutex: true,
            theme: '#ff0000',
            customType: {
                m3u8: this.playM3u8,
                ts: this.playTs,
                flv: this.playFlv,
                mpd: this.playMpd,
                mkv: (video: HTMLVideoElement, url: string) => {
                    video.src = url;
                },
            },
        });
    }

    /**
     * Get the video type based on URL extension
     */
    private getVideoType(url: string): string {
        // Remove query params and hash, then get extension
        const cleanUrl = url.split(/[#?]/)[0];
        const extension = cleanUrl.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'm3u8':
                return 'm3u8';
            case 'ts':
                return 'ts';
            case 'flv':
                return 'flv';
            case 'mpd':
                return 'mpd';
            case 'mkv':
                return 'mkv';
            case 'mp4':
                return 'mp4';
            case 'webm':
                return 'webm';
            default:
                // Default to m3u8 for unknown types (common in IPTV)
                return 'm3u8';
        }
    }
}
