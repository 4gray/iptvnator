import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import {
    Component,
    Injector,
    NgZone,
    OnInit,
    effect,
    inject,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import {
    ArtPlayerComponent,
    AudioPlayerComponent,
    EpgListComponent,
    HtmlVideoPlayerComponent,
    InfoOverlayComponent,
    MultiEpgContainerComponent,
    SidebarComponent,
    ToolbarComponent,
    VjsPlayerComponent,
} from 'components';
import * as PlaylistActions from 'm3u-state';
import {
    selectActive,
    selectChannels,
    selectCurrentEpgProgram,
} from 'm3u-state';
import { Observable, combineLatestWith, filter, map, switchMap } from 'rxjs';
import {
    CHANNEL_SET_USER_AGENT,
    COMPONENT_OVERLAY_REF,
    Channel,
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    Playlist,
    STORE_KEY,
    Settings,
    VideoPlayer,
} from 'shared-interfaces';
import { SettingsStore } from '../../services/settings-store.service';
import { SettingsComponent } from '../../settings/settings.component';

/** Possible sidebar view options */
export type SidebarView = 'CHANNELS' | 'PLAYLISTS';

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
export class VideoPlayerComponent implements OnInit {
    private activatedRoute = inject(ActivatedRoute);
    private dataService = inject(DataService);
    private readonly dialog = inject(MatDialog);
    private ngZone = inject(NgZone);
    private overlay = inject(Overlay);
    private playlistsService = inject(PlaylistsService);
    private router = inject(Router);
    private settingsStore = inject(SettingsStore);
    private snackBar = inject(MatSnackBar);
    private storage = inject(StorageMap);
    private store = inject(Store);

    /** Active selected channel */
    activeChannel$ = this.store
        .select(selectActive)
        .pipe(filter((channel) => Boolean((channel as Channel)?.url)));

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

    readonly isDesktop = !!window['electron'];

    sidebarView: SidebarView = 'CHANNELS';

    /** EPG overlay reference */
    private overlayRef!: OverlayRef;

    volume = 1;

    constructor() {
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
                if (params['id']) {
                    this.store.dispatch(
                        PlaylistActions.setActivePlaylist({
                            playlistId: params['id'],
                        })
                    );
                    return this.playlistsService.getPlaylist(params['id']).pipe(
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
                            return playlist.playlist.items as Channel[];
                        })
                    );
                } else if (queryParams['url']) {
                    return this.store.select(selectChannels) as Observable<
                        Channel[]
                    >;
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
        const playlistUrl = this.activatedRoute.snapshot.queryParams['url'];

        if (playlistUrl && playlistUrl.match(URL_REGEX)) {
            this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
                url: playlistUrl,
                isTemporary: true,
            });
        }
    }

    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.isDesktop) {
                this.dataService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.execute(response))
                );
            } else {
                const cb = (response: any) => {
                    if (response.data.type === command.id) {
                        command.execute(response.data);
                    }
                };
                this.dataService.listenOn(command.id, cb);
            }
        });
    }

    /**
     * Reads the app configuration from the browsers storage and applies the settings in the current component
     */
    applySettings(): void {
        this.storage.get(STORE_KEY.Settings).subscribe((settings: unknown) => {
            if (settings && Object.keys(settings as Settings).length > 0) {
                this.playerSettings = {
                    player:
                        (settings as Settings).player || VideoPlayer.VideoJs,
                    showCaptions: (settings as Settings).showCaptions || false,
                };
            }
        });
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
        componentRef.instance.playlistChannels = this.store.select(
            selectChannels
        ) as Observable<Channel[]>;

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

    openSettings() {
        this.dialog.open(SettingsComponent, {
            width: '1000px',
            height: '90%',
            data: { isDialog: true },
        });
    }
}
