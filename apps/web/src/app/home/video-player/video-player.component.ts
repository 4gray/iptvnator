import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import {
    Component,
    HostListener,
    Injector,
    OnDestroy,
    OnInit,
    effect,
    inject,
    viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import {
    ArtPlayerComponent,
    AudioPlayerComponent,
    COMPONENT_OVERLAY_REF,
    EpgListComponent,
    HtmlVideoPlayerComponent,
    InfoOverlayComponent,
    MultiEpgContainerComponent,
    ResizableDirective,
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
    Subscription,
    combineLatest,
    combineLatestWith,
    filter,
    map,
    startWith,
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
import {
    getAdjacentChannelItem,
    getChannelItemByNumber,
} from '../../shared/services/remote-channel-navigation.util';
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
        ResizableDirective,
        RouterLink,
        SidebarComponent,
        ToolbarComponent,
        VjsPlayerComponent,
    ],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
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
    readonly activeChannel$ = this.store.select(selectActive);

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
    readonly isWorkspaceLayout =
        this.activatedRoute.snapshot.data['layout'] === 'workspace';

    sidebarView: SidebarView = 'CHANNELS';

    /** EPG overlay reference */
    private overlayRef!: OverlayRef;
    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private statusSubscription?: Subscription;
    private lastKnownVolume = 1;

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
            const unsubscribe = window.electron.onChannelChange((data: {
                direction: 'up' | 'down';
            }) => {
                this.handleRemoteChannelChange(data.direction);
            });
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteChannelChange = unsubscribe;
            }
        }
        if (this.isDesktop && window.electron?.onRemoteControlCommand) {
            const unsubscribe = window.electron.onRemoteControlCommand(
                (command) => {
                    this.handleRemoteControlCommand(command);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteCommand = unsubscribe;
            }
        }

        this.channels$ = this.activatedRoute.params.pipe(
            combineLatestWith(this.activatedRoute.queryParams),
            switchMap(([params, queryParams]) => {
                if (params['id']) {
                    this.store.dispatch(ChannelActions.resetActiveChannel());
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

        this.statusSubscription = combineLatest([
            this.channels$,
            this.activeChannel$,
            this.epgProgram$.pipe(startWith(null)),
        ]).subscribe(([channels, activeChannel, epgProgram]) => {
            if (!window.electron?.updateRemoteControlStatus || !activeChannel) {
                return;
            }

            const currentIndex = channels.findIndex(
                (channel) => channel.url === activeChannel.url
            );

            window.electron.updateRemoteControlStatus({
                portal: 'm3u',
                isLiveView: true,
                channelName:
                    activeChannel.name ??
                    activeChannel.tvg?.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: (epgProgram as any)?.title,
                epgStart: (epgProgram as any)?.start,
                epgEnd: (epgProgram as any)?.end,
                supportsVolume: true,
                volume: this.volume,
                muted: this.volume === 0,
            });
        });
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
                    const nextChannel = getAdjacentChannelItem(
                        channels,
                        activeChannel.url,
                        direction,
                        (channel) => channel.url
                    );

                    if (!nextChannel) {
                        return;
                    }

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

    ngOnDestroy(): void {
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
        this.statusSubscription?.unsubscribe();
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
            width: '1200px',
            maxWidth: '96vw',
            maxHeight: '92vh',
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
                map((channels) => getChannelItemByNumber(channels, channelNumber))
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

    private handleRemoteControlCommand(command: {
        type:
            | 'channel-select-number'
            | 'volume-up'
            | 'volume-down'
            | 'volume-toggle-mute';
        number?: number;
    }): void {
        if (command.type === 'channel-select-number' && command.number) {
            this.switchToChannelByNumber(command.number);
            return;
        }

        if (command.type === 'volume-up') {
            this.setVolume(this.volume + 0.1);
        } else if (command.type === 'volume-down') {
            this.setVolume(this.volume - 0.1);
        } else if (command.type === 'volume-toggle-mute') {
            if (this.volume === 0) {
                this.setVolume(this.lastKnownVolume || 1);
            } else {
                this.lastKnownVolume = this.volume;
                this.setVolume(0);
            }
        }
    }

    private setVolume(next: number): void {
        const clamped = Math.max(0, Math.min(1, Number(next.toFixed(2))));
        this.volume = clamped;
        if (clamped > 0) {
            this.lastKnownVolume = clamped;
        }
        localStorage.setItem('volume', String(clamped));

        if (window.electron?.updateRemoteControlStatus) {
            window.electron.updateRemoteControlStatus({
                portal: 'm3u',
                isLiveView: true,
                supportsVolume: true,
                volume: this.volume,
                muted: this.volume === 0,
            });
        }
    }
}
