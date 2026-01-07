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
import mpegts from 'mpegts.js';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-quality-selector-hls';

export interface CodecError {
    type: 'unsupported_audio' | 'unsupported_video' | 'unknown';
    codec?: string;
    message: string;
}

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
    /** mpegts.js player instance for raw .ts streams */
    mpegtsPlayer: mpegts.Player | null = null;
    @Input() volume = 1;
    /** Emits when a codec error is detected */
    @Output() codecError = new EventEmitter<CodecError>();
    /** Track if we've already shown a codec error for current stream */
    private codecErrorShown = false;
    /** Track if we've already encountered a fatal error */
    private fatalErrorOccurred = false;
    /** Track if the player is being destroyed to prevent race conditions */
    private isDestroying = false;

    /**
     * Instantiate Video.js on component init
     */
    ngOnInit(): void {
        this.initPlayer();
    }

    /**
     * Initialize the player with appropriate handling for different stream types
     */
    private initPlayer(): void {
        const sourceUrl = this.options?.sources?.[0]?.src || '';
        const isMpegTs = this.isMpegTsStream(sourceUrl);

        this.player = videoJs(
            this.target.nativeElement,
            {
                ...this.options,
                autoplay: !isMpegTs, // Don't autoplay for mpegts, we'll handle it manually
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

                // Listen for video element errors
                this.player.on('error', () => {
                    this.handleVideoJsError();
                });

                // Initialize plugins if available (must be inside ready callback)
                // Using videojs-quality-selector-hls (Video.js 8+ compatible fork)
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

                // If it's an MPEG-TS stream, set up mpegts.js
                if (isMpegTs) {
                    this.setupMpegTs(sourceUrl);
                }
            }
        );
    }

    /**
     * Check if the URL is a raw MPEG-TS stream
     */
    private isMpegTsStream(url: string): boolean {
        const cleanUrl = url.split(/[#?]/)[0];
        const extension = cleanUrl.split('.').pop()?.toLowerCase();
        return extension === 'ts';
    }

    /**
     * Detect if a URL is likely a live stream vs VOD
     * By default, assume live stream unless we detect VOD patterns
     *
     * VOD patterns (Xtream/Stalker):
     * - /movie/ - Xtream VOD movies
     * - /series/ - Xtream series episodes
     * - /vod/ - Generic VOD path
     * - /films/ - Alternative VOD path
     *
     * Live patterns are the default for .ts files
     */
    private isLikelyLiveStream(url: string): boolean {
        const lowerUrl = url.toLowerCase();

        // Explicit VOD patterns - if these match, it's NOT live
        const vodPatterns = [
            /\/movie\//i,      // Xtream VOD movies
            /\/series\//i,     // Xtream series episodes
            /\/vod\//i,        // Generic VOD path
            /\/films?\//i,     // Film/Films path
        ];

        // If URL contains VOD patterns, it's NOT a live stream
        if (vodPatterns.some(pattern => pattern.test(lowerUrl))) {
            return false;
        }

        // Otherwise, default to live stream for .ts files
        // (live streams are more common for raw .ts)
        return true;
    }

    /**
     * Set up mpegts.js for raw MPEG-TS streams
     */
    private setupMpegTs(url: string): void {
        if (!mpegts.isSupported()) {
            console.warn('mpegts.js is not supported in this browser');
            return;
        }

        this.destroyMpegTs();
        this.codecErrorShown = false;
        this.fatalErrorOccurred = false;
        this.isDestroying = false;

        const videoElement = this.player.tech().el() as HTMLVideoElement;
        const isLive = this.isLikelyLiveStream(url);
        console.log(`... switching channel (mpegts.js, ${isLive ? 'live' : 'VOD'}) to`, url);

        this.mpegtsPlayer = mpegts.createPlayer(
            {
                type: 'mpegts',
                isLive: isLive,
                url: url,
            },
            {
                // Worker can cause race conditions on destroy, disable for stability
                enableWorker: false,
                // Stash buffer settings - larger for VOD to buffer more before playing
                enableStashBuffer: true,
                stashInitialSize: isLive ? 128 * 1024 : 512 * 1024,
                // Source buffer cleanup
                autoCleanupSourceBuffer: true,
                autoCleanupMaxBackwardDuration: isLive ? 30 : 120,
                autoCleanupMinBackwardDuration: isLive ? 10 : 60,
                // Fix timestamp issues common in VOD .ts files
                fixAudioTimestampGap: true,
                // For VOD: use range requests for better seeking
                seekType: isLive ? 'param' : 'range',
                // Disable live-specific features for VOD
                liveBufferLatencyChasing: isLive,
                liveBufferLatencyMaxLatency: isLive ? 1.5 : 0,
                liveBufferLatencyMinRemain: isLive ? 0.5 : 0,
                // VOD-specific: lazy loading and deferred load
                lazyLoad: !isLive,
                lazyLoadMaxDuration: isLive ? 0 : 300,
                deferLoadAfterSourceOpen: !isLive,
            }
        );

        // Listen for mpegts.js errors
        this.mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
            this.handleMpegtsError(errorType, errorDetail, errorInfo);
        });

        this.mpegtsPlayer.attachMediaElement(videoElement);
        this.mpegtsPlayer.load();

        // For VOD, wait for enough data to buffer before playing to avoid StartupStallJumper issues
        if (!isLive) {
            // Wait for canplay event before starting playback
            const onCanPlay = () => {
                videoElement.removeEventListener('canplay', onCanPlay);
                if (this.mpegtsPlayer && !this.fatalErrorOccurred) {
                    this.mpegtsPlayer.play();
                }
            };
            videoElement.addEventListener('canplay', onCanPlay);
            // Fallback: start playing after 3 seconds if canplay hasn't fired
            setTimeout(() => {
                if (this.mpegtsPlayer && !this.fatalErrorOccurred) {
                    videoElement.removeEventListener('canplay', onCanPlay);
                    this.mpegtsPlayer.play();
                }
            }, 3000);
        } else {
            this.mpegtsPlayer.play();
        }
    }

    /**
     * Handle Video.js errors (from the video element directly)
     */
    private handleVideoJsError(): void {
        if (this.fatalErrorOccurred || this.isDestroying) {
            return;
        }

        const error = this.player.error();
        if (!error) return;

        console.error('Video.js error:', error.code, error.message);

        // MEDIA_ERR_DECODE (code 3) - decoding failed
        if (error.code === 3 && !this.codecErrorShown) {
            console.log('Emitting codec error for MEDIA_ERR_DECODE');
            this.codecErrorShown = true;
            this.fatalErrorOccurred = true;
            const codecErrorPayload = {
                type: 'unknown' as const,
                codec: 'MPEG-TS',
                message: 'This stream format is not fully supported by the browser. Use VLC or MPV for better compatibility.'
            };
            console.log('Codec error payload:', codecErrorPayload);
            this.codecError.emit(codecErrorPayload);
            // Stop mpegts.js to prevent further errors
            this.destroyMpegTs();
        }
    }

    /**
     * Handle mpegts.js errors and detect codec issues
     */
    private handleMpegtsError(errorType: string, errorDetail: string, errorInfo?: any): void {
        // Prevent errors during destruction or after fatal error
        if (this.fatalErrorOccurred || this.isDestroying) {
            return;
        }

        console.error('mpegts.js error:', errorType, errorDetail, errorInfo);

        // Check for codec-related errors
        const errorMessage = errorInfo?.msg || errorInfo?.message || String(errorInfo) || '';

        // Detect fatal MSE errors that cause infinite loops
        // These occur when the SourceBuffer is in an error state but mpegts.js keeps trying to append
        const isFatalMseError =
            errorMessage.includes('appendBuffer') ||
            errorMessage.includes('SourceBuffer') ||
            errorMessage.includes('HTMLMediaElement.error') ||
            errorDetail === 'MEDIA_ERROR' ||
            errorType === 'MediaError';

        if (isFatalMseError) {
            console.warn('mpegts.js: Fatal MSE error detected, stopping playback to prevent error loop');
            this.fatalErrorOccurred = true;

            // Check if this is a decode error (browser can't handle the stream)
            if (!this.codecErrorShown && (
                errorMessage.includes('MEDIA_ERR_DECODE') ||
                errorMessage.includes('corruption') ||
                errorMessage.includes('features your browser did not support')
            )) {
                this.codecErrorShown = true;
                this.codecError.emit({
                    type: 'unknown',
                    codec: 'MPEG-TS',
                    message: 'This stream format is not fully supported by the browser. Use VLC or MPV for better compatibility.'
                });
            }

            // Destroy the mpegts player to stop further errors
            this.destroyMpegTs();
            return;
        }

        // Detect unsupported audio codecs (EC-3, AC-3, etc.)
        if (errorMessage.includes('ec-3') ||
            errorMessage.includes('ac-3') ||
            (errorMessage.includes('audio/mp4') && errorMessage.includes('unsupported'))) {
            if (!this.codecErrorShown) {
                this.codecErrorShown = true;
                this.fatalErrorOccurred = true;
                const codec = this.extractCodecFromError(errorMessage);
                this.codecError.emit({
                    type: 'unsupported_audio',
                    codec: codec,
                    message: `Unsupported audio codec: ${codec}. Use VLC or MPV for full codec support.`
                });
                // Stop playback to prevent error loop
                this.destroyMpegTs();
            }
        }
        // Detect unsupported video codecs (HEVC in some browsers, etc.)
        else if (errorMessage.includes('hev1') ||
                 errorMessage.includes('hvc1') ||
                 (errorMessage.includes('video/mp4') && errorMessage.includes('unsupported'))) {
            if (!this.codecErrorShown) {
                this.codecErrorShown = true;
                this.fatalErrorOccurred = true;
                const codec = this.extractCodecFromError(errorMessage);
                this.codecError.emit({
                    type: 'unsupported_video',
                    codec: codec,
                    message: `Unsupported video codec: ${codec}. Use VLC or MPV for full codec support.`
                });
                // Stop playback to prevent error loop
                this.destroyMpegTs();
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

    /**
     * Destroy mpegts.js player instance
     */
    private destroyMpegTs(): void {
        if (this.mpegtsPlayer) {
            // Set flag first to prevent any error handlers from running
            this.isDestroying = true;
            try {
                // Remove all event listeners first
                this.mpegtsPlayer.off(mpegts.Events.ERROR, this.handleMpegtsError);
                this.mpegtsPlayer.pause();
                this.mpegtsPlayer.unload();
                this.mpegtsPlayer.detachMediaElement();
                this.mpegtsPlayer.destroy();
            } catch (e) {
                // Ignore errors during cleanup
                console.warn('mpegts.js cleanup warning:', e);
            }
            this.mpegtsPlayer = null;
            this.isDestroying = false;
        }
    }

    /**
     * Replaces the url source of the player with the changed source url
     * @param changes contains changed channel object
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['options']?.previousValue && this.player) {
            const newSource = changes['options'].currentValue.sources[0];
            const newUrl = newSource?.src || '';
            const isMpegTs = this.isMpegTsStream(newUrl);

            // Reset codec error state for new stream
            this.codecErrorShown = false;

            // Clean up existing mpegts player if switching sources
            this.destroyMpegTs();

            if (isMpegTs) {
                // For MPEG-TS, set up mpegts.js
                this.setupMpegTs(newUrl);
            } else {
                // For other formats, use Video.js native handling
                this.player.src(newSource);
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
}
