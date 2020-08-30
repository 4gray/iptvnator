import { Component, OnInit, ViewChild } from '@angular/core';
import * as Hls from 'hls.js';
import { ChannelQuery, Channel } from '../state';
import { Observable } from 'rxjs';
import { MatSidenav } from '@angular/material/sidenav';
import * as _ from 'lodash';

@Component({
    selector: 'app-video-player',
    templateUrl: './video-player.component.html',
    styleUrls: ['./video-player.component.css'],
})
export class VideoPlayerComponent implements OnInit {
    /** electrons ipc reference */
    renderer = window.require('electron').ipcRenderer;

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

    /**
     * Creates an instance of VideoPlayerComponent
     * @param channelQuery akita's channel query
     */
    constructor(private channelQuery: ChannelQuery) {}

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.channels$ = this.channelQuery.selectAll();
        this.videoPlayer = document.getElementById(
            'video-player'
        ) as HTMLVideoElement;
        this.activeChannel$ = this.channelQuery.select((state) => state.active);
    }

    /**
     * Closes sidebar
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
        this.renderer.send('show-about');
    }
}
