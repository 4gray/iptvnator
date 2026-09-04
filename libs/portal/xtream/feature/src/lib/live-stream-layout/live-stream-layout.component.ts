import { NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    HostListener,
    TemplateRef,
    computed,
    effect,
    forwardRef,
    inject,
    OnDestroy,
    OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from '@iptvnator/ui/components';
import {
    GridListComponent,
    InfiniteScrollDirective,
    PortalEmptyStateComponent,
} from '@iptvnator/portal/shared/ui';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
    PortalChannelSortMode,
    getPortalChannelSortModeLabel,
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isTypingInInput,
    isWorkspaceLayoutRoute,
    LiveEpgPanelState,
    persistLiveEpgPanelState,
    persistPortalChannelSortMode,
    queryParamSignal,
    REMOTE_CONTROL_RESET_STATUS,
    restoreLiveEpgPanelState,
    restorePortalChannelSortMode,
} from '@iptvnator/portal/shared/util';
import {
    FavoriteItem,
    FavoritesService,
    findCurrentEpgItem,
    XtreamUrlService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgDateNavigationDirection,
    EpgListViewComponent,
    EpgProgramActivationEvent,
    EpgTimelineComponent,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
    FULLSCREEN_CHANNEL_PANEL,
    type FullscreenChannelPanelContext,
    type FullscreenChannelPanelHost,
    type PlaybackFallbackRequest,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';
import {
    buildXtreamEpgMappingKey,
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
    filterRecordingProgramsOverlap,
    playlistDisplayLabel,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    ResolvedPortalPlayback,
    toRecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';
import {
    PortalChannelsListComponent,
    type XtreamChannelListItem,
} from '../portal-channels-list/portal-channels-list.component';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import {
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { LiveStreamAutoOpenStateService } from './live-stream-auto-open-state.service';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

interface XtreamLiveChannelItem {
    readonly added?: string;
    readonly category_id?: string | number;
    readonly last_modified?: string;
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly tv_archive?: number | null;
    readonly tv_archive_duration?: number | string | null;
    readonly xtream_id: number;
}

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    providers: [
        LiveStreamAutoOpenStateService,
        // The fullscreen channel panel inside the player renders this
        // category's channel list (see the `fullscreenChannelPanel` template).
        {
            provide: FULLSCREEN_CHANNEL_PANEL,
            useExisting: forwardRef(() => LiveStreamLayoutComponent),
        },
    ],
    imports: [
        EpgListViewComponent,
        EpgTimelineComponent,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        NgTemplateOutlet,
        GridListComponent,
        InfiniteScrollDirective,
        PortalChannelsListComponent,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent
    implements OnInit, OnDestroy, FullscreenChannelPanelHost
{
    private readonly destroyRef = inject(DestroyRef);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly favoritesService = inject(FavoritesService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly xtreamUrlService = inject(XtreamUrlService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly liveSidebarStateService = inject(
        LiveLayoutSidebarStateService
    );
    private readonly liveAutoOpenState = inject(LiveStreamAutoOpenStateService);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly categoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly epgItems = this.xtreamStore.epgItems;
    readonly currentEpgItem = this.xtreamStore.currentEpgItem;
    readonly isSelectedTypeContentLoading =
        this.xtreamStore.selectedTypeContentLoading;
    readonly isLoadingEpg = this.xtreamStore.isLoadingEpg;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    readonly liveChannelSortMode = signal<PortalChannelSortMode>('server');

    private readonly fullscreenChannelPanelTemplate =
        viewChild<TemplateRef<FullscreenChannelPanelContext>>(
            'fullscreenChannelPanel'
        );
    /** FULLSCREEN_CHANNEL_PANEL: the current category's list, unless opted out. */
    readonly panelTemplate = computed(() =>
        this.settingsStore.fullscreenChannelPanel?.() === false
            ? null
            : (this.fullscreenChannelPanelTemplate() ?? null)
    );
    readonly panelTitle = computed(
        () => this.selectedCategoryInfo()?.name ?? ''
    );
    /**
     * The sidebar's rows, handed to the panel's list instance as an override
     * so that instance never re-applies the route category on init.
     */
    readonly fullscreenPanelChannels = computed(
        () =>
            this.xtreamStore.selectItemsFromSelectedCategory() as XtreamChannelListItem[]
    );
    readonly isElectron = this.runtime.isElectron;
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly routeSearchTerm = queryParamSignal(
        this.route,
        'q',
        (value) => (value ?? '').trim()
    );
    readonly workspaceSearchTerm = computed(() =>
        this.isWorkspaceLayout ? this.routeSearchTerm() : ''
    );
    readonly showLiveChannelSidebar = computed(
        () => !!this.selectedCategoryId() || !!this.workspaceSearchTerm()
    );
    private readonly pendingAutoOpenLiveItemId =
        this.liveAutoOpenState.pendingItemId;
    readonly selectedLiveItem = computed<XtreamLiveChannelItem | null>(() => {
        if (this.xtreamStore.selectedContentType() !== 'live') {
            return null;
        }

        const selectedItem = this.xtreamStore.selectedItem();
        if (!selectedItem || typeof selectedItem !== 'object') {
            return null;
        }

        const item = selectedItem as XtreamLiveChannelItem;
        return item.xtream_id ? item : null;
    });
    readonly controlledEpgPrograms = computed<EpgProgram[]>(() =>
        this.epgItems().map((program) => this.toControlledEpgProgram(program))
    );
    private readonly recordingsService = inject(RecordingsService);
    /** Channel/EPG snapshot for the embedded-MPV recording tracker. */
    readonly recordingMetadata = computed<RecordingStartMetadata | null>(() => {
        const item = this.selectedLiveItem();
        if (!item) {
            return null;
        }
        const playlist = this.xtreamStore.currentPlaylist();
        // Re-select against the 30 s tick: the store's `currentEpgItem`
        // caches its Date.now() verdict until epgItems changes, so a
        // recording started after an EPG boundary would snapshot the
        // previous show.
        const program = findCurrentEpgItem(
            this.epgItems(),
            epgProviderClockMs(this.currentTimeMs(), this.epgOffsetMinutes())
        );
        return {
            channelName: item.title?.trim() || item.name?.trim() || 'Live TV',
            channelLogoUrl:
                item.poster_url?.trim() ||
                item.stream_icon?.trim() ||
                undefined,
            playlistId: playlist?.id,
            playlistName:
                playlistDisplayLabel(playlist?.name ?? playlist?.title) ||
                undefined,
            sourceType: 'xtream',
            epgChannelId: playlist
                ? buildXtreamEpgMappingKey(playlist.id, item.xtream_id)
                : undefined,
            currentProgram: program
                ? toRecordingProgramSnapshot({
                      title: program.title,
                      description: program.description,
                      start: program.start,
                      stop: program.stop ?? program.end,
                  })
                : undefined,
        };
    });

    /** Stop enrichment: programs overlapping the recorded window. */
    onRecordingStopped(event: RecordingStoppedEvent): void {
        // A channel switch auto-stops the recording, and by now this host
        // already describes the new channel — enriching then would attach the
        // wrong schedule (and could promote an unrelated program to the
        // recording's title).
        if (
            event.epgChannelId &&
            event.epgChannelId !== this.recordingMetadata()?.epgChannelId
        ) {
            return;
        }
        const programs = filterRecordingProgramsOverlap(
            this.controlledEpgPrograms().map(toRecordingProgramSnapshot),
            event.startedAt,
            event.endedAt,
            this.epgOffsetMinutes()
        );
        if (programs.length === 0) {
            return;
        }
        void this.recordingsService.updatePrograms(event.targetPath, programs);
    }
    private readonly currentTimeMs = signal(Date.now());
    readonly activeCatchupProgram = signal<EpgProgram | null>(null);
    readonly controlledArchiveDays = computed(() =>
        Math.max(
            0,
            Number(this.selectedLiveItem()?.tv_archive_duration ?? 0) || 0
        )
    );
    readonly archivePlaybackAvailable = computed(() => {
        const selectedItem = this.selectedLiveItem();
        return (
            Number(selectedItem?.tv_archive ?? 0) === 1 &&
            this.controlledArchiveDays() > 0
        );
    });
    readonly hasPastPrograms = computed(() => {
        const now = this.currentTimeMs();
        return this.controlledEpgPrograms().some((program) => {
            const stop = this.getProgramTimestampMilliseconds(
                program.stop,
                program.stopTimestamp
            );
            return stop !== null && stop < now;
        });
    });
    readonly showArchiveUnavailableNotice = computed(
        () =>
            this.controlledEpgPrograms().length > 0 &&
            this.hasPastPrograms() &&
            !this.archivePlaybackAvailable()
    );
    readonly liveEpgPanelState = signal<LiveEpgPanelState>(
        restoreLiveEpgPanelState()
    );
    readonly selectedLiveEpgDate = signal(getTodayEpgDateKey());
    readonly isLiveEpgPanelCollapsed = computed(
        () => this.liveEpgPanelState() === 'collapsed'
    );
    /** Live EPG panel layout chosen in settings; hosts swap timeline ↔ list. */
    readonly epgViewMode = this.settingsStore.resolvedEpgViewMode;
    readonly epgOffsetMinutes = this.settingsStore.resolvedEpgOffsetMinutes;
    readonly isSidebarCollapsed = this.liveSidebarStateService.isCollapsed;
    readonly liveEpgPanelSummary = computed(() =>
        this.toLiveEpgPanelSummary(
            this.activeCatchupProgram() ?? this.currentEpgItem()
        )
    );
    readonly liveEpgPanelSummaryLabelKey = computed(() =>
        this.activeCatchupProgram()
            ? 'EPG.ARCHIVE_PLAYBACK'
            : 'EPG.CURRENT_PROGRAM'
    );
    readonly showReturnToLive = computed(
        () => this.activeCatchupProgram() !== null
    );
    readonly liveChannelSortLabel = computed(() =>
        getPortalChannelSortModeLabel(this.liveChannelSortMode())
    );
    readonly liveRootItems = computed(
        () =>
            this.xtreamStore.getPaginatedContent() as unknown as Record<
                string,
                unknown
            >[]
    );
    readonly liveRootItemCount = computed(
        () => this.xtreamStore.selectItemsFromSelectedCategory().length
    );
    readonly liveRootSubtitle = computed(() => {
        const count = this.liveRootItemCount();
        return `${count} ${count === 1 ? 'channel' : 'channels'}`;
    });
    readonly liveRootHasMore = this.xtreamStore.hasMoreContent;

    readonly selectedCategoryInfo = computed(() => {
        const categoryId = this.selectedCategoryId();
        if (!categoryId) return null;

        const categories = this.categories();
        const category = categories?.find(
            (c) => (c.category_id ?? c.id) === categoryId
        );
        const count = this.categoryItemCounts()?.get(categoryId) ?? 0;

        return {
            name: category?.category_name ?? category?.name ?? 'Channels',
            count,
        };
    });

    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private playbackRequestId = 0;

    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    readonly activePlayback = signal<ResolvedPortalPlayback | null>(null);
    private readonly activeLiveItemId = signal<number | null>(null);
    readonly playbackSessionKey = computed(() => {
        const sourceId = this.xtreamStore.currentPlaylist()?.id;
        const contentId = this.activeLiveItemId();
        return sourceId && contentId
            ? createPlaybackSessionKey({ kind: 'live', sourceId, contentId })
            : '';
    });
    readonly activeStreamUrl = computed(
        () => this.activePlayback()?.streamUrl ?? ''
    );
    favorites = new Map<number, boolean>();

    constructor() {
        effect((onCleanup) => {
            const intervalId = window.setInterval(() => {
                this.currentTimeMs.set(Date.now());
            }, 30_000);

            onCleanup(() => clearInterval(intervalId));
        });

        // Read pending auto-open state on every NavigationEnd — covers both the
        // initial navigation (Angular fires NavigationEnd after component creation)
        // and re-navigation to the same /live route when the component is reused.
        this.router.events
            .pipe(
                filter((e) => e instanceof NavigationEnd),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => this.liveAutoOpenState.captureFromHistoryState());

        effect(() => {
            const pendingId = this.pendingAutoOpenLiveItemId();
            if (!pendingId) {
                return;
            }

            // Guard: only process once the live content view is active; otherwise
            // the effect may fire while selectedContentType is still 'vod' and
            // incorrectly conclude the channel isn't found.
            if (this.xtreamStore.selectedContentType() !== 'live') {
                return;
            }

            // Search across all live streams, not just the category-filtered view,
            // so a channel from a different category can still be auto-opened.
            const allChannels = this.getAllLiveStreams();
            if (!Array.isArray(allChannels) || allChannels.length === 0) {
                return;
            }

            const item = allChannels.find(
                (channel) => Number(channel?.xtream_id) === pendingId
            );
            if (!item) {
                this.pendingAutoOpenLiveItemId.set(null);
                return;
            }

            this.playLive(item);
            // Ensure selectedItem is set so EPG loading and remote-control
            // status reflect the channel (constructStreamUrl also does this
            // internally, but an explicit call makes the intent clear and
            // keeps the auto-open path testable in isolation).
            this.xtreamStore.setSelectedItem(
                item as unknown as Record<string, unknown>
            );
            this.liveAutoOpenState.clearPendingItem();
            this.liveAutoOpenState.clearHistoryState();
        });

        effect(() => {
            const remoteControl = this.remoteControlBridge;
            if (!remoteControl?.updateRemoteControlStatus) {
                return;
            }

            const selectedContentType = this.xtreamStore.selectedContentType();
            const selectedItem = this.xtreamStore.selectedItem();
            const channels = this.getVisibleChannels();
            const activeProgram =
                this.activeCatchupProgram() ?? this.currentEpgItem();

            if (selectedContentType !== 'live' || !selectedItem?.xtream_id) {
                remoteControl.updateRemoteControlStatus({
                    portal: 'xtream',
                    isLiveView: false,
                    supportsVolume: false,
                });
                return;
            }

            const currentIndex = channels.findIndex(
                (item) =>
                    Number(item.xtream_id) === Number(selectedItem.xtream_id)
            );

            remoteControl.updateRemoteControlStatus({
                portal: 'xtream',
                isLiveView: true,
                channelName: selectedItem.title ?? selectedItem.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: activeProgram?.title,
                epgStart: activeProgram?.start,
                epgEnd: this.getProgramStop(activeProgram),
                supportsVolume: false,
            });
        });
    }

    ngOnInit() {
        const remoteControl = this.remoteControlBridge;
        if (remoteControl?.onChannelChange) {
            const unsubscribe = remoteControl.onChannelChange(
                (data: { direction: 'up' | 'down' }) => {
                    this.handleRemoteChannelChange(data.direction);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteChannelChange = unsubscribe;
            }
        }
        if (remoteControl?.onRemoteControlCommand) {
            const unsubscribe = remoteControl.onRemoteControlCommand(
                (command) => {
                    this.handleRemoteControlCommand(command);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteCommand = unsubscribe;
            }
        }

        this.liveChannelSortMode.set(
            restorePortalChannelSortMode(LIVE_CHANNEL_SORT_STORAGE_KEY)
        );

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: FavoriteItem) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }
    }

    playLive(
        item: XtreamLiveChannelItem,
        startPlayback = !this.settingsStore.openStreamOnDoubleClick()
    ) {
        this.playbackRequestId += 1;
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.activeCatchupProgram.set(null);
        // Keep both root/recently-added playback and same-category replays in
        // sync with the category rail. For already-selected channels this is a
        // store no-op.
        this.selectLiveItemCategory(item);
        this.activeLiveItemId.set(item.xtream_id);
        this.activePlayback.set({
            streamUrl,
            title: item.title ?? item.name ?? '',
            thumbnail: item.poster_url ?? item.stream_icon ?? null,
            isLive: true,
        });
        if (this.usesEmbeddedPlayer() || !startPlayback) {
            return;
        }
        this.xtreamStore.openPlayer(
            streamUrl,
            item.title ?? item.name ?? '',
            item.poster_url ?? item.stream_icon ?? null
        );
    }

    async onProgramActivated(event: EpgProgramActivationEvent): Promise<void> {
        const selectedItem = this.selectedLiveItem();
        if (!selectedItem?.xtream_id) {
            return;
        }

        if (event.type === 'live') {
            this.playLive(selectedItem, true);
            return;
        }

        await this.playCatchup(event.program, selectedItem);
    }

    setLiveChannelSortMode(mode: PortalChannelSortMode): void {
        this.liveChannelSortMode.set(mode);
        persistPortalChannelSortMode(LIVE_CHANNEL_SORT_STORAGE_KEY, mode);
    }

    onLiveRootLoadMore(): void {
        this.xtreamStore.loadMoreContent();
    }

    onLiveRootItemClick(item: unknown): void {
        this.playLive(item as XtreamLiveChannelItem);
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
    }

    toggleSidebar(): void {
        this.liveSidebarStateService.toggle();
    }

    @HostListener('document:keydown', ['$event'])
    handleSidebarShortcut(event: KeyboardEvent): void {
        if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'b' &&
            !isTypingInInput(event) &&
            // Behind the workspace's phone context drawer the route content
            // is inert; this document-level listener still fires, so it
            // opts out itself instead of toggling an obscured sidebar.
            !this.hostElement.nativeElement.closest('[inert]')
        ) {
            event.preventDefault();
            this.toggleSidebar();
        }
    }

    onLiveEpgDateNavigation(direction: EpgDateNavigationDirection): void {
        this.selectedLiveEpgDate.set(
            shiftEpgDateKey(this.selectedLiveEpgDate(), direction)
        );
    }

    onLiveEpgSelectedDateChange(selectedDate: string): void {
        this.selectedLiveEpgDate.set(selectedDate);
    }

    returnToLivePlayback(): void {
        const selectedItem = this.selectedLiveItem();
        if (!selectedItem?.xtream_id) {
            return;
        }

        this.playLive(selectedItem, true);
    }

    ngOnDestroy(): void {
        this.playbackRequestId += 1;
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
        // Leaving the live view would otherwise keep the last channel
        // advertised as live on the remote forever.
        this.remoteControlBridge?.updateRemoteControlStatus?.(
            REMOTE_CONTROL_RESET_STATUS
        );
    }

    private handleRemoteChannelChange(direction: 'up' | 'down'): void {
        const activeItem = this.xtreamStore.selectedItem();
        if (!activeItem?.xtream_id) {
            return;
        }

        const channels = this.getVisibleChannels();
        const nextItem = getAdjacentChannelItem(
            channels,
            activeItem.xtream_id,
            direction,
            (item) => item.xtream_id
        );

        if (!nextItem) {
            return;
        }

        this.playLive(nextItem, true);
    }

    private handleRemoteControlCommand(command: {
        type:
            | 'channel-select-number'
            | 'volume-up'
            | 'volume-down'
            | 'volume-toggle-mute';
        number?: number;
    }): void {
        if (command.type !== 'channel-select-number' || !command.number) {
            return;
        }

        const channels = this.getVisibleChannels();
        const channel = getChannelItemByNumber(channels, command.number);
        if (!channel) {
            return;
        }

        this.playLive(channel, true);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void launch;
    }

    private getAllLiveStreams(): XtreamLiveChannelItem[] {
        return this.xtreamStore.liveStreams() as unknown as XtreamLiveChannelItem[];
    }

    private getVisibleChannels(): XtreamLiveChannelItem[] {
        return this.xtreamStore.selectItemsFromSelectedCategory() as XtreamLiveChannelItem[];
    }

    private selectLiveItemCategory(item: XtreamLiveChannelItem): void {
        const categoryId = Number(item.category_id);
        if (Number.isFinite(categoryId) && categoryId > 0) {
            this.xtreamStore.setSelectedCategory(categoryId);
        }
    }

    private async playCatchup(
        program: EpgProgram,
        item: XtreamLiveChannelItem
    ): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        const startTimestamp = this.getProgramTimestampSeconds(
            program.start,
            program.startTimestamp
        );
        const stopTimestamp = this.getProgramTimestampSeconds(
            program.stop,
            program.stopTimestamp
        );

        if (!startTimestamp || !stopTimestamp) {
            return;
        }

        const requestId = ++this.playbackRequestId;
        this.activeLiveItemId.set(item.xtream_id);
        const catchupUrl = await this.xtreamUrlService.resolveCatchupUrl(
            playlist.id,
            {
                allowedOutputFormats: playlist.allowedOutputFormats,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            },
            item.xtream_id,
            startTimestamp,
            stopTimestamp,
            playlist.serverTimezone
        );
        if (
            requestId !== this.playbackRequestId ||
            this.xtreamStore.currentPlaylist()?.id !== playlist.id ||
            this.activeLiveItemId() !== item.xtream_id
        ) {
            return;
        }

        this.activeCatchupProgram.set(program);
        this.activePlayback.set({
            streamUrl: catchupUrl,
            title: this.getCatchupPlaybackTitle(item, program),
            thumbnail: item.poster_url ?? item.stream_icon ?? null,
            isLive: false,
        });
        if (this.usesEmbeddedPlayer()) {
            return;
        }

        this.xtreamStore.openPlayer(
            catchupUrl,
            this.getCatchupPlaybackTitle(item, program),
            item.poster_url ?? item.stream_icon ?? null
        );
    }

    private toControlledEpgProgram(program: EpgItem): EpgProgram {
        return {
            start: program.start,
            stop: program.stop ?? program.end,
            channel: program.channel_id ?? program.id,
            title: program.title,
            desc: program.description ?? null,
            category: null,
            startTimestamp: this.getProgramTimestampSeconds(
                program.start,
                program.start_timestamp
            ),
            stopTimestamp: this.getProgramTimestampSeconds(
                program.stop ?? program.end,
                program.stop_timestamp
            ),
        };
    }

    private toLiveEpgPanelSummary(
        program: EpgItem | EpgProgram | null | undefined
    ): LiveEpgPanelSummary | null {
        if (!program) {
            return null;
        }

        return {
            title: program.title,
            start: program.start,
            stop: this.getProgramStop(program),
        };
    }

    private getProgramStop(
        program: EpgItem | EpgProgram | null | undefined
    ): string | undefined {
        if (!program) {
            return undefined;
        }

        return (
            program.stop ??
            ('end' in program ? (program.end ?? undefined) : undefined)
        );
    }

    private get remoteControlBridge(): Window['electron'] | undefined {
        return this.runtime.supportsRemoteControl ? window.electron : undefined;
    }

    private getProgramTimestampSeconds(
        dateValue: string,
        unixTimestampValue?: number | string | null
    ): number | null {
        const unixTimestamp = Number.parseInt(
            String(unixTimestampValue ?? ''),
            10
        );
        if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
            return unixTimestamp;
        }

        const parsedDate = Date.parse(dateValue);
        return Number.isFinite(parsedDate)
            ? Math.floor(parsedDate / 1000)
            : null;
    }

    private getProgramTimestampMilliseconds(
        dateValue: string,
        unixTimestampValue?: number | string | null
    ): number | null {
        const unixTimestamp = this.getProgramTimestampSeconds(
            dateValue,
            unixTimestampValue
        );
        return unixTimestamp !== null ? unixTimestamp * 1000 : null;
    }

    private getCatchupPlaybackTitle(
        item: XtreamLiveChannelItem,
        program: EpgProgram
    ): string {
        const channelTitle = item.title ?? item.name ?? '';
        if (!program.title) {
            return channelTitle;
        }

        return channelTitle
            ? `${channelTitle} - ${program.title}`
            : program.title;
    }
}
