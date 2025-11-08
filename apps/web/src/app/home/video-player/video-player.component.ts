import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, Injector, OnInit, effect, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { DataService, PlaylistsService } from 'services';
import {
    COMPONENT_OVERLAY_REF,
    Channel,
    PLAYLIST_PARSE_BY_URL,
    STORE_KEY,
    Settings,
    SidebarView,
    VideoPlayer,
} from 'shared-interfaces';
import { SettingsStore } from '../../services/settings-store.service';
import { SettingsComponent } from '../../settings/settings.component';

@Component({
    imports: [
        ArtPlayerComponent,
        AsyncPipe,
        AudioPlayerComponent,
        CommonModule,
        EpgListComponent,
        HtmlVideoPlayerComponent,
        InfoOverlayComponent,
        MatSidenavModule,
        RouterLink,
        SidebarComponent,
        ToolbarComponent,
        VjsPlayerComponent,
    ],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
})
export class VideoPlayerComponent implements OnInit {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly dialog = inject(MatDialog);
    private readonly overlay = inject(Overlay);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly settingsStore = inject(SettingsStore);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);

    /** Active selected channel */
    readonly activeChannel$ = this.store
        .select(selectActive)
        .pipe(filter((channel) => Boolean((channel as Channel)?.url)));

    /** Channels list */
    channels$!: Observable<Channel[]>;

    /** Current epg program */
    readonly epgProgram$ = this.store.select(selectCurrentEpgProgram);

    /** Selected video player options */
    playerSettings: Partial<Settings> = {
        player: VideoPlayer.VideoJs,
        showCaptions: false,
    };

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
                            // Set user agent if specified on playlist level
                            if (playlist.userAgent) {
                                window.electron?.setUserAgent(
                                    playlist.userAgent,
                                    'localhost'
                                );
                            }

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
