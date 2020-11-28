import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import * as Hls from 'hls.js';
import { ChannelQuery, Channel, ChannelStore } from '../state';
import { Observable } from 'rxjs';
import { MatSidenav } from '@angular/material/sidenav';
import { ElectronService } from '../services/electron.service';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Settings, VideoPlayerType } from '../settings/settings.interface';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Settings key in storage */
export const SETTINGS_STORE_KEY = 'settings';

@Component({
    selector: 'app-video-player',
    templateUrl: './video-player.component.html',
    styleUrls: ['./video-player.component.css'],
})
export class VideoPlayerComponent implements OnInit {
    /** Channels list */
    channels$: Observable<Channel[]> = this.channelQuery.selectAll();

    /** Favorites list */
    favorites$: Observable<string[]> = this.channelQuery.select(
        (store) => store.favorites
    );

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: false })
    videoPlayer: ElementRef<HTMLVideoElement>;

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
     * @param channelStore akita's channel store
     * @param electronService electron service
     * @param storage browser storage service
     * @param snackBar service to push snackbar notifications
     */
    constructor(
        private channelQuery: ChannelQuery,
        private channelStore: ChannelStore,
        private electronService: ElectronService,
        private snackBar: MatSnackBar,
        private storage: StorageMap
    ) {}

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
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
            this.hls.attachMedia(this.videoPlayer.nativeElement);
            this.channelTitle = channel.name;
        } else if (
            this.videoPlayer.nativeElement.canPlayType(
                'application/vnd.apple.mpegurl'
            )
        ) {
            this.videoPlayer.nativeElement.src = channel.url;
            this.videoPlayer.nativeElement.addEventListener(
                'loadedmetadata',
                () => {
                    this.videoPlayer.nativeElement.play();
                }
            );
        }
    }

    /**
     * Opens about application dialog
     */
    openAbout(): void {
        this.electronService.ipcRenderer.send('show-about');
    }

    /**
     * Adds/removes a given channel to the favorites list
     * @param channel channel to add
     */
    addToFavorites(channel: Channel): void {
        this.snackBar.open('Favorites were updated!', null, { duration: 2000 });
        this.channelStore.updateFavorite(channel);
    }
}
