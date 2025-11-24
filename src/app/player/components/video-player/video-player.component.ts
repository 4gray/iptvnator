import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import {
    Component,
    InjectionToken,
    Injector,
    NgZone,
    OnDestroy,
    OnInit,
    effect,
    inject,
} from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable, combineLatestWith, filter, map, switchMap, take } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import {
    CHANNEL_SET_USER_AGENT,
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
} from '../../../../../shared/ipc-commands';
import { Playlist } from '../../../../../shared/playlist.interface';
import { DataService } from '../../../services/data.service';
import { PlaylistsService } from '../../../services/playlists.service';
import { EpgService } from '../../../services/epg.service';
import { SettingsStore } from '../../../services/settings-store.service';
import { Settings, VideoPlayer } from '../../../settings/settings.interface';
import { STORE_KEY } from '../../../shared/enums/store-keys.enum';
import * as PlaylistActions from '../../../state/actions';
import {
    selectActive,
    selectChannels,
    selectCurrentEpgProgram,
} from '../../../state/selectors';
import { ArtPlayerComponent } from '../art-player/art-player.component';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { EpgListComponent } from '../epg-list/epg-list.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import { InfoOverlayComponent } from '../info-overlay/info-overlay.component';
import { MultiEpgContainerComponent } from '../multi-epg/multi-epg-container.component';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { ToolbarComponent } from './toolbar/toolbar.component';

/** Possible sidebar view options */
export type SidebarView = 'CHANNELS' | 'PLAYLISTS';

export const COMPONENT_OVERLAY_REF = new InjectionToken(
    'COMPONENT_OVERLAY_REF'
);

