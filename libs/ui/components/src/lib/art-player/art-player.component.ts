import {
    Component,
    ElementRef,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
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

    private player!: Artplayer;

    private readonly elementRef = inject(ElementRef);

    ngOnInit(): void {
        this.initPlayer();
    }

    ngOnDestroy(): void {
        if (this.player) {
            this.player.destroy();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && !changes['channel'].firstChange) {
            if (this.player) {
                this.player.destroy();
            }
            this.initPlayer();
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
                m3u8: function (video: HTMLVideoElement, url: string) {
                    if (Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(url);
                        hls.attachMedia(video);
                    } else if (
                        video.canPlayType('application/vnd.apple.mpegurl')
                    ) {
                        video.src = url;
                    }
                },
                mkv: function (video: HTMLVideoElement, url: string) {
                    video.src = url;
                    // Add error handling
                    video.onerror = () => {
                        console.error('Error loading MKV file:', video.error);
                        // Fallback to treating it as a regular video
                        video.src = url;
                    };
                },
            },
        });
    }

    private getVideoType(url: string): string {
        const extension = url.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'mkv':
                return 'video/matroska'; // Changed from 'mkv'
            case 'm3u8':
                return 'm3u8';
            case 'mp4':
                return 'mp4';
            default:
                return 'auto';
        }
    }
}
