import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    Component,
    InjectionToken,
    Injector,
    NgZone,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { StorageMap } from '@ngx-pwa/local-storage';
import { filter, map, Observable, skipWhile } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import {
    PLAYLIST_GET_ALL,
    PLAYLIST_PARSE_RESPONSE,
} from '../../../../../shared/ipc-commands';
import { Playlist } from '../../../../../shared/playlist.interface';
import { DataService } from '../../../services/data.service';
import { Settings, VideoPlayer } from '../../../settings/settings.interface';
import { STORE_KEY } from '../../../shared/enums/store-keys.enum';
import { ChannelQuery, ChannelStore } from '../../../state';
import { MultiEpgContainerComponent } from '../multi-epg/multi-epg-container.component';
import { EpgProgram } from './../../models/epg-program.model';

/** Possible sidebar view options */
type SidebarView = 'CHANNELS' | 'PLAYLISTS';

export const COMPONENT_OVERLAY_REF = new InjectionToken(
    'COMPONENT_OVERLAY_REF'
);

@Component({
    selector: 'app-video-player',
    templateUrl: './video-player.component.html',
    styleUrls: ['./video-player.component.scss'],
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
    /** Active selected channel */
    activeChannel$: Observable<Channel> = this.channelQuery
        .select((state) => state.active)
        .pipe(filter((channel) => Boolean(channel)));

    /** Channels list */
    channels$: Observable<Channel[]> = this.channelQuery.selectAll();

    /** EPG availability flag */
    epgAvailable$: Observable<boolean> = this.channelQuery.select(
        (store) => store.epgAvailable
    );

    /** Current epg program */
    epgProgram$: Observable<EpgProgram> = this.channelQuery.select(
        (store) => store.currentEpgProgram
    );

    /** Favorites list */
    favorites$: Observable<string[]> = this.channelQuery.select(
        (store) => store.favorites
    );

    /** Selected video player options */
    playerSettings: Partial<Settings> = {
        player: VideoPlayer.VideoJs,
        showCaptions: false,
    };

    /** Playlists array */
    playlists = [];

    /** Sidebar object */
    @ViewChild('sidenav') sideNav: MatSidenav;

    /** ID of the current playlist */
    playlistId$ = this.channelQuery.select().pipe(
        skipWhile(
            (store) => store.playlistId === '' || store.playlistId === undefined
        ),
        map((data) => data.playlistId)
    );

    /** Title of the current playlist */
    playlistTitle$ = this.channelQuery.select().pipe(
        skipWhile((store) => store.playlistFilename === ''),
        map((store) => store.playlistFilename)
    );

    isElectron = this.dataService.isElectron;

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: PLAYLIST_PARSE_RESPONSE,
            execute: (response: { payload: Playlist }): void => {
                this.channelStore.setPlaylist(response.payload);
                this.setSidebarView('CHANNELS');
            },
        },
    ];

    /** Current sidebar view */
    sidebarView: SidebarView = 'CHANNELS';

    listeners = [];

    /** EPG overlay reference */
    overlayRef: OverlayRef;

    /**
     * Creates an instance of VideoPlayerComponent
     */
    constructor(
        private channelQuery: ChannelQuery,
        private channelStore: ChannelStore,
        public dataService: DataService,
        private ngZone: NgZone,
        private overlay: Overlay,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap
    ) {
        this.dataService.sendIpcEvent(PLAYLIST_GET_ALL);
    }

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.applySettings();
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.dataService.isElectron) {
                this.dataService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.execute(response))
                );
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.execute(response.data);
                    }
                };
                this.dataService.listenOn(command.id, cb);
                this.listeners.push(cb);
            }
        });
    }

    /**
     * Reads the app configuration from the browsers storage and applies the settings in the current component
     */
    applySettings(): void {
        this.storage.get(STORE_KEY.Settings).subscribe((settings: Settings) => {
            if (settings && Object.keys(settings).length > 0) {
                this.playerSettings = {
                    player: settings.player || VideoPlayer.VideoJs,
                    showCaptions: settings.showCaptions || false,
                };
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
     * Adds/removes a given channel to the favorites list
     * @param channel channel to add
     */
    addToFavorites(channel: Channel): void {
        this.snackBar.open('Favorites were updated!', null, { duration: 2000 });
        this.channelStore.updateFavorite(channel);
    }

    /**
     * Switches the sidebar view to the specified value
     * @param view view to change
     */
    setSidebarView(view: SidebarView) {
        this.sidebarView = view;
    }

    /** Navigates back */
    goBack(): void {
        if (this.sidebarView === 'PLAYLISTS') {
            this.router.navigate(['/']);
        } else {
            this.sidebarView = 'PLAYLISTS';
        }
    }

    ngOnDestroy() {
        if (this.dataService.isElectron) {
            this.dataService.removeAllListeners(PLAYLIST_PARSE_RESPONSE);
        } else {
            this.listeners.forEach((listener) =>
                window.removeEventListener('message', listener)
            );
        }
    }

    /**
     * Opens the overlay with multi EPG view
     */
    openMultiEpgView() {
        this.overlayRef = this.overlay.create();
        const injector = Injector.create({
            providers: [
                { provide: COMPONENT_OVERLAY_REF, useValue: this.overlayRef },
            ],
        });
        const componentPortal = new ComponentPortal(
            MultiEpgContainerComponent,
            undefined,
            injector
        );
        this.overlayRef.addPanelClass('epg-overlay');
        this.overlayRef.attach(componentPortal);
    }
}
