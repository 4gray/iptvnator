import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    applyChannelNameStrip,
    getM3uArchiveDays,
    isM3uCatchupPlaybackSupported,
    resolveM3uCatchupUrl,
} from '@iptvnator/shared/m3u-utils';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    deriveVisibleFavoriteChannels,
    FavoritesChannelSortMode,
    LiveEpgPanelState,
    matchesOpenLiveCollectionItem,
    OpenLiveCollectionItemState,
    PORTAL_PLAYER,
    persistLiveEpgPanelState,
    restoreLiveEpgPanelState,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';
import { setupUnifiedLiveTabRemoteControl } from './unified-live-tab-remote-control';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import {
    EpgDateNavigationDirection,
    EpgListViewComponent,
    EpgProgramActivationEvent,
    EpgTimelineComponent,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import {
    getLiveEpgPanelSummary,
    toEpgProgram,
    toEpochSeconds,
    toLiveEpgPanelSummary,
} from './unified-live-epg-summary.util';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import { ChannelListHiddenStateComponent } from '../channel-list-hidden-state/channel-list-hidden-state.component';
import { PortalEmptyStateComponent } from '../portal-empty-state/portal-empty-state.component';
import {
    AudioPlayerComponent,
    ElectronStreamHeadersService,
    type PlaybackFallbackRequest,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { ResizableDirective } from '@iptvnator/ui/components';
import {
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    buildStalkerEpgMappingKey,
    buildXtreamEpgMappingKey,
    EpgProgram,
    filterRecordingProgramsOverlap,
    playlistDisplayLabel,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    toRecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';
import { createUnifiedLivePlaybackSessionKey } from './unified-live-playback-session-key';

@Component({
    selector: 'app-unified-live-tab',
    templateUrl: './unified-live-tab.component.html',
    styleUrl: './unified-live-tab.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AudioPlayerComponent,
        EpgListViewComponent,
        EpgTimelineComponent,
        GlobalFavoritesListComponent,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        ChannelListHiddenStateComponent,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
})
export class UnifiedLiveTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly searchTerm = input('');
    readonly autoOpenItem = input<OpenLiveCollectionItemState | null>(null);
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly sortMode = input<FavoritesChannelSortMode>(
        DEFAULT_FAVORITES_CHANNEL_SORT_MODE
    );

    readonly removeItem = output<UnifiedCollectionItem>();
    readonly favoriteToggled = output<UnifiedCollectionItem>();
    readonly reorderItems = output<UnifiedCollectionItem[]>();
    readonly itemPlayed = output<UnifiedCollectionItem>();
    readonly autoOpenHandled = output<void>();
    readonly isSidebarCollapsed = input(false);
    /** The rail is owned by the page header toggle; ask it to expand. */
    readonly restoreSidebarRequested = output<void>();

    private readonly streamResolver = inject(StreamResolverService);
    private readonly recentData = inject(UnifiedRecentDataService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly streamHeaders = inject(ElectronStreamHeadersService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    /** Stream URL of the radio playback whose header override this tab configured. */
    private radioHeaderScopeUrl: string | null = null;

    readonly player = this.settingsStore.player;
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly isEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );

    readonly activeDetail = signal<ResolvedLiveCollectionDetail | null>(null);
    readonly activeUid = signal<string | null>(null);
    /** Full collection item for the active selection — used to read
     *  portal archive fields (tvArchive/tvArchiveDuration) and to
     *  supply credentials for Xtream catch-up URL resolution. */
    readonly activeItem = signal<UnifiedCollectionItem | null>(null);
    readonly playbackSessionKey = computed(() =>
        createUnifiedLivePlaybackSessionKey(this.activeItem())
    );
    readonly isSelecting = signal(false);
    readonly epgMap = signal<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = signal(0);
    readonly liveEpgPanelState = signal<LiveEpgPanelState>(
        restoreLiveEpgPanelState()
    );
    readonly selectedLiveEpgDate = signal(getTodayEpgDateKey());
    /** Catch-up override for the active M3U channel; null = live playback. */
    readonly activeTimeshift = signal<{
        url: string;
        program: EpgProgram;
    } | null>(null);
    readonly activeTimeshiftProgram = computed(
        () => this.activeTimeshift()?.program ?? null
    );
    /** Playback target for the inline player, honouring a catch-up override. */
    readonly inlinePlayback = computed(() => {
        const playback = this.activeDetail()?.playback ?? null;
        const timeshift = this.activeTimeshift();
        if (!playback || !timeshift) {
            return playback;
        }

        return {
            ...playback,
            streamUrl: timeshift.url,
            isLive: false,
        };
    });
    readonly currentStreamUrl = computed(
        () => this.inlinePlayback()?.streamUrl ?? ''
    );
    readonly isM3uSelection = computed(
        () => this.activeDetail()?.epgMode === 'm3u'
    );
    readonly currentPortalEpgItems = computed(
        () => this.activeDetail()?.epgItems ?? []
    );
    readonly currentM3uPrograms = computed(() => {
        const detail = this.activeDetail();
        if (detail?.epgMode !== 'm3u') {
            return [];
        }

        if (detail.channel?.radio === 'true') {
            return [];
        }

        return detail.epgPrograms ?? [];
    });
    readonly currentM3uChannel = computed(() => {
        const detail = this.activeDetail();
        if (detail?.epgMode !== 'm3u') {
            return null;
        }

        return detail.channel ?? null;
    });
    readonly currentM3uArchivePlaybackAvailable = computed(() =>
        isM3uCatchupPlaybackSupported(this.currentM3uChannel())
    );
    /** Portal EPG items normalised to the timeline programme shape. */
    readonly currentPortalEpgPrograms = computed<EpgProgram[]>(() =>
        this.currentPortalEpgItems().map((item) => toEpgProgram(item))
    );
    readonly timelinePrograms = computed<EpgProgram[]>(() =>
        this.isM3uSelection()
            ? this.currentM3uPrograms()
            : this.currentPortalEpgPrograms()
    );
    readonly timelineChannelName = computed(() =>
        applyChannelNameStrip(
            this.currentM3uChannel()?.name ??
                this.activeDetail()?.playback?.title,
            this.settingsStore.stripCountryPrefix?.()
        )
    );
    readonly timelineChannelLogo = computed(
        () =>
            this.currentM3uChannel()?.tvg?.logo ??
            this.activeDetail()?.playback?.thumbnail ??
            ''
    );
    readonly timelineArchiveAvailable = computed(() => {
        if (this.isM3uSelection()) {
            return this.currentM3uArchivePlaybackAvailable();
        }

        // Portal archive: tvArchive === 1 means the provider has
        // timeshift / archive enabled for this channel.
        const item = this.activeItem();
        return (
            Number(item?.tvArchive ?? 0) === 1 &&
            Number(item?.tvArchiveDuration ?? 0) > 0
        );
    });
    /**
     * Catch-up window (days) for the active channel, so the timeline can
     * gate "Watch" to programmes inside it. Without this the timeline defaults
     * `archiveDays` to 0 (treated as unlimited) and offers catch-up on
     * programmes older than the real archive window.
     *
     * M3U: reads catchup-days / timeshift / tvg-rec from the channel attrs.
     * Portal: tvArchiveDuration is already in days — pass it through,
     * matching `live-stream-layout.controlledArchiveDays`.
     */
    readonly timelineArchiveDays = computed(() => {
        if (!this.timelineArchiveAvailable()) return 0;

        if (this.isM3uSelection()) {
            return getM3uArchiveDays(this.currentM3uChannel());
        }

        return Math.max(
            0,
            Number(this.activeItem()?.tvArchiveDuration ?? 0) || 0
        );
    });
    readonly activeRadioChannel = computed(() => {
        const channel = this.activeDetail()?.channel ?? null;
        return channel?.radio === 'true' ? channel : null;
    });
    readonly isRadioSelection = computed(
        () => this.activeRadioChannel() !== null
    );
    readonly shouldUseInlinePlayer = computed(() => {
        return this.isRadioSelection() || this.isEmbeddedPlayer();
    });
    readonly isLiveEpgPanelCollapsed = computed(
        () => this.liveEpgPanelState() === 'collapsed'
    );
    /** Live EPG panel layout chosen in settings; hosts swap timeline ↔ list. */
    readonly epgViewMode = this.settingsStore.resolvedEpgViewMode;
    readonly liveEpgPanelSummary = computed(() => {
        const timeshift = this.activeTimeshift();
        if (timeshift) {
            // Archive summary is frozen — don't track the 30s progress tick.
            return toLiveEpgPanelSummary(timeshift.program);
        }
        this.progressTick();
        return getLiveEpgPanelSummary(this.activeDetail());
    });
    readonly liveEpgPanelSummaryLabelKey = computed(() =>
        this.activeTimeshift() ? 'EPG.ARCHIVE_PLAYBACK' : 'EPG.CURRENT_PROGRAM'
    );
    private readonly recordingsService = inject(RecordingsService);
    /** Channel/EPG snapshot for the embedded-MPV recording tracker. */
    readonly recordingMetadata = computed<RecordingStartMetadata | null>(() => {
        const item = this.activeItem();
        if (!item) {
            return null;
        }
        // Track the 30 s tick: without it this computed caches its
        // Date.now() verdict, and a recording started after an EPG boundary
        // would snapshot the previous show.
        this.progressTick();
        const now = Date.now();
        const program =
            this.timelinePrograms().find((candidate) => {
                const start = Date.parse(candidate.start);
                const stop = Date.parse(candidate.stop);
                return (
                    Number.isFinite(start) &&
                    Number.isFinite(stop) &&
                    start <= now &&
                    now < stop
                );
            }) ?? null;
        return {
            channelName: item.name?.trim() || 'Live TV',
            channelLogoUrl:
                this.timelineChannelLogo() || item.logo || undefined,
            playlistId: item.playlistId,
            playlistName: playlistDisplayLabel(item.playlistName) || undefined,
            sourceType: item.sourceType,
            epgChannelId: this.recordingEpgChannelId(item),
            // The EPG key is not unique for M3U items (shared tvgId, or the
            // display-name fallback); the uid names the exact selection.
            sourceItemKey: item.uid,
            currentProgram: program
                ? toRecordingProgramSnapshot(program)
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
        // The EPG key alone cannot tell two same-keyed M3U items apart —
        // the uid must also match the exact recorded selection.
        if (
            event.sourceItemKey &&
            event.sourceItemKey !== this.recordingMetadata()?.sourceItemKey
        ) {
            return;
        }
        const programs = filterRecordingProgramsOverlap(
            this.timelinePrograms().map(toRecordingProgramSnapshot),
            event.startedAt,
            event.endedAt
        );
        if (programs.length === 0) {
            return;
        }
        void this.recordingsService.updatePrograms(event.targetPath, programs);
    }

    private recordingEpgChannelId(
        item: UnifiedCollectionItem
    ): string | undefined {
        switch (item.sourceType) {
            case 'm3u':
                return item.tvgId?.trim() || item.name?.trim() || undefined;
            case 'xtream':
                return item.xtreamId !== undefined
                    ? buildXtreamEpgMappingKey(item.playlistId, item.xtreamId)
                    : undefined;
            case 'stalker':
                return item.stalkerId !== undefined
                    ? buildStalkerEpgMappingKey(
                          item.playlistId,
                          String(item.stalkerId)
                      )
                    : undefined;
        }
    }

    /**
     * The channel list in exactly the order the sidebar renders it
     * (search-filtered; sorted in favorites mode) — remote-control
     * navigation and channel numbers must follow what is on screen.
     */
    readonly visibleChannels = computed(() =>
        deriveVisibleFavoriteChannels(this.channelsForList(), {
            searchTerm: this.searchTerm(),
            sortMode: this.mode() === 'favorites' ? this.sortMode() : null,
            getName: (channel) => channel.name,
            getAddedAt: (channel) => channel.addedAt,
        })
    );

    readonly channelsForList = computed((): UnifiedFavoriteChannel[] =>
        this.items().map((item) => ({
            uid: item.uid,
            name: item.name,
            logo: item.logo ?? null,
            sourceType: item.sourceType,
            playlistId: item.playlistId,
            playlistName: item.playlistName,
            streamUrl: item.streamUrl,
            m3uChannel: item.m3uChannel,
            radio: item.radio,
            xtreamId: item.xtreamId,
            tvArchive: item.tvArchive ?? null,
            tvArchiveDuration: item.tvArchiveDuration ?? null,
            tvgId: item.tvgId,
            stalkerCmd: item.stalkerCmd,
            stalkerPortalUrl: item.stalkerPortalUrl,
            stalkerMacAddress: item.stalkerMacAddress,
            addedAt: item.addedAt ?? new Date(0).toISOString(),
            position: item.position ?? 0,
            contentId: item.contentId,
        }))
    );

    private selectionRequestId = 0;

    constructor() {
        effect(() => {
            const items = this.items();
            if (this.supportsEpg) {
                void this.loadEpgMap(items);
            } else {
                this.epgMap.set(new Map());
            }

            const activeUid = this.activeUid();
            if (activeUid && !items.some((item) => item.uid === activeUid)) {
                this.onClose();
            }
        });

        effect(() => {
            const target = this.autoOpenItem();
            const items = this.items();
            if (!target || items.length === 0) {
                return;
            }

            const matchedItem = items.find((item) =>
                matchesOpenLiveCollectionItem(item, target)
            );
            if (!matchedItem) {
                return;
            }

            if (this.activeUid() === matchedItem.uid) {
                if (this.activeDetail()) {
                    this.autoOpenHandled.emit();
                    return;
                }

                if (this.isSelecting()) {
                    return;
                }
            }

            void this.activateItem(matchedItem, true);
        });

        setupUnifiedLiveTabRemoteControl({
            visibleChannels: this.visibleChannels,
            activeUid: this.activeUid,
            activeSourceType: computed(
                () => this.activeItem()?.sourceType ?? null
            ),
            activeChannelName: computed(() => this.activeItem()?.name ?? null),
            isPlaybackActive: computed(() => this.activeDetail() !== null),
            epgSummary: this.liveEpgPanelSummary,
            playChannel: (channel) => {
                void this.onChannelPlaybackRequested(channel);
            },
        });

        const tickInterval = setInterval(
            () => this.progressTick.update((tick) => tick + 1),
            30_000
        );
        this.destroyRef.onDestroy(() => {
            clearInterval(tickInterval);
            // Invalidate a playback continuation still awaiting its header
            // IPC and drop any radio credentials owned by this tab.
            this.selectionRequestId += 1;
            this.streamHeaders.clear(this.radioHeaderScopeUrl);
        });
    }

    async onChannelSelected(channel: UnifiedFavoriteChannel): Promise<void> {
        const item = this.items().find(
            (candidate) => candidate.uid === channel.uid
        );
        if (item) {
            await this.activateItem(item);
        }
    }

    async onChannelPlaybackRequested(
        channel: UnifiedFavoriteChannel
    ): Promise<void> {
        const item = this.items().find(
            (candidate) => candidate.uid === channel.uid
        );
        if (item) {
            await this.activateItem(item, false, true);
        }
    }

    onFavoriteToggled(channel: UnifiedFavoriteChannel): void {
        const item = this.items().find(
            (candidate) => candidate.uid === channel.uid
        );
        if (item) {
            if (this.mode() === 'favorites') {
                this.removeItem.emit(item);
            } else {
                this.favoriteToggled.emit(item);
            }
        }
    }

    onRemoveRequested(channel: UnifiedFavoriteChannel): void {
        const item = this.items().find(
            (candidate) => candidate.uid === channel.uid
        );
        if (item) {
            this.removeItem.emit(item);
        }
    }

    onReorder(channels: UnifiedFavoriteChannel[]): void {
        const reordered = channels
            .map((channel) =>
                this.items().find((candidate) => candidate.uid === channel.uid)
            )
            .filter(Boolean) as UnifiedCollectionItem[];
        this.reorderItems.emit(reordered);
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
    }

    onLiveEpgDateNavigation(direction: EpgDateNavigationDirection): void {
        this.selectedLiveEpgDate.set(
            shiftEpgDateKey(this.selectedLiveEpgDate(), direction)
        );
    }

    onLiveEpgSelectedDateChange(selectedDate: string): void {
        this.selectedLiveEpgDate.set(selectedDate);
    }

    onTimelineProgramActivated(event: EpgProgramActivationEvent): void {
        if (event.type === 'live') {
            this.returnToLivePlayback();
            return;
        }

        if (this.isM3uSelection()) {
            this.activateM3uCatchup(event.program);
        } else {
            void this.activatePortalCatchup(event.program);
        }
    }

    /**
     * M3U catch-up: resolve via the M3U timeshift URL resolver.
     */
    private activateM3uCatchup(program: EpgProgram): void {
        const playbackUrl = resolveM3uCatchupUrl(
            this.currentM3uChannel(),
            program
        );
        if (!playbackUrl) {
            this.snackBar.open(
                this.translate.instant('EPG.TIMELINE.CATCHUP_FAILED'),
                undefined,
                { duration: 4000 }
            );
            return;
        }

        this.activeTimeshift.set({ url: playbackUrl, program });

        const playback = this.activeDetail()?.playback;
        if (!this.shouldUseInlinePlayer() && playback) {
            void this.portalPlayer.openResolvedPlayback({
                ...playback,
                streamUrl: playbackUrl,
                isLive: false,
            });
        }
    }

    /**
     * Portal (Xtream) catch-up: compute start/stop as epoch seconds and
     * resolve via the provider's timeshift endpoint.
     */
    private async activatePortalCatchup(program: EpgProgram): Promise<void> {
        const requestId = this.selectionRequestId;
        const item = this.activeItem();
        if (!item?.xtreamId) {
            this.snackBar.open(
                this.translate.instant('EPG.TIMELINE.CATCHUP_FAILED'),
                undefined,
                { duration: 4000 }
            );
            return;
        }

        const startEpoch = toEpochSeconds(
            program.startTimestamp,
            program.start
        );
        const stopEpoch = toEpochSeconds(program.stopTimestamp, program.stop);
        if (startEpoch == null || stopEpoch == null) {
            this.snackBar.open(
                this.translate.instant('EPG.TIMELINE.CATCHUP_FAILED'),
                undefined,
                { duration: 4000 }
            );
            return;
        }

        const playbackUrl = await this.streamResolver.resolveXtreamCatchupUrl(
            item,
            startEpoch,
            stopEpoch
        );
        if (requestId !== this.selectionRequestId) {
            return; // switched channel — discard silently
        }
        if (!playbackUrl) {
            this.snackBar.open(
                this.translate.instant('EPG.TIMELINE.CATCHUP_FAILED'),
                undefined,
                { duration: 4000 }
            );
            return;
        }

        this.activeTimeshift.set({ url: playbackUrl, program });

        const playback = this.activeDetail()?.playback;
        if (!this.shouldUseInlinePlayer() && playback) {
            void this.portalPlayer.openResolvedPlayback({
                ...playback,
                streamUrl: playbackUrl,
                isLive: false,
            });
        }
    }

    returnToLivePlayback(): void {
        this.activeTimeshift.set(null);

        // Inline player is already (back) on the live stream once the
        // timeshift override is cleared. With an external player configured,
        // "Watch live" must open it even when no archive was active — e.g.
        // openStreamOnDoubleClick shows the guide without launching playback.
        const playback = this.activeDetail()?.playback;
        if (!this.shouldUseInlinePlayer() && playback) {
            void this.portalPlayer.openResolvedPlayback(playback);
        }
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void launch;
    }

    onClose(): void {
        this.selectionRequestId += 1;
        this.isSelecting.set(false);
        this.activeDetail.set(null);
        this.activeUid.set(null);
        this.activeItem.set(null);
        this.activeTimeshift.set(null);
        // Radio credentials must not outlive the closed player; the service
        // no-ops when a newer playback already owns the override slot.
        this.streamHeaders.clear(this.radioHeaderScopeUrl);
        this.radioHeaderScopeUrl = null;
    }

    onEpgMappingChanged(): void {
        void this.loadEpgMap(this.items());
    }

    private async loadEpgMap(items: UnifiedCollectionItem[]): Promise<void> {
        const epgMap = await this.streamResolver.loadEpgForItems(items);
        this.epgMap.set(epgMap);
    }

    private async activateItem(
        item: UnifiedCollectionItem,
        isAutoOpen = false,
        startPlayback = false
    ): Promise<void> {
        const activeDetail = this.activeDetail();
        if (this.activeUid() === item.uid && activeDetail) {
            if (
                startPlayback &&
                this.shouldOpenExternalPlayback(activeDetail, true)
            ) {
                void this.portalPlayer.openResolvedPlayback(
                    activeDetail.playback
                );
            }
            if (isAutoOpen) {
                this.autoOpenHandled.emit();
            }
            return;
        }

        const requestId = ++this.selectionRequestId;
        this.activeUid.set(item.uid);
        this.activeItem.set(item);
        this.activeDetail.set(null);
        this.activeTimeshift.set(null);
        this.isSelecting.set(true);
        // A previously owned radio override must not survive into a
        // selection that never mounts a player surface of its own — external
        // video playback and failed resolutions would otherwise keep the old
        // radio credentials installed for that origin.
        this.streamHeaders.clear(this.radioHeaderScopeUrl);
        this.radioHeaderScopeUrl = null;

        try {
            const detail =
                item.sourceType === 'm3u'
                    ? await this.streamResolver.resolveM3uPlaybackDetail(item)
                    : await this.streamResolver.resolveLiveDetail(item);
            if (requestId !== this.selectionRequestId) {
                return;
            }

            if (item.radio === 'true') {
                // Radio renders the dedicated audio player, never
                // WebPlayerViewComponent, so the scoped Electron header
                // override (portal cookie/token for auth-gated streams) is
                // configured here BEFORE the audio element gets the URL.
                // Ownership is claimed synchronously so a close/destroy
                // during the pending IPC can still clear the credentials.
                const headerSync = this.streamHeaders.apply(detail.playback);
                this.radioHeaderScopeUrl = detail.playback.streamUrl;
                const stillCurrent = headerSync ? await headerSync : true;
                if (!stillCurrent || requestId !== this.selectionRequestId) {
                    return;
                }
            }

            this.activeDetail.set(detail);

            if (this.supportsEpg && detail.epgMode === 'm3u') {
                void this.hydrateSelectedM3uPrograms(item, detail, requestId);
            }

            if (this.shouldOpenExternalPlayback(detail, startPlayback)) {
                void this.portalPlayer.openResolvedPlayback(detail.playback);
            }

            try {
                const updatedItem =
                    await this.recentData.recordLivePlayback(item);
                if (requestId === this.selectionRequestId) {
                    this.itemPlayed.emit(updatedItem);
                }
            } catch {
                // Keep playback/EPG visible even if history persistence fails.
            }

            if (requestId === this.selectionRequestId && isAutoOpen) {
                this.autoOpenHandled.emit();
            }
        } catch {
            if (requestId === this.selectionRequestId) {
                this.activeDetail.set(null);
                this.activeUid.set(null);
            }
        } finally {
            if (requestId === this.selectionRequestId) {
                this.isSelecting.set(false);
            }
        }
    }

    private shouldOpenExternalPlayback(
        detail: ResolvedLiveCollectionDetail,
        startPlayback = false
    ): boolean {
        if (
            this.isRadioDetail(detail) ||
            this.portalPlayer.isEmbeddedPlayer()
        ) {
            return false;
        }

        return !this.settingsStore.openStreamOnDoubleClick() || startPlayback;
    }

    private isRadioDetail(
        detail: ResolvedLiveCollectionDetail | null | undefined
    ): boolean {
        return detail?.channel?.radio === 'true';
    }

    private async hydrateSelectedM3uPrograms(
        item: UnifiedCollectionItem,
        detail: ResolvedLiveCollectionDetail,
        requestId: number
    ): Promise<void> {
        if (detail.epgMode !== 'm3u') {
            return;
        }

        if (detail.channel?.radio === 'true') {
            return;
        }

        const epgPrograms = await this.streamResolver.loadM3uProgramsForItem(
            item,
            detail.channel
        );
        if (requestId !== this.selectionRequestId) {
            return;
        }

        this.activeDetail.update((currentDetail) => {
            if (!currentDetail || currentDetail.epgMode !== 'm3u') {
                return currentDetail;
            }

            return {
                ...currentDetail,
                epgPrograms,
            };
        });
    }
}
