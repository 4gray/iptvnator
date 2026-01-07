import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import {
    Component,
    HostListener,
    Injector,
    OnInit,
    effect,
    inject,
    viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateService } from '@ngx-translate/core';
import {
    ArtPlayerComponent,
    AudioPlayerComponent,
    CodecError,
    COMPONENT_OVERLAY_REF,
    EpgListComponent,
    HtmlVideoPlayerComponent,
    InfoOverlayComponent,
    MultiEpgContainerComponent,
    SidebarComponent,
    ToolbarComponent,
    VjsPlayerComponent,
} from 'components';
import { PlaylistActions, ChannelActions, FavoritesActions } from 'm3u-state';
import {
    selectActive,
    selectChannels,
    selectCurrentEpgProgram,
} from 'm3u-state';
import {
    Observable,
    combineLatest,
    combineLatestWith,
    filter,
    map,
    switchMap,
    take,
} from 'rxjs';
import { DataService, PlaylistsService } from 'services';
import {
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
    private readonly snackBar = inject(MatSnackBar);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);
    private readonly translateService = inject(TranslateService);

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

    /** Info overlay component reference for manual triggering */
    readonly infoOverlay = viewChild(InfoOverlayComponent);

    /** Channel number input state */
    channelNumberInput = '';
    showChannelNumberOverlay = false;
    private channelNumberTimeout?: number;

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

        // Setup remote control channel change listener (Electron only)
        if (this.isDesktop && window.electron?.onChannelChange) {
            window.electron.onChannelChange(
                (data: { direction: 'up' | 'down' }) => {
                    this.handleRemoteChannelChange(data.direction);
                }
            );
        }

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
                                ChannelActions.setChannels({
                                    channels: playlist.playlist.items,
                                })
                            );

                            // Load favorites from the playlist
                            if (
                                playlist.favorites &&
                                playlist.favorites.length > 0
                            ) {
                                this.store.dispatch(
                                    FavoritesActions.setFavorites({
                                        channelIds: playlist.favorites,
                                    })
                                );
                            } else {
                                // Clear favorites if playlist has none
                                this.store.dispatch(
                                    FavoritesActions.setFavorites({
                                        channelIds: [],
                                    })
                                );
                            }

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
     * Handle remote control channel change
     */
    handleRemoteChannelChange(direction: 'up' | 'down'): void {
        console.log(`Remote control: changing channel ${direction}`);

        // Use combineLatest to get both values and take only the first emission
        combineLatest([this.channels$, this.activeChannel$])
            .pipe(
                filter(([channels, activeChannel]) => {
                    return channels.length > 0 && !!activeChannel;
                }),
                take(1),
                map(([channels, activeChannel]) => {
                    return {
                        channels,
                        activeChannel: activeChannel as Channel,
                    };
                })
            )
            .subscribe({
                next: ({ channels, activeChannel }) => {
                    // Find current channel index
                    const currentIndex = channels.findIndex(
                        (ch) => ch.url === activeChannel.url
                    );

                    if (currentIndex === -1) {
                        return;
                    }

                    // Calculate next/previous index with wraparound
                    let nextIndex: number;
                    if (direction === 'up') {
                        // Up = previous channel (decrease index)
                        nextIndex =
                            currentIndex - 1 < 0
                                ? channels.length - 1
                                : currentIndex - 1;
                    } else {
                        // Down = next channel (increase index)
                        nextIndex =
                            currentIndex + 1 >= channels.length
                                ? 0
                                : currentIndex + 1;
                    }

                    // Dispatch action to change channel
                    const nextChannel = channels[nextIndex];
                    this.store.dispatch(
                        ChannelActions.setActiveChannel({
                            channel: nextChannel,
                        })
                    );
                },
                error: (err) => {
                    console.error('Error changing channel:', err);
                },
            });
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

        // Pass the active channel's tvg.id for highlighting
        this.activeChannel$.pipe(take(1)).subscribe((channel) => {
            if (channel) {
                componentRef.instance.activeChannelId = (channel as Channel).tvg?.id || null;
            }
        });

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

    /**
     * Keyboard shortcut: Press 'I' to toggle EPG info overlay
     */
    @HostListener('document:keydown.i', ['$event'])
    handleInfoKeyPress(event: Event): void {
        // Don't trigger hotkeys when user is typing in input fields
        if (this.isTypingInInput(event)) {
            return;
        }
        // Prevent default behavior and show info overlay
        event.preventDefault();
        this.toggleInfoOverlay();
    }

    /**
     * Handle digit key presses for channel number input
     */
    @HostListener('document:keydown', ['$event'])
    handleKeyPress(event: KeyboardEvent): void {
        // Only handle digit keys (0-9)
        if (event.key >= '0' && event.key <= '9') {
            // Don't trigger hotkeys when user is typing in input fields
            if (this.isTypingInInput(event)) {
                return;
            }
            event.preventDefault();
            this.handleChannelNumberInput(event.key);
        }
    }

    /**
     * Toggles the EPG info overlay visibility
     * Called by 'I' keyboard shortcut or info button
     */
    toggleInfoOverlay(): void {
        const overlay = this.infoOverlay();
        if (overlay) {
            overlay.showOverlay();
        }
    }

    /**
     * Handle channel number input from keyboard
     * Debounces input to allow multi-digit channel numbers
     */
    handleChannelNumberInput(digit: string): void {
        // Clear existing timeout
        if (this.channelNumberTimeout) {
            clearTimeout(this.channelNumberTimeout);
        }

        // Add digit to current input
        this.channelNumberInput += digit;
        this.showChannelNumberOverlay = true;

        // Set timeout to switch channel after 2 seconds of no input
        this.channelNumberTimeout = window.setTimeout(() => {
            this.switchToChannelByNumber(parseInt(this.channelNumberInput, 10));
            this.clearChannelNumberInput();
        }, 2000);
    }

    /**
     * Switch to channel by number (1-based index)
     */
    switchToChannelByNumber(channelNumber: number): void {
        this.channels$
            .pipe(
                take(1),
                map((channels) => {
                    // Channel numbers are 1-based, array is 0-based
                    const channelIndex = channelNumber - 1;
                    if (channelIndex >= 0 && channelIndex < channels.length) {
                        return channels[channelIndex];
                    }
                    return null;
                })
            )
            .subscribe((channel) => {
                if (channel) {
                    this.store.dispatch(
                        ChannelActions.setActiveChannel({ channel })
                    );
                }
            });
    }

    /**
     * Clear channel number input and hide overlay
     */
    clearChannelNumberInput(): void {
        this.channelNumberInput = '';
        this.showChannelNumberOverlay = false;
        if (this.channelNumberTimeout) {
            clearTimeout(this.channelNumberTimeout);
            this.channelNumberTimeout = undefined;
        }
    }

    /**
     * Check if the user is currently typing in an input or textarea field
     * @param event Keyboard event
     * @returns true if the event target is an input or textarea element
     */
    private isTypingInInput(event: Event): boolean {
        const target = event.target;
        return (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
        );
    }

    /**
     * Get the MIME type for a stream URL based on its extension
     * @param url Stream URL
     * @returns MIME type string for Video.js
     */
    getMimeType(url: string): string {
        const extension = url.split(/[#?]/)[0].split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'ts':
                return 'video/mp2t';
            case 'm3u8':
                return 'application/x-mpegURL';
            case 'mp4':
                return 'video/mp4';
            case 'webm':
                return 'video/webm';
            case 'mkv':
                return 'video/x-matroska';
            case 'flv':
                return 'video/x-flv';
            default:
                return 'application/x-mpegURL';
        }
    }

    /**
     * Handle codec error from video players
     * Shows a snackbar suggesting to use VLC or MPV for unsupported codecs
     */
    handleCodecError(error: CodecError): void {
        console.log('handleCodecError received:', error);
        const codecName = error.codec || 'unknown';
        const isAudio = error.type === 'unsupported_audio';
        const codecType = isAudio ? 'audio' : 'video';

        // Show snackbar with helpful message
        const message = this.translateService.instant('PLAYER.UNSUPPORTED_CODEC', {
            codecType: codecType,
            codec: codecName
        }) || `Unsupported ${codecType} codec: ${codecName}. Use VLC or MPV for full codec support.`;

        const actionText = this.isDesktop
            ? this.translateService.instant('PLAYER.SWITCH_TO_VLC') || 'Switch to VLC'
            : this.translateService.instant('CLOSE') || 'Close';

        const snackBarRef = this.snackBar.open(message, actionText, {
            duration: 10000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['codec-error-snackbar']
        });

        // If on desktop, offer to switch to VLC
        if (this.isDesktop) {
            snackBarRef.onAction().subscribe(() => {
                // Update player setting to VLC
                this.settingsStore.updateSettings({ player: VideoPlayer.VLC });
            });
        }
    }
}
