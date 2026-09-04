import { NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    HostListener,
    computed,
    effect,
    ElementRef,
    inject,
    linkedSignal,
    OnDestroy,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    ChannelListItemComponent,
    ChannelListSkeletonComponent,
    EpgMappingDialogComponent,
    ResizableDirective,
} from '@iptvnator/ui/components';
import {
    PlaylistsService,
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    buildStalkerEpgMappingKey,
    Channel,
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
    filterRecordingProgramsOverlap,
    playlistDisplayLabel,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    ResolvedPortalPlayback,
    StalkerPortalItem,
    toRecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';
import {
    EpgDateNavigationDirection,
    EpgListViewComponent,
    EpgTimelineComponent,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import {
    AudioPlayerComponent,
    ElectronStreamHeadersService,
    type PlaybackFallbackRequest,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
    createLogger,
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isTypingInInput,
    LiveEpgPanelState,
    persistLiveEpgPanelState,
    REMOTE_CONTROL_RESET_STATUS,
    restoreLiveEpgPanelState,
} from '@iptvnator/portal/shared/util';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    ACTIVE_EPG_FALLBACK_SIZE,
    StalkerFavoriteItem,
    StalkerItvChannel,
    StalkerStore,
    normalizeStalkerEntityId,
} from '@iptvnator/portal/stalker/data-access';
import { StalkerItvAllItemsComponent } from './stalker-itv-all-items.component';
import {
    previewFetchSize,
    StalkerEpgPreviewQueue,
    mergeEpgProgramLists,
} from './stalker-live-epg-preview';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

type StalkerPlayableChannel = StalkerPortalItem & {
    cmd?: string;
    has_files?: unknown;
};

interface StalkerActiveLivePlaybackIdentity {
    readonly sourceId: string;
    readonly contentId: string;
}

interface StalkerPlaybackResolutionOwner {
    readonly sourceId: string;
    readonly contentType: string;
    readonly channelId: string;
}

/** Channels rendered per "page" when the full list is served from the cache. */
const FULL_LIST_RENDER_CHUNK = 100;

@Component({
    selector: 'app-stalker-live-stream-layout',
    templateUrl: './stalker-live-stream-layout.component.html',
    styleUrls: ['./stalker-live-stream-layout.component.scss'],
    imports: [
        AudioPlayerComponent,
        ChannelListItemComponent,
        ChannelListSkeletonComponent,
        EpgListViewComponent,
        EpgTimelineComponent,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        NgTemplateOutlet,
        PortalEmptyStateComponent,
        ResizableDirective,
        StalkerItvAllItemsComponent,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerLiveStreamLayoutComponent implements OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    private readonly playlistService = inject(PlaylistsService);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly dialog = inject(MatDialog);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly streamHeaders = inject(ElectronStreamHeadersService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly liveSidebarStateService = inject(
        LiveLayoutSidebarStateService
    );
    private readonly logger = createLogger('StalkerLiveStream');
    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;

    /** Channels */
    readonly isRadioMode = computed(
        () => this.stalkerStore.selectedContentType() === 'radio'
    );
    readonly itvChannels = this.stalkerStore.itvChannels;
    readonly radioChannels = this.stalkerStore.radioChannels;
    readonly channels = computed(() =>
        this.isRadioMode() ? this.radioChannels() : this.itvChannels()
    );
    readonly searchTerm = computed(() =>
        this.stalkerStore.searchPhrase().trim().toLowerCase()
    );
    /** Full-list mode: the complete channel list is cached, so search covers everything. */
    readonly isFullListMode = computed(
        () => !this.isRadioMode() && this.stalkerStore.itvFullListActive()
    );
    /**
     * True when the CURRENT category is actually served from the cache.
     * Censored (adult) genres are excluded from `get_all_channels` on most
     * portals, so they stay on the legacy paged flow (portal pagination,
     * infinite scroll) even while the full-list cache is active.
     */
    readonly isCategoryFromCache = computed(
        () =>
            !this.isRadioMode() &&
            this.stalkerStore.itvSelectedCategoryFromCache()
    );
    /**
     * Channels matching the search phrase. Without a term, the current
     * category. With a term in full-list mode, the WHOLE portal's channel list
     * (every category) so search behaves like "search all channels" — merged
     * with the currently loaded channels, because a censored (adult) category
     * is paged from the portal and its channels are intentionally absent from
     * the full-list cache. Otherwise the loaded channels of the current
     * category.
     */
    readonly filteredChannels = computed(() => {
        const term = this.searchTerm();
        if (!term) {
            return this.channels();
        }

        let source = this.channels();
        if (this.isFullListMode()) {
            const merged = new Map<string, StalkerItvChannel>();
            for (const channel of source) {
                merged.set(normalizeStalkerEntityId(channel.id), channel);
            }
            for (const channel of this.stalkerStore.itvFullChannelList()) {
                const id = normalizeStalkerEntityId(channel.id);
                if (!merged.has(id)) {
                    merged.set(id, channel);
                }
            }
            source = [...merged.values()];
        }

        return source.filter((item) =>
            `${item.o_name ?? ''} ${item.name ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });
    readonly isFullListLoading = computed(
        () => !this.isRadioMode() && this.stalkerStore.itvFullListLoading()
    );
    readonly fullListProgress = this.stalkerStore.itvFullListProgress;
    readonly itvFullChannelList = this.stalkerStore.itvFullChannelList;
    /**
     * All-channels grid in the main area when no category is selected yet
     * (Xtream "All Items" parity). Falls back to the "select a category"
     * placeholder on portals without a usable full list.
     */
    readonly showItvAllItems = computed(
        () =>
            !this.isRadioMode() &&
            !this.stalkerStore.selectedCategoryId() &&
            (this.stalkerStore.itvFullListActive() ||
                this.stalkerStore.itvFullListLoading())
    );
    /** Windowed render limit keeps the DOM bounded for multi-thousand channel lists. */
    private readonly renderLimit = linkedSignal({
        source: () => ({
            term: this.searchTerm(),
            category: this.stalkerStore.selectedCategoryId(),
            contentType: this.stalkerStore.selectedContentType(),
        }),
        computation: () => FULL_LIST_RENDER_CHUNK,
    });
    readonly visibleChannels = computed(() =>
        this.isCategoryFromCache()
            ? this.filteredChannels().slice(0, this.renderLimit())
            : this.filteredChannels()
    );
    readonly totalChannelCount = computed(() => this.filteredChannels().length);
    readonly hasMoreItems = computed(() =>
        this.isCategoryFromCache()
            ? this.visibleChannels().length < this.filteredChannels().length
            : this.stalkerStore.hasMoreChannels()
    );
    readonly isLoadingMore = signal(false);
    /**
     * Skeleton shows only while a load is genuinely in flight. An empty result
     * once loading has settled is an empty category, not a stuck spinner — the
     * full-list cache can legitimately filter a genre down to zero channels.
     */
    readonly isInitialChannelsLoading = computed(
        () =>
            !!this.stalkerStore.selectedCategoryId() &&
            this.channels().length === 0 &&
            !this.searchTerm() &&
            (this.isFullListLoading() ||
                this.stalkerStore.isPaginatedContentLoading())
    );
    /** Category is loaded but has no channels (and the user isn't searching). */
    readonly isCategoryEmpty = computed(
        () =>
            !!this.stalkerStore.selectedCategoryId() &&
            !this.searchTerm() &&
            this.channels().length === 0 &&
            !this.isInitialChannelsLoading()
    );

    readonly selectedChannelId = this.stalkerStore.selectedItvId;
    protected readonly normalizeStalkerEntityId = normalizeStalkerEntityId;

    /** Context menu (Map EPG) */
    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');
    readonly contextMenuChannel = signal<StalkerItvChannel | null>(null);
    readonly contextMenuPosition = signal({ x: '0px', y: '0px' });
    readonly isElectron = this.runtime.isElectron;
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly supportsEpgMapping = this.runtime.supportsEpgMapping;
    readonly openStreamOnDoubleClick = computed(() =>
        this.settingsStore.openStreamOnDoubleClick()
    );

    /** Player */
    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    readonly activePlayback = signal<ResolvedPortalPlayback | null>(null);
    private readonly activePlaybackIdentity =
        signal<StalkerActiveLivePlaybackIdentity | null>(null);
    readonly playbackSessionKey = computed(() => {
        const identity = this.activePlaybackIdentity();
        return identity
            ? createPlaybackSessionKey({ kind: 'live', ...identity })
            : '';
    });
    readonly streamUrl = computed(() => this.activePlayback()?.streamUrl ?? '');
    readonly activePlaybackTitle = computed(
        () =>
            this.activePlayback()?.title ||
            this.stalkerStore.selectedItem()?.o_name ||
            this.stalkerStore.selectedItem()?.name ||
            ''
    );
    readonly activePlaybackArtwork = computed(
        () =>
            this.activePlayback()?.thumbnail ||
            this.stalkerStore.selectedItem()?.logo ||
            this.stalkerStore.selectedItem()?.cover ||
            ''
    );

    /** EPG */
    /** Short-EPG panel fallback, tagged with the channel it was fetched for. */
    readonly fallbackEpgPrograms = signal<{
        channelId: string;
        programs: EpgProgram[];
    } | null>(null);
    readonly isLoadingFallbackEpg = signal(false);
    // Merged, not either/or: some portals' bulk get_epg_info carries only
    // future programmes, so a non-empty bulk list can still miss the one
    // airing now — the short-EPG fallback fills exactly that gap. The merge
    // is scoped to the fallback's own channel: a channel switch moves the
    // selection synchronously while the old fallback is only replaced once
    // the new channel's EPG load runs, and an unscoped merge would mix the
    // previous channel's programmes into the new panel meanwhile.
    readonly activeEpgPrograms = computed(() => {
        const fallback = this.fallbackEpgPrograms();
        const selectedId = this.selectedChannelId();
        const fallbackPrograms =
            fallback &&
            selectedId &&
            fallback.channelId === normalizeStalkerEntityId(selectedId)
                ? fallback.programs
                : [];
        return mergeEpgProgramLists(
            this.stalkerStore.selectedItvEpgPrograms(),
            fallbackPrograms
        );
    });
    /**
     * 30 s clock read by `currentProgram`: `findCurrentProgram` compares
     * against Date.now(), which a computed would otherwise cache — a
     * recording started after an EPG boundary (or the panel summary and
     * external-player metadata reading this) would keep the previous show.
     */
    private readonly epgClockTick = signal(0);
    private epgClockTimer: ReturnType<typeof setInterval> | null = null;
    readonly currentProgram = computed(() => {
        this.epgClockTick();
        return this.findCurrentProgram(this.activeEpgPrograms());
    });
    private readonly recordingsService = inject(RecordingsService);
    /** Channel/EPG snapshot for the embedded-MPV recording tracker. */
    readonly recordingMetadata = computed<RecordingStartMetadata | null>(() => {
        const selectedItem = this.stalkerStore.selectedItem();
        if (!selectedItem?.id) {
            return null;
        }
        const playlist = this.stalkerStore.currentPlaylist();
        const selectedType = this.stalkerStore.selectedContentType();
        // ITV only: the bulk EPG cache is ITV-keyed and Ministra reuses small
        // integer ids across itv/radio, so a radio recording gets no program.
        const program =
            selectedType === 'itv' ? (this.currentProgram() ?? null) : null;
        return {
            channelName:
                selectedItem.o_name?.trim() ||
                selectedItem.name?.trim() ||
                'Live TV',
            channelLogoUrl: this.activePlaybackArtwork() || undefined,
            playlistId: playlist?._id,
            playlistName: playlistDisplayLabel(playlist?.title) || undefined,
            sourceType: 'stalker',
            epgChannelId: playlist?._id
                ? buildStalkerEpgMappingKey(
                      playlist._id,
                      String(selectedItem.id)
                  )
                : undefined,
            currentProgram: program
                ? toRecordingProgramSnapshot(program)
                : undefined,
        };
    });

    /** Stop enrichment: programs overlapping the recorded window. */
    onRecordingStopped(event: RecordingStoppedEvent): void {
        if (this.stalkerStore.selectedContentType() !== 'itv') {
            return;
        }
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
            this.activeEpgPrograms().map(toRecordingProgramSnapshot),
            event.startedAt,
            event.endedAt,
            this.epgOffsetMinutes()
        );
        if (programs.length === 0) {
            return;
        }
        void this.recordingsService.updatePrograms(event.targetPath, programs);
    }
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
        this.toLiveEpgPanelSummary(this.currentProgram())
    );
    readonly controlledChannel = computed<Channel | null>(() => {
        const selectedType = this.stalkerStore.selectedContentType();
        const selectedItem = this.stalkerStore.selectedItem();
        if (selectedType !== 'itv' || !selectedItem?.id) {
            return null;
        }

        const channelId = normalizeStalkerEntityId(selectedItem.id);
        const channelName = selectedItem.o_name || selectedItem.name || '';

        return {
            id: channelId,
            name: channelName,
            url: this.streamUrl() || String(selectedItem.cmd ?? ''),
            group: { title: '' },
            tvg: {
                id: channelId,
                name: channelName,
                url: '',
                logo: selectedItem.logo ?? '',
                rec: '',
            },
            http: {
                referrer: '',
                'user-agent': '',
                origin: '',
            },
            radio: 'false',
            epgParams: '',
        };
    });
    readonly isLoadingEpg = computed(
        () =>
            this.stalkerStore.isLoadingBulkItvEpg() ||
            this.isLoadingFallbackEpg()
    );

    /** Channel list EPG preview */
    readonly epgPreviewPrograms = new Map<string | number, EpgProgram>();
    readonly currentProgramsProgress = new Map<string | number, number>();
    private readonly cdr = inject(ChangeDetectorRef);
    /** Short-EPG fallback for rows the bulk guide cannot answer. */
    private readonly epgPreviewQueue = new StalkerEpgPreviewQueue({
        // The window is widened under a negative display offset so it still
        // reaches the programme on air; see previewFetchSize.
        fetchPrograms: async (channelId) =>
            (
                await this.stalkerStore.fetchChannelEpg(
                    channelId,
                    previewFetchSize(this.epgOffsetMinutes())
                )
            ).map((item) => this.toProgram(item, channelId)),
        onPrograms: (channelId, programs) =>
            this.applyFallbackPreviewPrograms(channelId, programs),
        epgOffsetMinutes: () => this.epgOffsetMinutes(),
    });

    /** Favorites */
    readonly favorites = new Map<string | number, boolean>();

    /** Scroll */
    readonly scrollContainer = viewChild<ElementRef>('scrollContainer');
    private scrollListener: (() => void) | null = null;
    private epgPreviewRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private epgLoadRequestId = 0;
    private playbackRequestId = 0;
    /** Stream URL of the radio playback whose header override this layout configured. */
    private radioHeaderScopeUrl: string | null = null;
    private playbackResolution: {
        ownerKey: string;
        promise: Promise<ResolvedPortalPlayback>;
    } | null = null;
    private lastPlaylistId: string | null | undefined = undefined;

    constructor() {
        this.epgClockTimer = setInterval(
            () => this.epgClockTick.update((tick) => tick + 1),
            30_000
        );

        // Load favorites for current playlist
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (playlistId) {
            this.playlistService
                .getPortalFavorites(playlistId)
                .pipe(takeUntilDestroyed())
                .subscribe((favs) => {
                    favs.forEach((fav: StalkerFavoriteItem) => {
                        if (fav.id !== undefined) {
                            this.favorites.set(
                                normalizeStalkerEntityId(fav.id),
                                true
                            );
                        }
                    });
                });
        }

        // Start the full ITV channel list load as soon as the Live TV section
        // is entered (not on the first category click), so the all-channels
        // grid and the category count badges are available immediately.
        effect(() => {
            const contentType = this.stalkerStore.selectedContentType();
            const playlist = this.stalkerStore.currentPlaylist();
            if (contentType === 'itv' && playlist) {
                untracked(() => this.stalkerStore.preloadItvChannels());
            }
        });

        // Reset channels/page on category change. When the new category is
        // served from the cache, the content loader re-serves the filtered
        // list synchronously, so clearing here would just clobber it (the
        // reset effect runs after the store resource) and leave the list stuck
        // empty. Categories on the legacy paged flow — cold cache AND censored
        // genres missing from the cache — still clear to avoid flashing the
        // previous category's channels during the async fetch.
        effect(() => {
            const contentType = this.stalkerStore.selectedContentType();
            this.stalkerStore.selectedCategoryId();
            untracked(() => {
                if (contentType === 'radio') {
                    this.stalkerStore.setRadioChannels([]);
                } else if (!this.stalkerStore.itvSelectedCategoryFromCache()) {
                    this.stalkerStore.setItvChannels([]);
                }
                this.stalkerStore.setPage(0);
                this.clearEpgPreviewMaps();
            });
        });

        // The panel's short-EPG fallback belongs to the SELECTED channel, not
        // to the category: a category switch only re-filters the sidebar while
        // the selected channel keeps playing (Xtream parity), so its panel
        // programmes — and a fallback load still in flight — must survive it.
        // Leaving the section (itv ↔ radio) is different: the route session
        // clears the selection there, and an abandoned request must not settle
        // its loading flag into the next view, so that transition still
        // invalidates the request and drops the fallback.
        effect(() => {
            this.stalkerStore.selectedContentType();
            untracked(() => {
                this.epgLoadRequestId += 1;
                this.fallbackEpgPrograms.set(null);
                this.isLoadingFallbackEpg.set(false);
            });
        });

        // Reset loading state when channels load and keep preview data in sync with bulk EPG.
        effect(() => {
            const channels = this.visibleChannels();
            if (channels.length > 0) {
                this.isLoadingMore.set(false);
                if (!this.searchTerm()) {
                    setTimeout(() => this.checkIfNeedsMoreContent(), 100);
                }
            }

            if (this.isRadioMode() || !this.supportsEpg) {
                this.clearEpgPreviewMaps();
                // Supersede the queue too — an abandoned ITV view must not
                // keep spending portal requests on rows that are gone.
                this.epgPreviewQueue.sync([]);
                this.cdr.markForCheck();
                return;
            }

            this.syncBulkEpgPreviews(channels);

            // Overlay manual EPG mappings for the rendered channels; the
            // store dedupes per channel id, so this is cheap on rerenders.
            if (this.supportsEpgMapping && channels.length > 0) {
                const channelIds = channels.map((channel) => channel.id);
                untracked(
                    () => void this.stalkerStore.applyMappedItvEpg(channelIds)
                );
            }
        });

        effect(() => {
            const playlistId = this.stalkerStore.currentPlaylist()?._id ?? null;
            if (playlistId === this.lastPlaylistId) {
                return;
            }

            this.lastPlaylistId = playlistId;
            this.epgLoadRequestId += 1;
            this.fallbackEpgPrograms.set(null);
            this.isLoadingFallbackEpg.set(false);
            // Channel ids are only unique per portal — cached previews of the
            // previous playlist must not leak into the new one.
            this.epgPreviewQueue.reset();
            this.stalkerStore.clearBulkItvEpgCache();
        });

        // Load the bulk ITV EPG as soon as a category's channels are available
        // — not only after the first channel is played — so the per-channel
        // "now playing" previews in the list and the EPG panel populate
        // immediately. Registered AFTER the playlist-change effect above so a
        // portal switch clears the stale cache first and this then refills it;
        // ensureBulkItvEpg de-duplicates and reuses the cache, so this is safe
        // to fire on every channel-list change.
        effect(() => {
            const hasChannels = this.itvChannels().length > 0;
            const playlistId = this.stalkerStore.currentPlaylist()?._id;
            if (
                this.isRadioMode() ||
                !this.supportsEpg ||
                !hasChannels ||
                !playlistId
            ) {
                return;
            }

            untracked(() => void this.stalkerStore.ensureBulkItvEpg(168));
        });

        // Setup scroll listener when container becomes available
        effect(() => {
            const container = this.scrollContainer();
            if (container) {
                this.setupScrollListener();
            }
        });

        effect(() => {
            const remoteControl = this.remoteControlBridge;
            if (!remoteControl?.updateRemoteControlStatus) {
                return;
            }

            const selectedItem = this.stalkerStore.selectedItem();
            const selectedType = this.stalkerStore.selectedContentType();
            const channels = this.filteredChannels();

            // Radio shares this layout and its remote channel handlers, so
            // it must publish live status too — otherwise the remote shows
            // "waiting for playback" while its commands keep working.
            if (
                (selectedType !== 'itv' && selectedType !== 'radio') ||
                !selectedItem?.id
            ) {
                remoteControl.updateRemoteControlStatus({
                    portal: 'stalker',
                    isLiveView: false,
                    supportsVolume: false,
                });
                return;
            }

            // String-normalized comparison: radio ids ("radio-1") and other
            // non-numeric portal ids would turn into NaN under Number().
            const selectedId = normalizeStalkerEntityId(selectedItem.id);
            const currentIndex = channels.findIndex(
                (item) => normalizeStalkerEntityId(item.id) === selectedId
            );
            // ITV only: selectedItvEpgPrograms is fed by the ITV-keyed bulk
            // EPG cache, which survives itv→radio navigation. Ministra
            // assigns small integer ids to itv and radio independently, so a
            // radio station's id routinely collides with an unrelated TV
            // channel's programmes.
            const currentProgram =
                selectedType === 'itv' ? this.currentProgram() : null;

            remoteControl.updateRemoteControlStatus({
                portal: 'stalker',
                isLiveView: true,
                channelName: selectedItem.o_name || selectedItem.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: currentProgram?.title,
                epgStart: currentProgram?.start,
                epgEnd: currentProgram?.stop,
                supportsVolume: false,
            });
        });

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
    }

    ngOnDestroy() {
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
        // Leaving the live view would otherwise keep the last channel
        // advertised as live on the remote forever.
        this.remoteControlBridge?.updateRemoteControlStatus?.(
            REMOTE_CONTROL_RESET_STATUS
        );
        this.removeScrollListener();
        if (this.epgClockTimer !== null) {
            clearInterval(this.epgClockTimer);
            this.epgClockTimer = null;
        }
        if (this.epgPreviewRefreshTimer !== null) {
            clearTimeout(this.epgPreviewRefreshTimer);
            this.epgPreviewRefreshTimer = null;
        }
        this.epgPreviewQueue.destroy();
        // Invalidate any playback continuation still awaiting its header
        // IPC, then drop the radio credentials — they must not outlive this
        // layout. The service no-ops when a newer playback already owns the
        // override slot.
        this.playbackRequestId += 1;
        this.streamHeaders.clear(this.radioHeaderScopeUrl);
        this.clearActivePlayback();
    }

    isSelectedChannel(item: StalkerItvChannel): boolean {
        return (
            this.selectedChannelId() === this.normalizeStalkerEntityId(item.id)
        );
    }

    async playChannel(
        item: StalkerItvChannel,
        startPlayback = !this.settingsStore.openStreamOnDoubleClick()
    ) {
        const requestId = ++this.playbackRequestId;
        const channelId = normalizeStalkerEntityId(item.id);
        const sourceId = normalizeStalkerEntityId(
            this.stalkerStore.currentPlaylist()?._id
        );
        const contentType = this.stalkerStore.selectedContentType();
        const isRadioMode = this.isRadioMode();
        this.stalkerStore.setSelectedItem(item);
        this.ensureChannelWithinRenderWindow(channelId);
        // A previously owned radio override must not survive into a
        // selection that never mounts a player surface of its own — external
        // video playback and failed resolutions would otherwise keep the old
        // radio credentials installed for that origin.
        this.streamHeaders.clear(this.radioHeaderScopeUrl);
        this.radioHeaderScopeUrl = null;

        try {
            const playback = await this.resolvePlaybackForChannel(
                item,
                { sourceId, contentType, channelId },
                isRadioMode
            );
            const owner = { sourceId, contentType, channelId };
            if (!this.isPlaybackRequestCurrent(requestId, owner)) {
                return;
            }

            if (isRadioMode) {
                // The radio branch renders the dedicated audio player, not
                // WebPlayerViewComponent, so the scoped Electron header
                // override (portal cookie/token for auth-gated streams) must
                // be configured here BEFORE the audio element gets the URL.
                // Ownership is claimed synchronously, before awaiting the
                // IPC: if this layout is destroyed while the apply is still
                // in flight, ngOnDestroy must already know which stream's
                // override to clear — otherwise the credentials would
                // outlive the route.
                const headerSync = this.streamHeaders.apply(playback);
                this.radioHeaderScopeUrl = playback.streamUrl;
                const stillCurrent = headerSync ? await headerSync : true;
                if (
                    !stillCurrent ||
                    !this.isPlaybackRequestCurrent(requestId, owner)
                ) {
                    return;
                }
                this.setActivePlayback(playback, null);
                return;
            }

            if (this.supportsEpg) {
                void this.loadEpgForChannel(item);
            }

            if (this.usesEmbeddedPlayer()) {
                if (!sourceId || !channelId) return;
                this.setActivePlayback(playback, {
                    sourceId,
                    contentId: channelId,
                });
            } else if (startPlayback) {
                void this.portalPlayer.openResolvedPlayback(playback, true);
            }
        } catch (error) {
            if (
                !this.isPlaybackRequestCurrent(requestId, {
                    sourceId,
                    contentType,
                    channelId,
                })
            ) {
                return;
            }

            this.logger.error('Playback failed', error);
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                    : this.translate.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, undefined, { duration: 3000 });
        }
    }

    private resolvePlaybackForChannel(
        item: StalkerItvChannel,
        owner: StalkerPlaybackResolutionOwner,
        isRadioMode: boolean
    ): Promise<ResolvedPortalPlayback> {
        const ownerKey = JSON.stringify(owner);
        if (this.playbackResolution?.ownerKey === ownerKey) {
            return this.playbackResolution.promise;
        }

        const playableItem = this.toPlayableChannel(item);
        const promise = isRadioMode
            ? this.stalkerStore.resolveRadioPlayback(playableItem)
            : this.stalkerStore.resolveItvPlayback(playableItem);
        this.playbackResolution = { ownerKey, promise };

        const cleanup = () => {
            if (this.playbackResolution?.promise === promise) {
                this.playbackResolution = null;
            }
        };

        void promise.then(cleanup, cleanup);

        return promise;
    }

    private isPlaybackRequestCurrent(
        requestId: number,
        owner: StalkerPlaybackResolutionOwner
    ): boolean {
        return (
            requestId === this.playbackRequestId &&
            this.selectedChannelId() === owner.channelId &&
            normalizeStalkerEntityId(
                this.stalkerStore.currentPlaylist()?._id
            ) === owner.sourceId &&
            this.stalkerStore.selectedContentType() === owner.contentType
        );
    }

    private setActivePlayback(
        playback: ResolvedPortalPlayback,
        identity: StalkerActiveLivePlaybackIdentity | null
    ): void {
        this.activePlaybackIdentity.set(identity);
        this.activePlayback.set(playback);
    }

    private clearActivePlayback(): void {
        this.activePlaybackIdentity.set(null);
        this.activePlayback.set(null);
    }

    toggleFavorite(item: StalkerItvChannel) {
        const itemId = normalizeStalkerEntityId(item.id);
        if (this.favorites.has(itemId)) {
            this.stalkerStore.removeFromFavorites(itemId);
            this.favorites.delete(itemId);
        } else {
            const playableItem = this.toPlayableChannel(item);
            this.stalkerStore.addToFavorites({
                ...playableItem,
                category_id: this.isRadioMode() ? 'radio' : 'itv',
                title: item.o_name || item.name,
                cover: item.logo,
                added_at: new Date().toISOString(),
            });
            this.favorites.set(itemId, true);
        }
    }

    /**
     * In full-list mode the rendered list is windowed to `renderLimit`. When a
     * channel beyond that window is selected (remote channel-up/down, numeric
     * select), grow the window so the selection is actually in the DOM and can
     * be highlighted/scrolled to instead of drifting off-window.
     */
    private ensureChannelWithinRenderWindow(channelId: string): void {
        if (!this.isCategoryFromCache()) {
            return;
        }

        const index = this.filteredChannels().findIndex(
            (item) => normalizeStalkerEntityId(item.id) === channelId
        );
        if (index < 0 || index < this.renderLimit()) {
            return;
        }

        const needed =
            Math.ceil((index + 1) / FULL_LIST_RENDER_CHUNK) *
            FULL_LIST_RENDER_CHUNK;
        this.renderLimit.set(Math.max(this.renderLimit(), needed));
    }

    loadMore() {
        if (this.isCategoryFromCache()) {
            // Extends the render window over the in-memory list — no request.
            if (this.hasMoreItems()) {
                this.renderLimit.update(
                    (limit) => limit + FULL_LIST_RENDER_CHUNK
                );
            }
            return;
        }

        // Legacy portal pagination — also used for censored (adult) genres
        // that are absent from the full-list cache.
        if (this.isLoadingMore() || !this.hasMoreItems()) return;
        this.isLoadingMore.set(true);
        const nextPage = this.stalkerStore.page() + 1;
        this.stalkerStore.setPage(nextPage);
    }

    refreshChannels(): void {
        void this.stalkerStore.refreshItvChannels();
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
    }

    toggleSidebar(): void {
        this.liveSidebarStateService.toggle();
    }

    handleRadioChannelSwitch(direction: 'next' | 'previous'): void {
        this.handleAdjacentChannelChange(direction === 'next' ? 'down' : 'up');
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

    // ── Context menu (Map EPG) ─────────────────────────────────────

    onChannelContextMenu(channel: StalkerItvChannel, event: MouseEvent): void {
        this.contextMenuChannel.set(channel);
        this.contextMenuPosition.set({
            x: `${event.clientX}px`,
            y: `${event.clientY}px`,
        });

        const trigger = this.contextMenuTrigger();
        if (trigger.menuOpen) {
            trigger.closeMenu();
        }

        queueMicrotask(() => {
            this.contextMenuTrigger().openMenu();
        });
    }

    async openEpgMapping(): Promise<void> {
        const channel = this.contextMenuChannel();
        if (!channel) {
            return;
        }

        this.contextMenuTrigger().closeMenu();
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        const channelId = normalizeStalkerEntityId(channel.id);
        if (!playlistId || !channelId) {
            return;
        }

        const channelKey = buildStalkerEpgMappingKey(
            String(playlistId),
            channelId
        );
        const mappingBefore = await this.epgBridge
            .getEpgMapping(channelKey)
            .catch(() => null);

        EpgMappingDialogComponent.open(this.dialog, {
            channelKey,
            channelName: channel.o_name || channel.name || channelId,
            playlistId: String(playlistId),
        })
            .afterClosed()
            .subscribe(() => {
                void this.refreshEpgAfterMappingChange(
                    channel,
                    channelKey,
                    mappingBefore?.epgChannelId ?? null
                );
            });
    }

    /**
     * Reload EPG state when the dialog actually changed the mapping —
     * covers both save and removal; a plain cancel skips the reload.
     */
    private async refreshEpgAfterMappingChange(
        channel: StalkerItvChannel,
        channelKey: string,
        epgChannelIdBefore: string | null
    ): Promise<void> {
        const mappingAfter = await this.epgBridge
            .getEpgMapping(channelKey)
            .catch(() => null);
        if ((mappingAfter?.epgChannelId ?? null) === epgChannelIdBefore) {
            return;
        }

        this.stalkerStore.clearBulkItvEpgCache();
        const selectedId = this.selectedChannelId();
        const selected = selectedId
            ? this.channels().find(
                  (item) =>
                      normalizeStalkerEntityId(item.id) ===
                      normalizeStalkerEntityId(selectedId)
              )
            : null;
        await this.loadEpgForChannel(selected ?? channel);
        // Use the unfiltered list so an active search filter cannot drop
        // the playing channel's mapping override.
        await this.stalkerStore.applyMappedItvEpg(
            this.channels().map((item) => item.id)
        );
    }

    private async loadEpgForChannel(item: StalkerItvChannel) {
        if (!this.supportsEpg) {
            this.fallbackEpgPrograms.set(null);
            this.isLoadingFallbackEpg.set(false);
            this.clearEpgPreviewMaps();
            return;
        }

        const requestId = ++this.epgLoadRequestId;
        const normalizedChannelId = normalizeStalkerEntityId(item.id);
        const playlistId = this.stalkerStore.currentPlaylist()?._id ?? null;
        const shouldEnsureBulk =
            !this.stalkerStore.bulkItvEpgLoaded() ||
            this.stalkerStore.bulkItvEpgPlaylistId() !== playlistId ||
            this.stalkerStore.bulkItvEpgPeriodHours() !== 168;

        this.fallbackEpgPrograms.set(null);
        this.isLoadingFallbackEpg.set(false);

        try {
            if (shouldEnsureBulk) {
                await this.stalkerStore.ensureBulkItvEpg(168);
                if (!this.isCurrentEpgRequest(requestId, normalizedChannelId)) {
                    return;
                }
            }

            // Skip the short-EPG fallback only when the bulk guide can
            // actually answer "what's on now" — a non-empty bulk list of
            // future-only programmes still needs the fallback merged in.
            if (
                this.findCurrentProgram(
                    this.stalkerStore.selectedItvEpgPrograms()
                )
            ) {
                return;
            }

            // Resolve this channel's manual mapping before falling back: a
            // mapped channel must show the mapped XMLTV schedule only —
            // merging the portal's short EPG in could surface the portal's
            // programme, defeating the mapping the user created to replace
            // it. The store dedupes per channel id, so this is cheap.
            await this.stalkerStore.applyMappedItvEpg([item.id]);
            if (!this.isCurrentEpgRequest(requestId, normalizedChannelId)) {
                return;
            }
            if (
                this.findCurrentProgram(
                    this.stalkerStore.selectedItvEpgPrograms()
                )
            ) {
                return;
            }
            if (
                this.stalkerStore.hasItvEpgMappingOverride(normalizedChannelId)
            ) {
                return;
            }

            this.isLoadingFallbackEpg.set(true);
            const fallbackItems = await this.stalkerStore.fetchChannelEpg(
                item.id,
                previewFetchSize(
                    this.epgOffsetMinutes(),
                    ACTIVE_EPG_FALLBACK_SIZE
                )
            );
            if (!this.isCurrentEpgRequest(requestId, normalizedChannelId)) {
                return;
            }

            this.fallbackEpgPrograms.set({
                channelId: normalizedChannelId,
                programs: fallbackItems.map((epgItem) =>
                    this.toProgram(epgItem, normalizedChannelId)
                ),
            });
        } catch (error) {
            this.logger.warn('Failed to load Stalker live EPG', error);
            if (this.isCurrentEpgRequest(requestId, normalizedChannelId)) {
                this.fallbackEpgPrograms.set(null);
            }
        } finally {
            if (this.isCurrentEpgRequest(requestId, normalizedChannelId)) {
                this.isLoadingFallbackEpg.set(false);
            }
        }
    }

    private clearEpgPreviewMaps() {
        this.epgPreviewPrograms.clear();
        this.currentProgramsProgress.clear();
    }

    private syncBulkEpgPreviews(channels: StalkerItvChannel[]): void {
        this.clearEpgPreviewMaps();

        const bulkProgramsByChannel = this.stalkerStore.bulkItvEpgByChannel();
        if (channels.length === 0) {
            // A legacy-paged category switch clears the list before the new
            // channels arrive — supersede the backlog so the disappeared
            // rows stop consuming portal request capacity.
            this.epgPreviewQueue.sync([]);
            this.cdr.markForCheck();
            return;
        }

        const channelsWithoutCurrent: string[] = [];
        for (const channel of channels) {
            const channelId = normalizeStalkerEntityId(channel.id);
            // Manually mapped channels are bulk-only: their programs in the
            // bulk record come from the uploaded XMLTV guide, and the portal
            // short EPG must not stand in for the schedule the mapping
            // deliberately replaces.
            const hasMappingOverride =
                this.stalkerStore.hasItvEpgMappingOverride(channelId);
            const currentProgram =
                this.findCurrentProgram(
                    bulkProgramsByChannel[channelId] ?? []
                ) ??
                (hasMappingOverride
                    ? null
                    : this.findCurrentProgram(
                          this.epgPreviewQueue.getCachedPrograms(channelId) ??
                              []
                      ));

            if (!currentProgram) {
                if (!hasMappingOverride) {
                    channelsWithoutCurrent.push(channelId);
                }
                continue;
            }

            this.epgPreviewPrograms.set(channelId, currentProgram);
            this.updateProgramProgress(channelId, currentProgram);
        }

        // Rows the bulk guide cannot answer (portals whose get_epg_info
        // returns only future programmes, or none at all) fall back to
        // per-channel short EPG. Deferred until the bulk request settles so
        // the queue never races the answer it is a fallback for; the effect
        // tracks bulkItvEpgLoaded, so it re-runs when that happens.
        if (this.stalkerStore.bulkItvEpgLoaded()) {
            this.epgPreviewQueue.sync(channelsWithoutCurrent);
        }

        this.cdr.markForCheck();
    }

    private applyFallbackPreviewPrograms(
        channelId: string,
        programs: EpgProgram[]
    ): void {
        if (this.isRadioMode() || !this.supportsEpg) {
            return;
        }

        // Revalidate ownership: the fetch was enqueued before mapping
        // resolution (or a bulk refresh) could finish, and an owner installed
        // in the meantime must not be overwritten by a late portal response.
        if (
            this.stalkerStore.hasItvEpgMappingOverride(channelId) ||
            this.findCurrentProgram(
                this.stalkerStore.bulkItvEpgByChannel()[channelId] ?? []
            )
        ) {
            return;
        }

        const currentProgram = this.findCurrentProgram(programs);
        if (!currentProgram) {
            return;
        }

        this.epgPreviewPrograms.set(channelId, currentProgram);
        this.updateProgramProgress(channelId, currentProgram);
        this.cdr.markForCheck();
    }

    private updateProgramProgress(
        channelId: string | number,
        program: EpgProgram
    ): void {
        const startMs = this.getProgramTimestampMs(
            program.start,
            program.startTimestamp
        );
        const stopMs = this.getProgramTimestampMs(
            program.stop,
            program.stopTimestamp
        );
        const nowMs = epgProviderClockMs(Date.now(), this.epgOffsetMinutes());

        if (
            startMs !== null &&
            stopMs !== null &&
            Number.isFinite(startMs) &&
            Number.isFinite(stopMs) &&
            nowMs >= startMs &&
            nowMs <= stopMs &&
            stopMs > startMs
        ) {
            this.currentProgramsProgress.set(
                channelId,
                ((nowMs - startMs) / (stopMs - startMs)) * 100
            );
            return;
        }

        this.currentProgramsProgress.delete(channelId);
    }

    private toPlayableChannel(item: StalkerItvChannel): StalkerPlayableChannel {
        const { is_series, ...rest } = item;
        return is_series == null ? rest : { ...rest, is_series };
    }

    private setupScrollListener() {
        this.removeScrollListener();

        const container = this.scrollContainer()?.nativeElement;
        if (!container) return;

        const onScroll = () => {
            this.scheduleEpgPreviewRefresh();
            if (this.isLoadingMore() || !this.hasMoreItems()) return;

            const { scrollTop, scrollHeight, clientHeight } = container;
            const scrollThreshold = 150;

            if (scrollHeight - scrollTop - clientHeight <= scrollThreshold) {
                this.loadMore();
            }
        };

        container.addEventListener('scroll', onScroll, { passive: true });
        this.scrollListener = () =>
            container.removeEventListener('scroll', onScroll);
    }

    private checkIfNeedsMoreContent() {
        const container = this.scrollContainer()?.nativeElement;
        if (!container) return;
        if (this.isLoadingMore() || !this.hasMoreItems()) return;

        const { scrollHeight, clientHeight } = container;
        if (scrollHeight <= clientHeight) {
            this.loadMore();
        }
    }

    private removeScrollListener() {
        if (this.scrollListener) {
            this.scrollListener();
            this.scrollListener = null;
        }
    }

    /**
     * The preview queue caps each sync's backlog so request count tracks
     * user engagement, not render size — scrolling therefore re-syncs to
     * fetch the next rows the user is moving toward. Throttled; a fully
     * cached list makes the re-sync a no-op.
     */
    private scheduleEpgPreviewRefresh(): void {
        if (this.epgPreviewRefreshTimer !== null) {
            return;
        }
        this.epgPreviewRefreshTimer = setTimeout(() => {
            this.epgPreviewRefreshTimer = null;
            if (this.isRadioMode() || !this.supportsEpg) {
                return;
            }
            this.syncBulkEpgPreviews(this.visibleChannels());
        }, 300);
    }

    private toProgram(item: EpgItem, channelId: string | number): EpgProgram {
        return {
            start: item.start,
            stop: item.stop || item.end,
            channel: String(channelId),
            title: item.title,
            desc: item.description || null,
            category: null,
            startTimestamp: this.toTimestamp(item.start_timestamp, item.start),
            stopTimestamp: this.toTimestamp(
                item.stop_timestamp,
                item.stop || item.end
            ),
        };
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

    private toTimestamp(
        rawTimestamp: string | number | null | undefined,
        rawDate: string
    ): number | null {
        const timestamp = Number.parseInt(String(rawTimestamp ?? ''), 10);
        if (Number.isFinite(timestamp) && timestamp > 0) {
            return timestamp;
        }

        const parsedDate = Date.parse(rawDate);
        return Number.isFinite(parsedDate)
            ? Math.floor(parsedDate / 1000)
            : null;
    }

    private findCurrentProgram(programs: EpgProgram[]): EpgProgram | null {
        // Raw programme times vs. now in the provider's EPG clock
        // (`epg-display-offset.util.ts`, clock form); reading the setting
        // here also re-runs every computed/effect that picks previews.
        const now = epgProviderClockMs(Date.now(), this.epgOffsetMinutes());
        return (
            programs.find((program) => {
                const start = this.getProgramTimestampMs(
                    program.start,
                    program.startTimestamp
                );
                const stop = this.getProgramTimestampMs(
                    program.stop,
                    program.stopTimestamp
                );
                return (
                    start !== null &&
                    stop !== null &&
                    now >= start &&
                    now < stop
                );
            }) ?? null
        );
    }

    private getProgramTimestampMs(
        rawDate: string,
        rawTimestamp?: number | null
    ): number | null {
        if (Number.isFinite(rawTimestamp) && Number(rawTimestamp) > 0) {
            return Number(rawTimestamp) * 1000;
        }

        const parsedDate = Date.parse(rawDate);
        return Number.isFinite(parsedDate) ? parsedDate : null;
    }

    private isCurrentEpgRequest(
        requestId: number,
        normalizedChannelId: string
    ): boolean {
        return (
            requestId === this.epgLoadRequestId &&
            this.selectedChannelId() === normalizedChannelId
        );
    }

    private get remoteControlBridge(): Window['electron'] | undefined {
        return this.runtime.supportsRemoteControl ? window.electron : undefined;
    }

    private handleRemoteChannelChange(direction: 'up' | 'down'): void {
        this.handleAdjacentChannelChange(direction);
    }

    private handleAdjacentChannelChange(direction: 'up' | 'down'): void {
        const activeItem = this.stalkerStore.selectedItem();
        if (!activeItem?.id) {
            return;
        }

        const channels = this.filteredChannels();
        const nextItem = getAdjacentChannelItem(
            channels,
            activeItem.id,
            direction,
            (item) => item.id
        );

        if (!nextItem) {
            return;
        }

        void this.playChannel(nextItem, true);
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

        const channel = getChannelItemByNumber(
            this.filteredChannels(),
            command.number
        );
        if (!channel) {
            return;
        }

        void this.playChannel(channel, true);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void launch;
    }
}
