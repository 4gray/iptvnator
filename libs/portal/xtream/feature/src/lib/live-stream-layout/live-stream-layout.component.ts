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
import {
    MenuItemRadioCheckDirective,
    MenuItemRadioDirective,
    ResizableDirective,
} from '@iptvnator/ui/components';
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
    getPortalChannelSortModeLabelKey,
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isTypingInInput,
    LiveEpgPanelState,
    persistLiveEpgPanelState,
    persistPortalChannelSortMode,
    queryParamSignal,
    REMOTE_CONTROL_RESET_STATUS,
    restoreLiveEpgPanelState,
    restorePortalChannelSortMode,
} from '@iptvnator/portal/shared/util';
import {
    findCurrentEpgItem,
    XtreamUrlService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideComponent,
    EpgGuideNowPlayingComponent,
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
    buildCatchupTimelineSegments,
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
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    PortalChannelsListComponent,
    type XtreamChannelListItem,
} from '../portal-channels-list/portal-channels-list.component';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import {
    EpgPreferencesService,
    DatabaseService,
    ParentalLockService,
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { LiveStreamAutoOpenStateService } from './live-stream-auto-open-state.service';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import { injectXtreamRecentHistory } from '../xtream-recent-history';

import {
    sameXtreamChannelCopy,
    XtreamLiveChannelNavigationService,
    type XtreamLiveChannelItem,
} from './xtream-live-channel-navigation.service';

import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import { XtreamLiveGuideService } from './xtream-live-guide.service';
import {
    isXtreamLiveCategoryWithheld,
    sameXtreamLiveOwner,
} from './xtream-external-live-sessions.service';
import { XtreamGuideExternalPlayback } from './xtream-guide-external-playback.service';
import { scheduleKey } from './xtream-guide-schedules';
import { retainXtreamPlayingSchedule } from './xtream-guide-now-playing';
import { XtreamTuneRequests } from './xtream-tune-requests.service';
import { toSharedEpgProgram } from '../portal-channels-list/epg-preview-program';

const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    host: { '(document:fullscreenchange)': 'guide.closeOnFullscreen()' },
    providers: [
        XtreamEpgGuideSourceService,
        XtreamLiveGuideService,
        XtreamGuideExternalPlayback,
        XtreamTuneRequests,
        { provide: EPG_GUIDE_SOURCE, useExisting: XtreamEpgGuideSourceService },
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
        EpgGuideComponent,
        EpgGuideNowPlayingComponent,
        EpgListViewComponent,
        EpgTimelineComponent,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MenuItemRadioCheckDirective,
        MenuItemRadioDirective,
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
    readonly guide = inject(XtreamLiveGuideService);
    private readonly guideSource = inject(XtreamEpgGuideSourceService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly recordRecentItem = injectXtreamRecentHistory();
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
    private readonly epgPreferences = inject(EpgPreferencesService);
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
    get supportsProviderEpg(): boolean {
        return (
            this.epgPreferences.enabled() && this.runtime.supportsProviderEpg
        );
    }
    readonly workspaceSearchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim()
    );
    readonly showLiveChannelSidebar = computed(
        () =>
            !!this.selectedCategoryId() ||
            !!this.workspaceSearchTerm() ||
            !!this.activeStreamUrl()
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
        this.epgItems().map(toSharedEpgProgram)
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
    /** The archive window's programmes as seek-bar segments; null live. */
    readonly catchupTimelineSegments = computed(() =>
        buildCatchupTimelineSegments(
            this.controlledEpgPrograms(),
            this.activeCatchupProgram()
        )
    );
    readonly controlledArchiveDays = computed(() =>
        Math.max(
            0,
            Number(this.selectedLiveItem()?.tv_archive_duration ?? 0) || 0
        )
    );
    readonly archivePlaybackAvailable = computed(() => {
        const selectedItem = this.selectedLiveItem();
        return (
            this.runtime.supportsProviderCatchUp &&
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
    private readonly categoryDropdownButton = viewChild('categoryDropdown', {
        read: ElementRef<HTMLElement>,
    });
    // The way back from the all-items view, which has no channels header.
    private readonly allItemsShowButton = viewChild('allItemsShowButton', {
        read: ElementRef<HTMLElement>,
    });
    private readonly restoreButton = viewChild('restoreButton', {
        read: ElementRef<HTMLElement>,
    });
    // Nested panel levels, category dropdown bridge and focus handoff; the
    // template binds to it directly.
    readonly livePanels = createLivePanelsController({
        surface: 'portal',
        showCategoriesButton: computed(
            () => this.showCategoriesButton() ?? this.allItemsShowButton()
        ),
        categoryDropdownButton: this.categoryDropdownButton,
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
        () =>
            this.activeCatchupProgram() !== null || !!this.archiveReturnSource()
    );
    readonly liveChannelSortLabelKey = computed(() =>
        getPortalChannelSortModeLabelKey(this.liveChannelSortMode())
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

        // A null name falls back to a translated label in the template.
        return {
            name: category?.category_name ?? category?.name ?? null,
            count,
        };
    });

    /** Count badge of the channels header; "All Items" has no category entry. */
    readonly sidebarItemCount = computed(
        () => this.selectedCategoryInfo()?.count ?? this.liveRootItemCount()
    );

    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private readonly tuneRequests = inject(XtreamTuneRequests);
    private readonly inlinePlayer =
        viewChild<WebPlayerViewComponent>('inlinePlayer');
    private activePlaylistId: string | null = null;
    private archivePreview?: {
        item: XtreamLiveChannelItem;
        queue: readonly XtreamLiveChannelItem[];
    };

    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    readonly activePlayback = signal<ResolvedPortalPlayback | null>(null);
    private readonly activeLiveItemId = signal<number | null>(null);
    private readonly activeGuideItem = signal<XtreamLiveChannelItem | null>(
        null
    );
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
    private readonly externalGuide = inject(XtreamGuideExternalPlayback);
    private readonly archiveReturnSource = computed(() => {
        if (this.usesEmbeddedPlayer()) return undefined;
        const opened = this.externalGuide.unverifiedPlayback()?.source;
        if (opened?.archive) return opened;
        const confirmed = this.externalGuide.confirmed();
        return confirmed?.archive ? confirmed.lockSource : undefined;
    });
    private readonly socketlessRemoteSource = computed(() => {
        const playback = this.externalGuide.unverifiedPlayback();
        return playback?.session.player === 'mpv' &&
            playback.session.mediaObservationUnavailable &&
            !this.externalGuide.confirmed()
            ? playback.source
            : undefined;
    });
    private readonly unverifiedRemoteSource = computed(() => {
        const playback = this.externalGuide.unverifiedPlayback();
        return playback && !this.externalGuide.confirmed()
            ? playback.source
            : undefined;
    });
    private readonly usesSelectionForRemote = computed(
        () =>
            this.usesEmbeddedPlayer() ||
            !this.externalGuide.hasSessionUpdates ||
            (this.settingsStore.player?.() === VideoPlayer.MPV &&
                /(?:^|[\\/])iina(?:-cli)?$/i.test(
                    this.settingsStore.mpvPlayerPath?.()?.trim() ?? ''
                ))
    );
    private readonly remoteLiveItem = computed(() =>
        this.usesSelectionForRemote()
            ? this.selectedLiveItem()
            : (this.externalGuide.confirmed()?.item ??
              this.socketlessRemoteSource()?.channel ??
              null)
    );
    private readonly remoteAnchor = computed(() => {
        if (this.usesSelectionForRemote()) return null;
        const item = (
            this.unverifiedRemoteSource() ??
            this.externalGuide.stoppedTuningSource()
        )?.channel;
        return item &&
            this.channelNavigation
                .remoteChannels()
                .some((channel) => sameXtreamChannelCopy(channel, item))
            ? item
            : null;
    });
    private readonly guideChannel = computed(() =>
        this.usesEmbeddedPlayer()
            ? this.activeGuideItem()
            : (this.externalGuide.confirmed()?.item ?? null)
    );
    private readonly guideArchiveProgram = computed(() =>
        this.usesEmbeddedPlayer()
            ? this.activeCatchupProgram()
            : (this.externalGuide.confirmed()?.archive ?? null)
    );
    readonly guideNowPlayingChannel = computed(
        () =>
            (this.usesEmbeddedPlayer()
                ? this.activePlayback()?.title
                : this.externalGuide.confirmed()?.session.title) ?? ''
    );
    private readonly playingSchedule = retainXtreamPlayingSchedule(() => {
        const playing = this.guideChannel();
        const refreshed = this.guideSource.playingItem();
        const matches =
            playing && refreshed && sameXtreamChannelCopy(playing, refreshed);
        const copy = matches ? refreshed : playing;
        const selected = this.selectedLiveItem();
        return {
            owner: this.externalGuide.owner(),
            key: copy ? `${copy.category_id}:${scheduleKey(copy)}` : undefined,
            revision: this.guideSource.revision(),
            guide: matches
                ? (this.guideSource.playingScheduleItems() ?? undefined)
                : undefined,
            panel:
                copy &&
                selected &&
                sameXtreamChannelCopy(copy, selected) &&
                scheduleKey(copy) === scheduleKey(selected) &&
                !this.isLoadingEpg()
                    ? this.epgItems()
                    : undefined,
        };
    });
    readonly guideNowPlayingProgram = computed(() => {
        const archive = this.guideArchiveProgram();
        if (archive) return archive;
        const now = epgProviderClockMs(
            this.currentTimeMs(),
            this.epgOffsetMinutes()
        );
        const program = findCurrentEpgItem(this.playingSchedule(), now);
        return program ? toSharedEpgProgram(program) : null;
    });

    constructor() {
        this.externalGuide.bind({
            enabled: () => !this.usesEmbeddedPlayer(),
            cancelPendingRequest: () => this.tuneRequests.invalidate(),
            dispatchGuard: () => this.tuneRequests.dispatchGuard(),
            current: this.activePlayback,
            currentItem: this.activeGuideItem,
            select: (item) => this.selectGuideLiveItem(item),
            capture: (item, queue) =>
                this.channelNavigation.capture(item, queue, 'replace'),
            restore: ({ item, archive, playback, lockSource }) => {
                this.activePlaylistId = lockSource.playlistId;
                this.activePlayback.set(playback);
                this.activeLiveItemId.set(item.xtream_id);
                this.activeCatchupProgram.set(archive);
                this.selectGuideLiveItem(item, lockSource.categoryId);
            },
        });
        effect(() => {
            if (this.usesEmbeddedPlayer()) return;
            const source =
                this.socketlessRemoteSource() ??
                this.unverifiedRemoteSource() ??
                (!this.externalGuide.confirmed()
                    ? (this.externalGuide.stoppedTuningSource() ??
                      this.externalGuide.remoteTuningSource())
                    : undefined);
            if (!source?.channel) return;
            const { channel, queue } = source;
            untracked(() =>
                this.channelNavigation.capture(
                    channel,
                    queue ?? [channel],
                    'replace'
                )
            );
        });
        this.guide.bind(
            computed(() =>
                this.usesEmbeddedPlayer()
                    ? !!this.activeStreamUrl()
                    : typeof window.electron?.closeExternalPlayerSession ===
                          'function' &&
                      (!!this.externalGuide.confirmed() ||
                          !!this.externalGuide.unverifiedPlayback() ||
                          (this.guide.isOpen() &&
                              (this.externalGuide.launching() ||
                                  !!this.externalGuide.stoppedTuningSource())))
            )
        );
        this.tuneRequests.bindGuide(this.guideSource, {
            usesInlinePlayer: this.usesEmbeddedPlayer,
            playingLiveChannel: () =>
                this.guideArchiveProgram() ? null : this.guideChannel(),
            category: (item) => this.readLiveProviderCategoryId(item),
            selectInlineCopy: (item) => {
                this.selectGuideLiveItem(item);
                this.channelNavigation.replacePlayingCopy(item);
            },
            clearPreview: () => {
                this.archivePreview = undefined;
            },
            confirmInline: (onConfirmed) => {
                this.retryInlinePlayback();
                this.confirmInlinePlayback(onConfirmed);
            },
            tune: (item, channels, onConfirmed) =>
                this.playLive(item, true, channels, false, onConfirmed),
        });
        effect(() =>
            this.guideSource.setPlayback(
                this.guideChannel(),
                this.guideArchiveProgram() === null
            )
        );
        effect(() => {
            const items = this.guideSource.activePlayingScheduleItems();
            if (!items) return;
            const playing = this.guideSource.playingItem();
            const selected = this.selectedLiveItem();
            if (playing && selected && sameXtreamChannelCopy(playing, selected))
                untracked(() => {
                    if (playing.epg_channel_id !== selected.epg_channel_id)
                        this.xtreamStore.setSelectedItem({
                            ...selected,
                            epg_channel_id: playing.epg_channel_id,
                        });
                    this.xtreamStore.setGuideSchedule(items);
                });
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id ?? null;
            if (this.activePlaylistId && this.activePlaylistId !== playlistId) {
                this.tuneRequests.invalidate();
                this.activePlaylistId = null;
                this.archivePreview = undefined;
                this.externalGuide.reset();
                this.activePlayback.set(null);
                this.activeLiveItemId.set(null);
                this.activeGuideItem.set(null);
                this.activeCatchupProgram.set(null);
                this.activeLiveProviderCategoryId = null;
                untracked(() => {
                    if (!this.usesEmbeddedPlayer())
                        this.externalGuide.restoreConfirmedPanel();
                });
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
                if (
                    !playlistId ||
                    !this.isLiveCategoryWithheld(playlistId, categoryId)
                )
                    return;
                this.tuneRequests.invalidate();
                if (
                    !this.usesEmbeddedPlayer() &&
                    this.externalGuide.restoreConfirmedPanel()
                )
                    return;
                this.activePlayback.set(null);
                this.activeLiveItemId.set(null);
                this.activeGuideItem.set(null);
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
            const selectedItem = this.remoteLiveItem();
            const channels = this.getVisibleChannels();
            const activeProgram =
                selectedItem && this.supportsProviderEpg
                    ? this.usesSelectionForRemote()
                        ? (this.activeCatchupProgram() ?? this.currentEpgItem())
                        : this.externalGuide.confirmed()
                          ? this.guideNowPlayingProgram()
                          : null
                    : null;

            if (
                selectedContentType !== 'live' ||
                !(
                    selectedItem ||
                    this.remoteAnchor() ||
                    this.externalGuide.remoteTuningSource()
                )
            ) {
                remoteControl.updateRemoteControlStatus({
                    portal: 'xtream',
                    isLiveView: false,
                    supportsVolume: false,
                });
                return;
            }

            const currentIndex = channels.findIndex(
                (item) =>
                    Number(item.xtream_id) === Number(selectedItem?.xtream_id)
            );

            remoteControl.updateRemoteControlStatus({
                portal: 'xtream',
                isLiveView: true,
                channelName: selectedItem?.title ?? selectedItem?.name,
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
    }

    playLive(
        item: XtreamLiveChannelItem,
        startPlayback = !this.settingsStore.openStreamOnDoubleClick(),
        displayedChannels?: readonly XtreamLiveChannelItem[],
        remote = false,
        onConfirmed?: () => void
    ): void {
        const request = this.tuneRequests.begin();
        const { owner } = request;
        if (
            startPlayback &&
            owner &&
            !this.usesEmbeddedPlayer() &&
            this.externalGuide.hasSessionUpdates
        ) {
            const category = this.readLiveProviderCategoryId(item);
            const keepPanel =
                (remote || this.guide.isOpen()) &&
                !!this.externalGuide.confirmed();
            const start = (resolved: typeof category) => {
                if (
                    !this.tuneRequests.isCurrent(request) ||
                    this.isLiveCategoryWithheld(owner.playlistId, resolved)
                )
                    return;
                this.applyLivePlayback(
                    item,
                    true,
                    displayedChannels,
                    remote,
                    resolved,
                    onConfirmed,
                    keepPanel
                );
            };
            if (category === 'unknown')
                void this.lookupLiveProviderCategoryId(
                    owner.playlistId,
                    item
                ).then(start);
            else start(category);
            return;
        }
        this.applyLivePlayback(
            item,
            startPlayback,
            displayedChannels,
            remote,
            undefined,
            onConfirmed
        );
    }

    private applyLivePlayback(
        item: XtreamLiveChannelItem,
        startPlayback: boolean,
        displayedChannels: readonly XtreamLiveChannelItem[] | undefined,
        remote: boolean,
        category?: number | null | 'unknown',
        onConfirmed?: () => void,
        keepPanel = false
    ): void {
        const streamUrl = keepPanel
            ? this.xtreamStore.constructStreamUrl(item, undefined, false)
            : this.guide.isOpen()
              ? this.xtreamStore.constructStreamUrl(item, (signal) =>
                    this.readGuideSchedule(item, signal)
                )
              : this.xtreamStore.constructStreamUrl(item);
        const tracksExternalPlayback =
            !this.usesEmbeddedPlayer() && this.externalGuide.hasSessionUpdates;
        const captureOnSelection = this.usesSelectionForRemote();
        const scope =
            displayedChannels ??
            (captureOnSelection || !remote
                ? this.channelNavigation.displayedChannels()
                : []);
        this.archivePreview =
            tracksExternalPlayback && !startPlayback
                ? { item, queue: scope }
                : undefined;
        const queuePolicy = remote
            ? displayedChannels
                ? 'replace'
                : 'preserve'
            : 'on-channel-change';
        if (captureOnSelection)
            this.channelNavigation.capture(item, scope, queuePolicy);
        const categoryId = this.resolveLiveProviderCategoryId(item, category);
        const playlist = this.xtreamStore.currentPlaylist();
        const playback: ResolvedPortalPlayback = {
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
        };
        if (!keepPanel) {
            this.activeCatchupProgram.set(null);
            if (!remote && !this.guide.isOpen())
                this.selectLiveItemCategory(item);
            this.activeLiveItemId.set(item.xtream_id);
            this.activeGuideItem.set(item);
            this.activeLiveProviderCategoryId = categoryId;
            this.activePlaylistId = playlist?.id ?? null;
            this.activePlayback.set(playback);
        }
        const launchId =
            tracksExternalPlayback &&
            this.externalGuide.owner() &&
            streamUrl &&
            startPlayback
                ? crypto.randomUUID()
                : undefined;
        if (startPlayback && streamUrl) {
            this.recordRecentItem(
                streamUrl,
                {
                    xtreamId: item.xtream_id,
                    contentType: 'live',
                    playedContent: {
                        title: item.title ?? item.name ?? '',
                        posterUrl: item.poster_url ?? item.stream_icon,
                        categoryId: item.category_id,
                        tmdbId: item.tmdb_id ?? undefined,
                        releaseYear: item.release_year ?? undefined,
                    },
                },
                this.usesEmbeddedPlayer()
                    ? this.playbackSessionKey()
                    : undefined,
                launchId
            );
        }
        if (this.usesEmbeddedPlayer()) {
            this.confirmInlinePlayback(onConfirmed);
            return;
        }
        if (!startPlayback) return;
        this.externalGuide.start(
            playback,
            item,
            null,
            categoryId,
            this.channelNavigation.queueFor(item, scope, queuePolicy),
            {
                remote,
                onConfirmed,
                launchId,
                replaceWith:
                    remote || this.guide.isOpen()
                        ? this.settingsStore.player?.()
                        : undefined,
            }
        );
    }

    private confirmInlinePlayback(callback?: () => void): void {
        const player = this.inlinePlayer();
        this.tuneRequests.confirmInlineWhenReady(
            callback,
            !!player &&
                player.playback() === this.activePlayback() &&
                player.hasStartedPlayback()
        );
    }

    private retryInlinePlayback(): boolean {
        const player = this.inlinePlayer();
        return (
            !!player &&
            player.playback() === this.activePlayback() &&
            player.retryFailedPlayback()
        );
    }

    onInlinePlaybackStarted(playback: ResolvedPortalPlayback): void {
        if (playback === this.activePlayback())
            this.tuneRequests.confirmInline();
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
        this.guide.handleKey(event);
        if (event.defaultPrevented || this.guide.isOpen()) return;

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
        const source = this.archiveReturnSource();
        const item =
            source?.channel ??
            (this.activeCatchupProgram() && this.activeGuideItem()) ??
            this.selectedLiveItem();
        if (item?.xtream_id) this.playLive(item, true, source?.queue, !!source);
    }

    ngOnDestroy(): void {
        this.tuneRequests.invalidate();
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
        // Leaving the live view would otherwise keep the last channel
        // advertised as live on the remote forever.
        this.remoteControlBridge?.updateRemoteControlStatus?.(
            REMOTE_CONTROL_RESET_STATUS
        );
    }

    private handleRemoteChannelChange(direction: 'up' | 'down'): void {
        const selectionBased = this.usesSelectionForRemote();
        const tuning = selectionBased
            ? undefined
            : this.externalGuide.remoteTuningSource()?.channel;
        const anchor = this.remoteAnchor();
        const activeItem = tuning ?? this.remoteLiveItem() ?? anchor;
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

        const socketless = this.usesEmbeddedPlayer()
            ? undefined
            : this.socketlessRemoteSource();
        const archive = socketless
            ? socketless.archive
            : selectionBased
              ? this.activeCatchupProgram()
              : this.guideArchiveProgram();
        if (!nextItem) return;
        if (nextItem.xtream_id === activeItem.xtream_id) {
            if (tuning) return;
            if (!archive && !anchor) {
                if (!this.usesEmbeddedPlayer()) return;
                const playback = this.activePlayback();
                if (
                    playback?.isLive &&
                    this.activeLiveItemId() === nextItem.xtream_id
                ) {
                    if (this.retryInlinePlayback())
                        this.tuneRequests.invalidate();
                    return;
                }
            }
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

        const playing = this.usesSelectionForRemote()
            ? null
            : this.externalGuide.confirmed();
        if (
            playing?.item.xtream_id === channel.xtream_id &&
            !playing.archive &&
            !playing.session.playbackUnverified &&
            !this.externalGuide.isStopping()
        ) {
            this.tuneRequests.invalidate();
            const cancelled = this.externalGuide.cancelPendingSwitch(channel);
            if (cancelled)
                this.tuneRequests.afterCancellation(
                    cancelled,
                    channel.xtream_id,
                    () => this.playLive(channel, true, undefined, true)
                );
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

    private isLiveCategoryWithheld(
        playlistId: string,
        categoryId: number | null | 'unknown'
    ): boolean {
        return isXtreamLiveCategoryWithheld(this.parentalLock, {
            playlistId,
            categoryId,
        });
    }

    /**
     * The provider category id the parental lock is keyed by. Electron rows
     * carry the SQLite category row id in `category_id` and the provider id
     * on the category row (`xtream_id`); the PWA carries the provider id on
     * both. A row whose category is not in the list resolves to null rather
     * than to a guess that could collide with a locked provider id.
     */
    private readLiveProviderCategoryId(
        item: XtreamLiveChannelItem
    ): number | null | 'unknown' {
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
        return Number.isFinite(providerId) ? providerId : 'unknown';
    }

    private resolveLiveProviderCategoryId(
        item: XtreamLiveChannelItem,
        resolved?: number | null | 'unknown'
    ): number | null | 'unknown' {
        // Every resolution retires lookups from the previous selection.
        const generation = ++this.liveCategoryLookupGeneration;
        if (resolved !== undefined) return resolved;
        const providerId = this.readLiveProviderCategoryId(item);
        if (providerId !== 'unknown') return providerId;
        // Not in the visible list — a hidden category (search can play its
        // channels). Resolve through the unfiltered rows; until that lands
        // the id is unknown and a relock stops the channel.
        const owner = this.externalGuide.owner();
        if (owner) {
            void this.lookupLiveProviderCategoryId(owner.playlistId, item).then(
                (resolved) => {
                    if (
                        resolved === 'unknown' ||
                        generation !== this.liveCategoryLookupGeneration ||
                        !sameXtreamLiveOwner(
                            owner,
                            this.externalGuide.owner()
                        ) ||
                        this.activeLiveItemId() !== item.xtream_id
                    ) {
                        return;
                    }
                    this.activeLiveProviderCategoryId = resolved;
                    this.externalGuide.resolveCategory(
                        this.activeStreamUrl(),
                        item,
                        resolved
                    );
                }
            );
        }
        return 'unknown';
    }

    private async lookupLiveProviderCategoryId(
        playlistId: string,
        item: XtreamLiveChannelItem
    ): Promise<number | 'unknown'> {
        try {
            const rows = await this.databaseService.getAllXtreamCategories(
                playlistId,
                'live'
            );
            const categoryId = Number(item.category_id);
            const resolved = Number(
                rows.find((row) => Number(row.id) === categoryId)?.xtream_id
            );
            return Number.isFinite(resolved) ? resolved : 'unknown';
        } catch {
            return 'unknown';
        }
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

        const request = this.tuneRequests.begin();
        const preview = this.archivePreview;
        const fromPreview =
            preview &&
            this.activePlaylistId === playlist.id &&
            sameXtreamChannelCopy(preview.item, item);
        const queue = this.channelNavigation.queueFor(
            item,
            fromPreview
                ? preview.queue
                : this.channelNavigation.displayedChannels(),
            fromPreview ? 'replace' : 'on-channel-change'
        );
        const category = this.readLiveProviderCategoryId(item);
        const resolved =
            category === 'unknown'
                ? await this.lookupLiveProviderCategoryId(playlist.id, item)
                : category;
        if (
            !this.tuneRequests.isCurrent(request) ||
            this.isLiveCategoryWithheld(playlist.id, resolved)
        )
            return;
        const catchupUrl = await this.xtreamUrlService.resolveCatchupUrl(
            playlist.id,
            {
                allowedOutputFormats: playlist.allowedOutputFormats,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
                userAgent: playlist.userAgent?.trim() || undefined,
            },
            item.xtream_id,
            startTimestamp,
            stopTimestamp,
            playlist.serverTimezone
        );
        if (
            !this.tuneRequests.isCurrent(request) ||
            this.isLiveCategoryWithheld(playlist.id, resolved)
        ) {
            return;
        }

        const playback: ResolvedPortalPlayback = {
            streamUrl: catchupUrl,
            title: this.getCatchupPlaybackTitle(item, program),
            thumbnail: item.poster_url ?? item.stream_icon ?? null,
            isLive: false,
        };
        const inline = this.usesEmbeddedPlayer();
        if (this.usesSelectionForRemote()) {
            this.activeLiveItemId.set(item.xtream_id);
            this.activeLiveProviderCategoryId =
                this.resolveLiveProviderCategoryId(item, resolved);
            this.activePlaylistId = playlist.id;
            this.activeGuideItem.set(item);
            this.activeCatchupProgram.set(program);
            this.activePlayback.set(playback);
        }
        if (inline) return;

        this.externalGuide.start(playback, item, program, resolved, queue, {
            replaceWith: this.guide.isOpen()
                ? this.settingsStore.player?.()
                : undefined,
        });
    }

    private selectGuideLiveItem(
        item: XtreamLiveChannelItem,
        category?: number | null | 'unknown'
    ): void {
        this.activeLiveProviderCategoryId = this.resolveLiveProviderCategoryId(
            item,
            category
        );
        this.activeGuideItem.set(item);
        this.xtreamStore.setSelectedItem({ ...item });
        void this.xtreamStore.loadEpg((signal) =>
            this.readGuideSchedule(item, signal)
        );
    }

    private async readGuideSchedule(
        item: XtreamLiveChannelItem,
        signal: AbortSignal
    ) {
        const schedule = await this.guideSource.playbackSchedule(item, signal);
        return this.destroyRef.destroyed ? [] : schedule;
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