@Component({
    imports: [
        AsyncPipe,
        AudioPlayerComponent,
        InfoOverlayComponent,
        CommonModule,
        EpgListComponent,
        HtmlVideoPlayerComponent,
        MatSidenavModule,
        RouterLink,
        SidebarComponent,
        ToolbarComponent,
        VjsPlayerComponent,
        ArtPlayerComponent,
    ],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
    /** Active selected channel */
    activeChannel$ = this.store
        .select(selectActive)
        .pipe(filter((channel) => Boolean(channel?.url)));

    /** Channels list */
    channels$!: Observable<Channel[]>;

    /** Current epg program */
    epgProgram$ = this.store.select(selectCurrentEpgProgram);

    /** Selected video player options */
    playerSettings: Partial<Settings> = {
        player: VideoPlayer.VideoJs,
        showCaptions: false,
    };

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: ERROR,
            execute: (response: { message: string }): void => {
                this.snackBar.open(response.message, '', {
                    duration: 3100,
                });
            },
        },
        {
            id: PLAYLIST_PARSE_RESPONSE,
            execute: (response: { payload: Playlist }): void => {
                if (response.payload.isTemporary) {
                    this.store.dispatch(
                        PlaylistActions.setChannels({
                            channels: response.payload.playlist.items,
                        })
                    );
                } else {
                    this.store.dispatch(
                        PlaylistActions.addPlaylist({
                            playlist: response.payload,
                        })
                    );
                }
                this.sidebarView = 'CHANNELS';
            },
        },
    ];

    listeners = [];

    isTauri = this.dataService.getAppEnvironment() === 'tauri';

    sidebarView: SidebarView = 'CHANNELS';

    /** EPG overlay reference */
    overlayRef: OverlayRef;

    volume = 1;

    private settingsStore = inject(SettingsStore);

    constructor(
        private activatedRoute: ActivatedRoute,
        private dataService: DataService,
        private epgService: EpgService,
        private ngZone: NgZone,
        private overlay: Overlay,
        private playlistsService: PlaylistsService,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private store: Store
    ) {
        // Initialize volume from localStorage in constructor
        const savedVolume = localStorage.getItem('volume');
        if (savedVolume !== null) {
            this.volume = Number(savedVolume);
        }

        // React to settings changes
        effect(() => {
            this.playerSettings = {
                player: this.settingsStore.player(),
                showCaptions: this.settingsStore.showCaptions(),
            };
        });
    }

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.applySettings();
        this.setRendererListeners();
        this.getPlaylistUrlAsParam();

        this.channels$ = this.activatedRoute.params.pipe(
            combineLatestWith(this.activatedRoute.queryParams),
            switchMap(([params, queryParams]) => {
                if (params.id) {
                    this.store.dispatch(
                        PlaylistActions.setActivePlaylist({
                            playlistId: params.id,
                        })
                    );
                    return this.playlistsService.getPlaylist(params.id).pipe(
                        map((playlist) => {
                            this.dataService.sendIpcEvent(
                                CHANNEL_SET_USER_AGENT,
                                playlist.userAgent
                                    ? {
                                          referer: 'localhost',
                                          userAgent: playlist.userAgent,
                                      }
                                    : {}
                            );

                        this.store.dispatch(
                            PlaylistActions.setChannels({
                                channels: playlist.playlist.items,
                            })
                        );
                        
                        // Auto-play last watched channel if no active channel
                        this.autoplayLastWatchedChannel(params.id, playlist.playlist.items);
                        
                            return playlist.playlist.items;
                        })
                    );
                } else if (queryParams.url) {
                    return this.store.select(selectChannels);
                }
            })
        );
    }

    /**
     * Opens a playlist provided as a url param
     * e.g. iptvnat.or?url=http://...
     * @pwaOnly
     */
    getPlaylistUrlAsParam() {
        const URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;
        const playlistUrl = this.activatedRoute.snapshot.queryParams.url;

        if (playlistUrl && playlistUrl.match(URL_REGEX)) {
            this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
                url: playlistUrl,
                isTemporary: true,
            });
        }
    }

    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.isTauri) {
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

    ngOnDestroy() {
        this.listeners.forEach((listener) =>
            window.removeEventListener('message', listener)
        );
    }

    /**
     * Opens the overlay with multi EPG view
     */
    openMultiEpgView(): void {
        const positionStrategy = this.overlay
            .position()
            .global()
            .centerHorizontally()
            .centerVertically();

        this.overlayRef = this.overlay.create({
            hasBackdrop: true,
            positionStrategy,
            width: '100%',
            height: '100%',
        });

        const injector = Injector.create({
            providers: [
                {
                    provide: COMPONENT_OVERLAY_REF,
                    useValue: this.overlayRef,
                },
            ],
        });

        const portal = new ComponentPortal(
            MultiEpgContainerComponent,
            null,
            injector
        );

        const componentRef = this.overlayRef.attach(portal);
        componentRef.instance.playlistChannels =
            this.store.select(selectChannels);

        this.overlayRef.backdropClick().subscribe(() => {
            this.overlayRef.dispose();
        });
    }

    openUrl(url: string) {
        window.open(url, '_blank');
    }

    navigateHome() {
        this.router.navigate(['/']);
    }

    /**
     * Auto-plays the last watched channel if no channel is currently active
     */
    private autoplayLastWatchedChannel(playlistId: string, channels: Channel[]): void {
        // Check if there's already an active channel
        this.store.select(selectActive).pipe(
            take(1)
        ).subscribe((activeChannel) => {
            // If there's already an active channel, don't autoplay
            if (activeChannel?.id) {
                return;
            }

            // Try to get last watched channel from localStorage
            try {
                const storageKey = `lastWatchedChannel_${playlistId || 'default'}`;
                const lastChannelId = localStorage.getItem(storageKey);
                
                if (lastChannelId && channels.length > 0) {
                    // Find the channel in the current playlist
                    const lastWatchedChannel = channels.find(ch => ch.id === lastChannelId);
                    
                    if (lastWatchedChannel) {
                        // Auto-play the last watched channel
                        this.store.dispatch(PlaylistActions.setActiveChannel({ channel: lastWatchedChannel }));
                        
                        const epgChannelId = lastWatchedChannel?.name?.trim();
                        if (epgChannelId) {
                            this.epgService.getChannelPrograms(epgChannelId);
                        }
                    }
                }
            } catch (error) {
                console.error('Error auto-playing last watched channel:', error);
            }
        });
    }
}
