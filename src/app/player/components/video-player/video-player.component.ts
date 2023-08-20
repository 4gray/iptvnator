import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    Component,
    InjectionToken,
    Injector,
    NgZone,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable, combineLatestWith, filter, map, switchMap } from 'rxjs';
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
import { Settings, VideoPlayer } from '../../../settings/settings.interface';
import { STORE_KEY } from '../../../shared/enums/store-keys.enum';
import * as PlaylistActions from '../../../state/actions';
import {
    selectActive,
    selectChannels,
    selectCurrentEpgProgram,
} from '../../../state/selectors';
import { MultiEpgContainerComponent } from '../multi-epg/multi-epg-container.component';

/** Possible sidebar view options */
export type SidebarView = 'CHANNELS' | 'PLAYLISTS';

export const COMPONENT_OVERLAY_REF = new InjectionToken(
    'COMPONENT_OVERLAY_REF'
);

@Component({
    templateUrl: './video-player.component.html',
    styleUrls: ['./video-player.component.scss'],
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

    isElectron = this.dataService.isElectron;

    sidebarView: SidebarView = 'CHANNELS';

    /** EPG overlay reference */
    overlayRef: OverlayRef;

    constructor(
        private activatedRoute: ActivatedRoute,
        private dataService: DataService,
        private ngZone: NgZone,
        private overlay: Overlay,
        private playlistsService: PlaylistsService,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private store: Store
    ) {}

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

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.isElectron) {
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
        if (this.isElectron) {
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

    openUrl(url: string) {
        window.open(url, '_blank');
    }

    navigateHome() {
        this.router.navigate(['/']);
    }
}
