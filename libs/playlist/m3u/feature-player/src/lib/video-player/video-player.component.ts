import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import {
    Component,
    HostListener,
    Injector,
    OnDestroy,
    OnInit,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from 'components';
import { isM3uCatchupPlaybackSupported } from 'm3u-utils';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    COMPONENT_OVERLAY_REF,
    EpgDateNavigationDirection,
    EpgListComponent,
    getTodayEpgDateKey,
    MultiEpgContainerComponent,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import {
    ChannelActions,
    PlaylistActions,
    selectActive,
    selectActivePlaybackUrl,
    selectChannels,
    selectChannelsLoading,
    selectCurrentEpgProgram,
} from 'm3u-state';
import {
    firstValueFrom,
    Observable,
    Subscription,
    combineLatest,
    filter,
    map,
    startWith,
    take,
} from 'rxjs';
import {
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isTypingInInput,
    isWorkspaceLayoutRoute,
    LiveEpgPanelState,
    LiveSidebarState,
    persistLiveEpgPanelState,
    persistLiveSidebarState,
    PORTAL_EXTERNAL_PLAYBACK,
    restoreLiveEpgPanelState,
    restoreLiveSidebarState,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    ArtPlayerComponent,
    AudioPlayerComponent,
    HtmlVideoPlayerComponent,
    SidebarComponent,
    VjsPlayerComponent,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { LiveEpgPanelComponent, LiveEpgPanelSummary } from 'shared-portals';
import { ChannelListLoadingStateComponent } from 'components';
import { DataService, PlaylistsService, SettingsStore } from 'services';
import {
    Channel,
    EpgProgram,
    ExternalPlayerSession,
    PLAYLIST_PARSE_BY_URL,
    M3uRecentlyViewedItem,
    PlaylistMeta,
    ResolvedPortalPlayback,
    STORE_KEY,
    Settings,
    VideoPlayer,
} from 'shared-interfaces';
import { createM3uChannelPlaybackRequest } from './m3u-channel-playback-actions';

const M3U_MULTI_EPG_HEADER_ACTION_ID = 'm3u-multi-epg';
const M3U_SIDEBAR_STORAGE_KEY = 'm3u-sidebar-width';
const M3U_GROUPS_SIDEBAR_STORAGE_KEY = 'm3u-groups-sidebar-width';
const M3U_SIDEBAR_MIN_WIDTH = 200;
const M3U_SIDEBAR_MAX_WIDTH = 600;
const M3U_SIDEBAR_DEFAULT_WIDTH = 460;

@Component({
    selector: 'app-video-player',
    imports: [
        ArtPlayerComponent,
        AsyncPipe,
        AudioPlayerComponent,
        ChannelListLoadingStateComponent,
        CommonModule,
        EpgListComponent,
        HtmlVideoPlayerComponent,
        LiveEpgPanelComponent,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        PortalEmptyStateComponent,
        ResizableDirective,
        SidebarComponent,
        TranslatePipe,
        VjsPlayerComponent,
        WebPlayerViewComponent,
    ],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly overlay = inject(Overlay);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly router = inject(Router);
    private readonly settingsStore = inject(SettingsStore);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly workspaceHeaderContext = inject(
        WorkspaceHeaderContextService
    );

    /** Active selected channel */
    readonly activeChannel = this.store.selectSignal(selectActive);
    readonly activePlaybackUrl = this.store.selectSignal(
        selectActivePlaybackUrl
    );
    readonly activePlaylistId = this.playlistContext.resolvedPlaylistId;
    readonly channels = this.store.selectSignal(selectChannels);
    readonly channelsLoading = this.store.selectSignal(selectChannelsLoading);
    readonly archivePlaybackAvailable = computed(() =>
        isM3uCatchupPlaybackSupported(this.activeChannel())
    );
    readonly playbackChannel = computed<Channel | null>(() => {
        const activeChannel = this.activeChannel();
        if (!activeChannel) {
            return null;
        }

        const playbackUrl = this.activePlaybackUrl();
        if (!playbackUrl) {
            return activeChannel;
        }

        return {
            ...activeChannel,
            url: playbackUrl,
            epgParams: '',
        } as Channel;
    });
    readonly embeddedPlayback = computed<ResolvedPortalPlayback | null>(() => {
        const activeChannel = this.activeChannel();
        const playbackTarget = this.playbackChannel();

        if (!activeChannel || !playbackTarget) {
            return null;
        }

        const headers: Record<string, string> = {};
        if (playbackTarget.http['user-agent']) {
            headers['User-Agent'] = playbackTarget.http['user-agent'];
        }
        if (playbackTarget.http.referrer) {
            headers['Referer'] = playbackTarget.http.referrer;
        }
        if (playbackTarget.http.origin) {
            headers['Origin'] = playbackTarget.http.origin;
        }

        return {
            streamUrl: `${playbackTarget.url}${playbackTarget.epgParams ?? ''}`,
            title:
                activeChannel.name?.trim() ||
                activeChannel.tvg?.name ||
                playbackTarget.url,
            thumbnail: activeChannel.tvg?.logo ?? null,
            isLive: true,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            userAgent: playbackTarget.http['user-agent'] || undefined,
            referer: playbackTarget.http.referrer || undefined,
            origin: playbackTarget.http.origin || undefined,
        };
    });
    readonly sidebarStorageKey = computed(() =>
        this.activeView() === 'groups'
            ? M3U_GROUPS_SIDEBAR_STORAGE_KEY
            : M3U_SIDEBAR_STORAGE_KEY
    );
    readonly sidebarWidth = signal(M3U_SIDEBAR_DEFAULT_WIDTH);
    readonly sidebarMinWidth = M3U_SIDEBAR_MIN_WIDTH;
    readonly sidebarMaxWidth = M3U_SIDEBAR_MAX_WIDTH;
    readonly liveEpgPanelState = signal<LiveEpgPanelState>(
        restoreLiveEpgPanelState()
    );
    readonly selectedLiveEpgDate = signal(getTodayEpgDateKey());
    readonly isLiveEpgPanelCollapsed = computed(
        () => this.liveEpgPanelState() === 'collapsed'
    );
    readonly liveSidebarState = signal<LiveSidebarState>(
        restoreLiveSidebarState()
    );
    readonly isSidebarCollapsed = computed(
        () => this.liveSidebarState() === 'collapsed'
    );

    /** Channels list */
    readonly channels$: Observable<Channel[]> = this.store.select(
        selectChannels
    ) as Observable<Channel[]>;

    /** Current epg program */
    readonly epgProgram = this.store.selectSignal(selectCurrentEpgProgram);
    readonly liveEpgPanelSummary = computed(() =>
        this.toLiveEpgPanelSummary(this.epgProgram())
    );

    /** Active M3U view (all, groups, favorites, recent) */
    readonly activeView = toSignal(
        this.activatedRoute.params.pipe(
            map((params) => params['view'] || 'all')
        ),
        { initialValue: 'all' }
    );

    /** Selected video player options */
    playerSettings: Partial<Settings> = {
        player: VideoPlayer.VideoJs,
        showCaptions: false,
    };

    readonly isDesktop = !!window['electron'];
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.activatedRoute);

    /** EPG overlay reference */
    private overlayRef!: OverlayRef;
    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private statusSubscription?: Subscription;
    private lastKnownVolume = 1;
    private lastRecordedRecentKey = '';
    private lastExternalSessionStateKey = this.getExternalSessionStateKey(
        this.externalPlayback.activeSession()
    );

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

        effect(() => {
            this.sidebarWidth.set(
                this.loadSidebarWidth(this.sidebarStorageKey())
            );
        });

        effect(() => {
            const playlistId = this.activePlaylistId();
            const activeChannel = this.activeChannel();

            if (!playlistId || !activeChannel?.url) {
                return;
            }

            const nextKey = `${playlistId}::${activeChannel.url}`;
            if (this.lastRecordedRecentKey === nextKey) {
                return;
            }

            this.lastRecordedRecentKey = nextKey;
            void this.persistRecentlyViewedChannel(playlistId, activeChannel);
        });

        effect(() => {
            const currentView = this.activeView();
            const channels = this.channels();
            const activeChannel = this.activeChannel();
            const state =
                this.router.currentNavigation()?.extras?.state ??
                window.history.state;
            const targetUrl =
                typeof state?.openRecentChannelUrl === 'string'
                    ? state.openRecentChannelUrl.trim()
                    : '';

            if (
                currentView !== 'recent' ||
                !targetUrl ||
                channels.length === 0
            ) {
                return;
            }

            if (activeChannel?.url === targetUrl) {
                this.clearConsumedRecentChannelState();
                return;
            }

            const matchedChannel = channels.find(
                (channel) => channel.url === targetUrl
            );
            if (!matchedChannel) {
                return;
            }

            this.store.dispatch(
                ChannelActions.setActiveChannel({ channel: matchedChannel })
            );
            this.clearConsumedRecentChannelState();
        });

        effect(() => {
            const player = this.settingsStore.player();
            const session = this.externalPlayback.activeSession();
            const activeChannel = this.activeChannel();
            const sessionStateKey = this.getExternalSessionStateKey(session);

            if (sessionStateKey === this.lastExternalSessionStateKey) {
                return;
            }

            this.lastExternalSessionStateKey = sessionStateKey;

            if (
                !activeChannel ||
                !this.isExternalPlayer(player) ||
                !this.isTerminalExternalSession(session)
            ) {
                return;
            }

            this.store.dispatch(ChannelActions.resetActiveChannel());
        });
    }

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.applySettings();
        this.getPlaylistUrlAsParam();
        this.registerHeaderShortcut();

        // Setup remote control channel change listener (Electron only)
        if (this.isDesktop && window.electron?.onChannelChange) {
            const unsubscribe = window.electron.onChannelChange(
                (data: { direction: 'up' | 'down' }) => {
                    this.handleRemoteChannelChange(data.direction);
                }
            );
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

        this.statusSubscription = combineLatest([
            this.channels$,
            this.store.select(selectActive),
            this.store.select(selectCurrentEpgProgram).pipe(startWith(null)),
        ]).subscribe(([channels, activeChannel, epgProgram]) => {
            if (!window.electron?.updateRemoteControlStatus || !activeChannel) {
                return;
            }

            const currentEpgProgram = epgProgram as
                | EpgProgram
                | null
                | undefined;
            const currentIndex = channels.findIndex(
                (channel) => channel.url === activeChannel.url
            );

            window.electron.updateRemoteControlStatus({
                portal: 'm3u',
                isLiveView: true,
                channelName: activeChannel.name ?? activeChannel.tvg?.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: currentEpgProgram?.title,
                epgStart: currentEpgProgram?.start,
                epgEnd: currentEpgProgram?.stop,
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
        combineLatest([this.channels$, this.store.select(selectActive)])
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
                        createM3uChannelPlaybackRequest(nextChannel)
                    );
                },
                error: (err) => {
                    console.error('Error changing channel:', err);
                },
            });
    }

    ngOnDestroy(): void {
        this.workspaceHeaderContext.clearAction(M3U_MULTI_EPG_HEADER_ACTION_ID);
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
        this.statusSubscription?.unsubscribe();
    }

    onSidebarWidthChange(width: number): void {
        this.sidebarWidth.set(this.clampSidebarWidth(width));
    }

    onSidebarResizeEnd(width: number): void {
        this.persistSidebarWidth(this.sidebarStorageKey(), width);
    }

    onGroupedSidebarWidthRequested(width: number): void {
        this.sidebarWidth.set(this.clampSidebarWidth(width));
    }

    onGroupedSidebarWidthRequestEnded(width: number): void {
        this.persistSidebarWidth(this.sidebarStorageKey(), width);
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
    }

    toggleSidebar(): void {
        const next: LiveSidebarState = this.isSidebarCollapsed()
            ? 'expanded'
            : 'collapsed';
        this.liveSidebarState.set(next);
        persistLiveSidebarState(next);
    }

    onLiveEpgDateNavigation(direction: EpgDateNavigationDirection): void {
        this.selectedLiveEpgDate.set(
            shiftEpgDateKey(this.selectedLiveEpgDate(), direction)
        );
    }

    onLiveEpgSelectedDateChange(selectedDate: string): void {
        this.selectedLiveEpgDate.set(selectedDate);
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

    private loadSidebarWidth(storageKey: string): number {
        const fallbackKey =
            storageKey === M3U_GROUPS_SIDEBAR_STORAGE_KEY
                ? M3U_SIDEBAR_STORAGE_KEY
                : '';
        const storedWidth = Number.parseInt(
            localStorage.getItem(storageKey) ??
                (fallbackKey ? localStorage.getItem(fallbackKey) : '') ??
                '',
            10
        );

        return this.clampSidebarWidth(
            Number.isNaN(storedWidth) ? M3U_SIDEBAR_DEFAULT_WIDTH : storedWidth
        );
    }

    private persistSidebarWidth(storageKey: string, width: number): void {
        const clampedWidth = this.clampSidebarWidth(width);
        this.sidebarWidth.set(clampedWidth);
        localStorage.setItem(storageKey, clampedWidth.toString());
    }

    private clampSidebarWidth(width: number): number {
        return Math.max(
            M3U_SIDEBAR_MIN_WIDTH,
            Math.min(M3U_SIDEBAR_MAX_WIDTH, width)
        );
    }

    private async persistRecentlyViewedChannel(
        playlistId: string,
        channel: Channel
    ): Promise<void> {
        const recentlyViewedItem: M3uRecentlyViewedItem = {
            source: 'm3u',
            id: channel.url,
            url: channel.url,
            title: channel.name?.trim() || channel.tvg?.name || channel.url,
            channel_id: channel.id,
            poster_url: channel.tvg?.logo || undefined,
            tvg_id: channel.tvg?.id || undefined,
            tvg_name: channel.tvg?.name || undefined,
            group_title: channel.group?.title || undefined,
            category_id: 'live',
            added_at: new Date().toISOString(),
        };

        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.addM3uRecentlyViewed(
                playlistId,
                recentlyViewedItem
            )
        );

        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: playlistId,
                    recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                } as PlaylistMeta,
            })
        );
    }

    private clearConsumedRecentChannelState(): void {
        const historyState = (window.history.state ?? {}) as Record<
            string,
            unknown
        >;
        if (!historyState['openRecentChannelUrl']) {
            return;
        }

        try {
            const nextState = { ...historyState };
            delete nextState['openRecentChannelUrl'];
            window.history.replaceState(nextState, document.title);
        } catch {
            // no-op
        }
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
        const currentChannel = this.activeChannel();
        if (currentChannel) {
            componentRef.instance.activeChannelId =
                currentChannel.tvg?.id || null;
        }

        this.overlayRef.backdropClick().subscribe(() => {
            this.overlayRef.dispose();
        });
    }

    @HostListener('document:keydown', ['$event'])
    handleKeyPress(event: KeyboardEvent): void {
        if (isTypingInInput(event)) {
            return;
        }
        if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'b'
        ) {
            event.preventDefault();
            this.toggleSidebar();
            return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        // Only handle digit keys (0-9)
        if (event.key >= '0' && event.key <= '9') {
            event.preventDefault();
            this.handleChannelNumberInput(event.key);
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
                map((channels) =>
                    getChannelItemByNumber(channels, channelNumber)
                )
            )
            .subscribe((channel) => {
                if (channel) {
                    this.store.dispatch(
                        createM3uChannelPlaybackRequest(channel)
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

    shouldShowInlinePlayer(channel: Channel | null | undefined): boolean {
        if (!channel) {
            return false;
        }

        return !this.isExternalPlayer(this.playerSettings.player);
    }

    private toLiveEpgPanelSummary(
        program: EpgProgram | null | undefined
    ): LiveEpgPanelSummary | null {
        if (!program) {
            return null;
        }

        return {
            title: program.title,
            start: program.start,
            stop: program.stop,
        };
    }

    private getExternalSessionStateKey(
        session: ExternalPlayerSession | null | undefined
    ): string | null {
        if (!session) {
            return null;
        }

        return `${session.id}:${session.status}`;
    }

    private isExternalPlayer(
        player: VideoPlayer | null | undefined
    ): player is VideoPlayer.MPV | VideoPlayer.VLC {
        return player === VideoPlayer.MPV || player === VideoPlayer.VLC;
    }

    private isTerminalExternalSession(
        session: ExternalPlayerSession | null | undefined
    ): boolean {
        return session?.status === 'closed' || session?.status === 'error';
    }

    private registerHeaderShortcut(): void {
        if (!this.isWorkspaceLayout) {
            return;
        }

        this.workspaceHeaderContext.setAction({
            id: M3U_MULTI_EPG_HEADER_ACTION_ID,
            icon: 'view_list',
            tooltipKey: 'TOP_MENU.OPEN_MULTI_EPG',
            ariaLabelKey: 'TOP_MENU.OPEN_MULTI_EPG',
            palette: {
                labelKey: 'TOP_MENU.OPEN_MULTI_EPG',
                descriptionKey:
                    'WORKSPACE.SHELL.COMMANDS.OPEN_MULTI_EPG_DESCRIPTION',
                keywords: ['epg', 'guide', 'schedule'],
                priority: 10,
            },
            run: () => this.openMultiEpgView(),
        });
    }
}
