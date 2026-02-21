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
import Hls from 'hls.js';
import { Channel } from 'shared-interfaces';

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

    private player!: Artplayer;
    private hls: Hls | null = null;

    private readonly elementRef = inject(ElementRef);

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
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.player) {
            this.player.destroy();
        }
    }

    private initPlayer(): void {
        const el = this.elementRef.nativeElement.querySelector(
            '.artplayer-container'
        );
        const isLive = this.channel?.url?.toLowerCase().includes('m3u8');

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
                        this.hls.loadSource(url);
                        this.hls.attachMedia(video);
                        this.setupHlsAudioTracks();
                    } else if (
                        video.canPlayType('application/vnd.apple.mpegurl')
                    ) {
                        video.src = url;
                    }
                },
                mkv: function (video: HTMLVideoElement, url: string) {
                    video.src = url;
                    video.onerror = () => {
                        console.error('Error loading MKV file:', video.error);
                        video.src = url;
                    };
                },
            },
        });

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

            this.player.setting.add({
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
                onSelect: function (this: Artplayer, item: any) {
                    const selectedIndex = tracks.findIndex(
                        (t, i) =>
                            (t.name || t.lang || `Track ${i + 1}`) === item.html
                    );
                    if (selectedIndex >= 0) {
                        hls.audioTrack = selectedIndex;
                    }
                    return item.html;
                },
            } as any);
        });
    }

    private getVideoType(url: string): string {
        const extension = url.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'mkv':
                return 'video/matroska';
            case 'm3u8':
                return 'm3u8';
            case 'mp4':
                return 'mp4';
            default:
                return 'auto';
        }
    }
}
