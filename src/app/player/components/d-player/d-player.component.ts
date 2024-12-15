import { CommonModule } from '@angular/common';
import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
} from '@angular/core';
import DPlayer from 'dplayer';
import { Channel } from '../../../../../shared/channel.interface';

@Component({
    selector: 'app-d-player',
    standalone: true,
    imports: [CommonModule],
    template: `<div #dplayer class="dplayer-container"></div>`,
    styles: [
        `
            .dplayer-container {
                width: 100%;
                height: calc(100vh - 64px);
            }
        `,
    ],
})
export class DPlayerComponent implements OnInit, OnDestroy, OnChanges {
    @Input() channel: Channel;
    @Input() volume = 1;
    @Input() showCaptions = false;

    private player: any;

    constructor(private elementRef: ElementRef) {}

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
            // Destroy existing player
            if (this.player) {
                this.player.destroy();
            }
            // Reinitialize with new channel
            this.initPlayer();
        }
    }

    private initPlayer(): void {
        const el =
            this.elementRef.nativeElement.querySelector('.dplayer-container');
        const isLive = this.channel.url.toLowerCase().includes('m3u8');

        this.player = new DPlayer({
            container: el,
            live: isLive,
            volume: this.volume,
            autoplay: true,
            video: {
                url: this.channel.url + (this.channel.epgParams || ''),
                type: this.getVideoType(this.channel.url),
            },
            logo: this.channel.tvg?.logo,
        });
    }

    private getVideoType(url: string): string {
        const extension = url.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'mkv':
                return 'video/matroska';
            case 'm3u8':
                return 'hls';
            case 'mp4':
                return 'auto';
            default:
                return 'auto';
        }
    }
}
