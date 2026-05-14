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
import Hls, { type ErrorData, type ManifestParsedData } from 'hls.js';
import mpegts from 'mpegts.js';
import { Channel } from 'shared-interfaces';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    classifyUnsupportedHlsManifestCodecs,
    createPlaybackSourceMetadata,
    getPlaybackMediaExtensionFromUrl,
} from '../playback-diagnostics/playback-diagnostics.util';

type AudioTrackSelector = {
    html: string | HTMLElement;
    default?: boolean;
};

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
    @Input() startTime = 0;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    @Output() playbackIssue = new EventEmitter<PlaybackDiagnostic | null>();

    private player!: Artplayer;
    private hls: Hls | null = null;
    private mpegtsPlayer: mpegts.Player | null = null;

    private readonly elementRef = inject(ElementRef);

    private readonly handleNativePlaybackError = () => {
        this.playbackIssue.emit(
            classifyNativePlaybackIssue(
                this.player?.video?.error,
                this.createSourceMetadata(
                    this.channel?.url ?? this.player?.video?.currentSrc ?? ''
                )
            )
        );
    };

    private readonly clearPlaybackIssue = () => {
        this.playbackIssue.emit(null);
    };

    ngOnInit(): void {
        this.initPlayer();
    }

    ngOnDestroy(): void {
        this.destroyPlayer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && !changes['channel'].firstChange) {
            this.destroyPlayer();
            this.initPlayer();
        }
    }

    private destroyPlayer(): void {
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.pause();
            this.mpegtsPlayer.unload();
            this.mpegtsPlayer.detachMediaElement();
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.player) {
            this.player.video?.removeEventListener(
                'error',
                this.handleNativePlaybackError
            );
            this.player.video?.removeEventListener(
                'loadeddata',
                this.clearPlaybackIssue
            );
            this.player.video?.removeEventListener(
                'playing',
                this.clearPlaybackIssue
            );
            this.player.destroy();
        }
    }

    private initPlayer(): void {
        this.playbackIssue.emit(null);
        const el = this.elementRef.nativeElement.querySelector(
            '.artplayer-container'
        );
        const extension = getPlaybackMediaExtensionFromUrl(
            this.channel?.url ?? ''
        );
        const isLive = extension === 'm3u8' || extension === 'ts' || !extension;

        this.player = new Artplayer({
            container: el,
            url: this.channel.url + (this.channel.epgParams || ''),
            volume: this.volume,
            isLive: isLive,
            autoplay: true,
            type: this.getVideoType(this.channel.url),
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
                m3u8: (video: HTMLVideoElement, url: string) => {
                    if (Hls.isSupported()) {
                        if (this.hls) {
                            this.hls.destroy();
                        }
                        this.hls = new Hls();
                        this.hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                            this.handleHlsManifestParsed(url, data);
                        });
                        this.hls.on(Hls.Events.ERROR, (_, data) => {
                            this.handleHlsError(url, data);
                        });
                        this.hls.loadSource(url);
                        this.hls.attachMedia(video);
                        this.setupHlsAudioTracks();
                    } else if (
                        video.canPlayType('application/vnd.apple.mpegurl')
                    ) {
                        video.src = url;
                    }
                },
                ts: (video: HTMLVideoElement, url: string) => {
                    if (mpegts.isSupported()) {
                        if (this.mpegtsPlayer) {
                            this.mpegtsPlayer.destroy();
                        }
                        this.mpegtsPlayer = mpegts.createPlayer({
                            type: 'mpegts',
                            isLive: true,
                            url: url,
                        });
                        this.mpegtsPlayer.attachMediaElement(video);
                        this.mpegtsPlayer.on(
                            mpegts.Events.ERROR,
                            (
                                type: string,
                                details: string,
                                info: unknown
                            ): void => {
                                this.playbackIssue.emit(
                                    classifyMpegTsPlaybackIssue(
                                        {
                                            type,
                                            details,
                                            info,
                                        },
                                        this.createSourceMetadata(
                                            url,
                                            'video/mp2t'
                                        )
                                    )
                                );
                            }
                        );
                        this.mpegtsPlayer.load();
                        this.mpegtsPlayer.play();
                    }
                },
                mkv: (video: HTMLVideoElement, url: string) => {
                    video.src = url;
                },
            },
        });

        this.player.video.addEventListener(
            'error',
            this.handleNativePlaybackError
        );
        this.player.video.addEventListener(
            'loadeddata',
            this.clearPlaybackIssue
        );
        this.player.video.addEventListener('playing', this.clearPlaybackIssue);

        if (this.startTime > 0) {
            this.player.on('ready', () => {
                this.player.seek = this.startTime;
            });
        }

        this.player.on('video:timeupdate', () => {
            this.timeUpdate.emit({
                currentTime: this.player.currentTime,
                duration: this.player.duration,
            });
        });
    }

    private handleHlsManifestParsed(
        url: string,
        data: ManifestParsedData
    ): void {
        const metadata = this.createSourceMetadata(
            url,
            'application/x-mpegURL',
            data.levels
                .map((level) => level.audioCodec)
                .filter((codec): codec is string => Boolean(codec)),
            data.levels
                .map((level) => level.videoCodec)
                .filter((codec): codec is string => Boolean(codec))
        );
        const issue = classifyUnsupportedHlsManifestCodecs(metadata);
        if (issue) {
            this.playbackIssue.emit(issue);
        }
    }

    private handleHlsError(url: string, data: ErrorData): void {
        if (!data.fatal) {
            return;
        }

        this.playbackIssue.emit(
            classifyHlsPlaybackIssue(
                {
                    type: data.type,
                    details: data.details,
                    fatal: data.fatal,
                    message: data.error?.message,
                    error: data.error,
                },
                this.createSourceMetadata(url, 'application/x-mpegURL')
            )
        );
    }

    /**
     * Listens for HLS.js audio tracks and adds a settings menu entry
     * to ArtPlayer for switching between available audio tracks.
     */
    private setupHlsAudioTracks(): void {
        if (!this.hls) return;

        const hls = this.hls;

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
            const tracks = hls.audioTracks;
            if (!tracks || tracks.length <= 1) return;

            const audioTrackSetting = {
                html: 'Audio',
                icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="white">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>`,
                width: 220,
                tooltip: tracks[hls.audioTrack]?.name || '',
                selector: tracks.map((track, index) => ({
                    html: track.name || track.lang || `Track ${index + 1}`,
                    default: index === hls.audioTrack,
                })),
                onSelect: function (this: Artplayer, item: AudioTrackSelector) {
                    const selectedLabel =
                        typeof item.html === 'string'
                            ? item.html
                            : (item.html.textContent ?? '');
                    const selectedIndex = tracks.findIndex(
                        (t, i) =>
                            (t.name || t.lang || `Track ${i + 1}`) ===
                            selectedLabel
                    );
                    if (selectedIndex >= 0) {
                        hls.audioTrack = selectedIndex;
                    }
                },
            };

            this.player.setting.add(audioTrackSetting);
        });
    }

    private getVideoType(url: string): string {
        const extension = getPlaybackMediaExtensionFromUrl(url);
        switch (extension) {
            case 'mkv':
                return 'video/matroska';
            case 'm3u8':
                return 'm3u8';
            case 'mp4':
                return 'mp4';
            case 'ts':
                return 'ts';
            default:
                // No recognized extension (e.g. IPTV proxy URL) → default to
                // MPEG-TS which is the most common format for live IPTV streams.
                return extension ? 'auto' : 'ts';
        }
    }

    private createSourceMetadata(
        url: string,
        mimeType?: string,
        audioCodecs: readonly string[] = [],
        videoCodecs: readonly string[] = []
    ) {
        return createPlaybackSourceMetadata({
            url,
            mimeType,
            player: InlinePlaybackPlayer.ArtPlayer,
            audioCodecs,
            videoCodecs,
        });
    }
}
