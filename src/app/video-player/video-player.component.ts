import { Component, OnInit, ViewChild } from '@angular/core';
import * as Hls from 'hls.js';
import { ChannelQuery, Channel } from '../state';
import { Observable } from 'rxjs';
import { MatSidenav } from '@angular/material/sidenav';
import { ElectronService } from 'app/services/electron.service';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Settings, VideoPlayerType } from 'app/settings/settings.interface';

/** Settings key in storage */
export const SETTINGS_STORE_KEY = 'settings';

@Component({
    selector: 'app-video-player',
    templateUrl: './video-player.component.html',
    styleUrls: ['./video-player.component.css'],
})
export class VideoPlayerComponent implements OnInit {
    /** Channels list */
    channels$: Observable<Channel[]>;

    /** Video player DOM element */
    videoPlayer: HTMLVideoElement;

    /** HLS object */
    hls = new Hls();

    /** Name of the selected channel */
    channelTitle: string;

    /** Active selected channel */
    activeChannel$: Observable<Channel>;

    /** Sidebar object */
    @ViewChild('sidenav') sideNav: MatSidenav;

    /** Selected video player component */
    player: VideoPlayerType = 'html5';

    /**
     * Creates an instance of VideoPlayerComponent
     * @param channelQuery akita's channel query
     * @param electronService electron service
     * @param storage browser storage service
     */
    constructor(
        private channelQuery: ChannelQuery,
        private electronService: ElectronService,
        private storage: StorageMap
    ) {}

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.channels$ = this.channelQuery.selectAll();

        this.activeChannel$ = this.channelQuery.select((state) => state.active);

        this.applySettings();
    }

    /**
     * Reads the app configuration from the browsers storage and applies the settings in the current component
     */
    applySettings(): void {
        this.storage.get(SETTINGS_STORE_KEY).subscribe((settings: Settings) => {
            if (settings && Object.keys(settings).length > 0) {
                this.player = settings.player;
                if (this.player === 'html5') {
                    this.videoPlayer = document.getElementById(
                        'video-player'
                    ) as HTMLVideoElement;
                }
            }
        });
    }

    /**
     * Closes the channels sidebar
     */
    close(): void {
        this.sideNav.close();
    }

    /**
     * Starts to play the given channel
     * @param channel given channel object
     */
    playChannel(channel: Channel): void {
        if (Hls.isSupported()) {
            console.log('... switching channel to ', channel.name, channel.url);
            this.hls.loadSource(channel.url);
            this.hls.attachMedia(this.videoPlayer);
            this.channelTitle = channel.name;
        } else if (
            this.videoPlayer.canPlayType('application/vnd.apple.mpegurl')
        ) {
            this.videoPlayer.src = channel.url;
            this.videoPlayer.addEventListener('loadedmetadata', () => {
                this.videoPlayer.play();
            });
        }
    }

    /**
     * Opens about application dialog
     */
    openAbout(): void {
        this.electronService.ipcRenderer.send('show-about');
    }
}
