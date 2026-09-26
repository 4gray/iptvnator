import {
    activateXtreamArchiveAction,
    getProgramTimestampSeconds,
} from './xtream-live-archive-actions';
import { EpgArchiveDownloadService } from '@iptvnator/ui/epg';
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
    untracked,
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
    ChannelListHiddenStateComponent,
    PortalEmptyStateComponent,
} from '@iptvnator/portal/shared/ui';
import {
    createLivePanelsController,
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
    EpgArchiveCopyService,
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
    DatabaseService,
    ParentalLockService,
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { LiveStreamAutoOpenStateService } from './live-stream-auto-open-state.service';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

import {
    XtreamLiveChannelNavigationService,
    type XtreamLiveChannelItem,
} from './xtream-live-channel-navigation.service';

const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    providers: [
        LiveStreamAutoOpenStateService,
        XtreamLiveChannelNavigationService,
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
        ChannelListHiddenStateComponent,
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
    readonly archiveContextKey = computed(() =>
        JSON.stringify([
            this.xtreamStore.currentPlaylist()?.id,
            this.xtreamStore.currentPlaylist()?.serverUrl,
            this.selectedLiveItem()?.xtream_id,
        ])
    );
    private readonly archiveDownloads = inject(EpgArchiveDownloadService);
    readonly archiveDownloadsAvailable = computed(
        () => this.runtime.supportsDownloads && this.archivePlaybackAvailable()
    );
    private readonly archiveCopy = inject(EpgArchiveCopyService);
    private readonly xtreamUrlService = inject(XtreamUrlService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly databaseService = inject(DatabaseService);
    private readonly liveAutoOpenState = inject(LiveStreamAutoOpenStateService);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly categoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly epgItems = this.xtreamStore.epgItems;
    readonly currentEpgItem = this.xtreamStore.currentEpgItem;
    readonly isSelectedTypeContentLoading =
        this.xtreamStore.selectedTypeContentLoading;
    readonly isLoadingEpg = this.xtreamStore.isLoadingEpg;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    readonly channelNavigation = inject(XtreamLiveChannelNavigationService);
    readonly liveChannelSortMode = this.channelNavigation.sortMode;

    private readonly fullscreenChannelPanelTemplate = viewChild<
        TemplateRef<FullscreenChannelPanelContext>
    >('fullscreenChannelPanel');
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
    // `viewChild()` must be a direct field initializer for the compiler to
    // register the query, so the refs live here and feed the controller.
    private readonly showCategoriesButton = viewChild('showCategoriesButton', {
        read: ElementRef<HTMLElement>,
    });
    private readonly restoreButton = viewChild('restoreButton', {
        read: ElementRef<HTMLElement>,
    });
    // Nested panel levels, category dropdown bridge and focus handoff; the
    // template binds to it directly. Search-only rails (no selected
    // category) keep their plain heading.
    readonly livePanels = createLivePanelsController({
        surface: 'portal',
        hasSelectedCategory: computed(() => !!this.selectedCategoryId()),
        showCategoriesButton: this.showCategoriesButton,
        restoreButton: this.restoreButton,
    });
    readonly isSidebarCollapsed = this.livePanels.isSidebarCollapsed;
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
        // Provider categories carry string ids ("101") while the selection
        // is numeric; a strict comparison missed every one and the header
        // fell back to "Channels", which the category dropdown cannot afford.
        const category = categories?.find(
            (c) => String(c.category_id ?? c.id) === String(categoryId)
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
    private activePlaylistId: string | null = null;

    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    readonly activePlayback = signal<ResolvedPortalPlayback | null>(null);
    private readonly activeLiveItemId = signal<number | null>(null);
    /**
     * Provider category id of the playing channel, for the parental lock.
     * `null`: nothing playing (or no category); `'unknown'`: Electron has
     * not resolved it yet (or cannot) — a relock then stops the channel.
     */
    private activeLiveProviderCategoryId: number | null | 'unknown' = null;
    /** Bumped per resolution so a slow hidden-category lookup cannot land on a later playback. */
    private liveCategoryLookupGeneration = 0;
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
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id ?? null;
            if (this.activePlaylistId && this.activePlaylistId !== playlistId) {
                this.playbackRequestId += 1;
                this.activePlaylistId = null;
                this.activePlayback.set(null);
                this.activeLiveItemId.set(null);
                this.activeCatchupProgram.set(null);
            }
        });
        // A relock (idle timer, Lock now) must stop a channel playing from a
        // now-withheld category: the player is gated on `activePlayback`,
        // not on the store selection the enforcement service clears — and
        // that selection is also dropped by an ordinary category switch,
        // which must keep the channel playing.
        effect(() => {
            this.parentalLock.version();
            untracked(() => {
                const categoryId = this.activeLiveProviderCategoryId;
                const playlistId = this.xtreamStore.currentPlaylist()?.id;
                if (categoryId === null || !playlistId) {
                    return;
                }
                // Unresolved category: fail closed while the lock is active
                // rather than keep a possibly locked stream running.
                const withheld =
                    categoryId === 'unknown'
                        ? this.parentalLock.active()
                        : this.parentalLock.isXtreamCategoryLocked(
                              playlistId,
                              'live',
                              categoryId
                          );
                if (!withheld) {
                    return;
                }
                this.playbackRequestId += 1;
                this.activePlayback.set(null);
                this.activeLiveItemId.set(null);
                this.activeCatchupProgram.set(null);
                this.activeLiveProviderCategoryId = null;
            });
        });
        effect((onCleanup) => {
            const intervalId = window.setInterval(() => {
                this.currentTimeMs.set(Date.now());
            }, 30_000);

            onCleanup(() => clearInterval(intervalId));
        });

        // Read pending auto-open state once at mount and again on every
        // NavigationEnd. Arriving from another route (a collection's "open in
        // playlist", the dashboard, global search into another portal), the
        // Xtream shell mounts this layout only after its session bootstrap —
        // i.e. AFTER that navigation's NavigationEnd, which a subscription
        // made here can never observe; the history entry still carries the
        // keys, so the mount-time read is what serves those arrivals. The
        // NavigationEnd read covers re-navigation to the same /live route
        // while the component is reused (in-portal search, playlist switch).
        this.liveAutoOpenState.captureFromHistoryState();
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

            // The shared store may still serve the PREVIOUS playlist here:
            // NavigationEnd fires before the route session resets it. Stream
            // ids are provider-local, so a colliding id in that catalog would
            // otherwise play the wrong channel and consume the handoff. Wait
            // until the store is the requested playlist's — the effect
            // re-runs when the playlist, catalog or init flag changes.
            const pendingPlaylistId =
                this.liveAutoOpenState.pendingPlaylistId();
            if (
                pendingPlaylistId &&
                this.xtreamStore.currentPlaylist()?.id !== pendingPlaylistId
            ) {
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
                // "Not in the catalog" is a verdict only once this
                // playlist's catalog has finished loading.
                if (this.xtreamStore.isContentInitialized()) {
                    this.liveAutoOpenState.clearPendingItem();
                }
                return;
            }

            this.playLive(
                item,
                undefined,
                this.channelNavigation.channelsForAutoOpen(item)
            );
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
        startPlayback = !this.settingsStore.openStreamOnDoubleClick(),
        displayedChannels?: readonly XtreamLiveChannelItem[],
        remote = false
    ) {
        this.playbackRequestId += 1;
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.channelNavigation.capture(item, displayedChannels, remote);
        this.activeCatchupProgram.set(null);
        // Keep both root/recently-added playback and same-category replays in
        // sync with the category rail. For already-selected channels this is a
        // store no-op.
        if (!remote) this.selectLiveItemCategory(item);
        this.activeLiveItemId.set(item.xtream_id);
        this.activeLiveProviderCategoryId =
            this.resolveLiveProviderCategoryId(item);
        const playlist = this.xtreamStore.currentPlaylist();
        this.activePlaylistId = playlist?.id ?? null;
        this.activePlayback.set({
            streamUrl,
            liveAutoTsUrl: playlist
                ? this.xtreamUrlService.constructAutoLiveTsUrl(
                      playlist,
                      item.xtream_id
                  )
                : undefined,
            userAgent: playlist?.userAgent,
            referer: playlist?.referrer,
            origin: playlist?.origin,
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

        if (
            event.type === 'download-catchup' ||
            event.type === 'copy-catchup-url'
        ) {
            await activateXtreamArchiveAction(
                event,
                this.xtreamStore.currentPlaylist(),
                selectedItem,
                this.archiveDownloadsAvailable(),
                {
                    copy: this.archiveCopy,
                    downloads: this.archiveDownloads,
                    urls: this.xtreamUrlService,
                }
            );
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
        this.playLive(
            item as XtreamLiveChannelItem,
            undefined,
            this.liveRootItems() as unknown as XtreamLiveChannelItem[]
        );
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
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
            this.livePanels.toggleSidebar();
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

        this.playLive(nextItem, true, undefined, true);
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

        this.playLive(channel, true, undefined, true);
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
        return [...this.channelNavigation.remoteChannels()];
    }

    /**
     * The provider category id the parental lock is keyed by. Electron rows
     * carry the SQLite category row id in `category_id` and the provider id
     * on the category row (`xtream_id`); the PWA carries the provider id on
     * both. A row whose category is not in the list resolves to null rather
     * than to a guess that could collide with a locked provider id.
     */
    private resolveLiveProviderCategoryId(
        item: XtreamLiveChannelItem
    ): number | null | 'unknown' {
        // Every resolution retires the lookups before it, including one for
        // a same-id channel of another playlist that resolved synchronously.
        const generation = ++this.liveCategoryLookupGeneration;
        const categoryId = Number(item.category_id);
        if (!Number.isFinite(categoryId)) {
            return null;
        }
        if (!this.runtime.supportsXtreamSqliteDataSource) {
            return categoryId;
        }
        const category = (this.xtreamStore.liveCategories?.() ?? []).find(
            (candidate) =>
                Number((candidate as { id?: number }).id) === categoryId
        ) as { xtream_id?: number } | undefined;
        const providerId = Number(category?.xtream_id);
        if (Number.isFinite(providerId)) {
            return providerId;
        }
        // Not in the visible list — a hidden category (search can play its
        // channels). Resolve through the unfiltered rows; until that lands
        // the id is unknown and a relock stops the channel.
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (playlistId) {
            void this.databaseService
                .getAllXtreamCategories(playlistId, 'live')
                .then((rows) => {
                    if (
                        generation !== this.liveCategoryLookupGeneration ||
                        this.xtreamStore.currentPlaylist()?.id !== playlistId ||
                        this.activeLiveItemId() !== item.xtream_id
                    ) {
                        return;
                    }
                    const row = rows.find(
                        (candidate) => Number(candidate.id) === categoryId
                    );
                    const resolved = Number(row?.xtream_id);
                    if (Number.isFinite(resolved)) {
                        this.activeLiveProviderCategoryId = resolved;
                    }
                })
                .catch(() => undefined);
        }
        return 'unknown';
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

        const startTimestamp = getProgramTimestampSeconds(
            program.start,
            program.startTimestamp
        );
        const stopTimestamp = getProgramTimestampSeconds(
            program.stop,
            program.stopTimestamp
        );

        if (!startTimestamp || !stopTimestamp) {
            return;
        }

        const requestId = ++this.playbackRequestId;
        this.activeLiveItemId.set(item.xtream_id);
        this.activeLiveProviderCategoryId =
            this.resolveLiveProviderCategoryId(item);
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

        this.activePlaylistId = playlist.id;
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
            startTimestamp: getProgramTimestampSeconds(
                program.start,
                program.start_timestamp
            ),
            stopTimestamp: getProgramTimestampSeconds(
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

    private getProgramTimestampMilliseconds(
        dateValue: string,
        unixTimestampValue?: number | string | null
    ): number | null {
        const unixTimestamp = getProgramTimestampSeconds(
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
