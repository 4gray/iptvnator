import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    forwardRef,
    inject,
    input,
    output,
    signal,
    TemplateRef,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    FavoritesChannelSortMode,
    getLiveCollectionPlaylistNavigation,
    matchesOpenLiveCollectionItem,
    OpenLiveCollectionItemState,
    PORTAL_PLAYER,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';
import { setupUnifiedLiveTabRemoteControl } from './unified-live-tab-remote-control';
import { ResolvedLiveCollectionDetail } from '@iptvnator/portal/shared/data-access';
import {
    EpgDateNavigationDirection,
    EpgListViewComponent,
    EpgProgramActivationEvent,
    EpgTimelineComponent,
} from '@iptvnator/ui/epg';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import { OpenInPlaylistChipComponent } from '../open-in-playlist-chip/open-in-playlist-chip.component';
import { ChannelListHiddenStateComponent } from '../channel-list-hidden-state/channel-list-hidden-state.component';
import { PortalEmptyStateComponent } from '../portal-empty-state/portal-empty-state.component';
import {
    AudioPlayerComponent,
    FULLSCREEN_CHANNEL_PANEL,
    type FullscreenChannelPanelContext,
    type FullscreenChannelPanelHost,
    type PlaybackFallbackRequest,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { ResizableDirective } from '@iptvnator/ui/components';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { RecordingStoppedEvent } from '@iptvnator/shared/interfaces';
import {
    createUnifiedLiveCatchup,
    UnifiedLiveTimeshift,
} from './unified-live-catchup';
import { createUnifiedLiveChannelRows } from './unified-live-channel-rows';
import { createUnifiedLiveEpgMap } from './unified-live-epg-map';
import { createUnifiedLiveEpgView } from './unified-live-epg-view';
import { createUnifiedLiveRecording } from './unified-live-recording-metadata';
import { createUnifiedLiveSelection } from './unified-live-selection';
import { createUnifiedLiveSelectionGeneration } from './unified-live-selection-generation';
import { createUnifiedLiveSelectionView } from './unified-live-selection-view';

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
        OpenInPlaylistChipComponent,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    providers: [
        // The fullscreen channel panel inside the player renders this
        // collection's list (see the `fullscreenChannelPanel` template).
        {
            provide: FULLSCREEN_CHANNEL_PANEL,
            useExisting: forwardRef(() => UnifiedLiveTabComponent),
        },
    ],
})
export class UnifiedLiveTabComponent implements FullscreenChannelPanelHost {
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
    /** The page is reloading the list; dim the rail but never the player. */
    readonly reloading = input(false);
    /** The rail is owned by the page header toggle; ask it to expand. */
    readonly restoreSidebarRequested = output<void>();

    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly destroyRef = inject(DestroyRef);
    private readonly translate = inject(TranslateService);
    private readonly router = inject(Router);
    private readonly portalPlayer = inject(PORTAL_PLAYER);

    readonly supportsEpg = this.runtime.supportsEpg;

    private readonly fullscreenChannelPanelTemplate = viewChild<
        TemplateRef<FullscreenChannelPanelContext>
    >('fullscreenChannelPanel');
    /** FULLSCREEN_CHANNEL_PANEL: this collection's channels, unless opted out. */
    readonly panelTemplate = computed(() =>
        this.settingsStore.fullscreenChannelPanel?.() === false
            ? null
            : (this.fullscreenChannelPanelTemplate() ?? null)
    );
    readonly panelTitle = computed(() =>
        this.translate.instant(
            this.mode() === 'favorites'
                ? 'HOME.PLAYLISTS.GLOBAL_FAVORITES'
                : 'PORTALS.SIDEBAR.RECENT'
        )
    );

    readonly activeDetail = signal<ResolvedLiveCollectionDetail | null>(null);
    readonly activeUid = signal<string | null>(null);
    /** Full collection item for the active selection — used to read
     *  portal archive fields (tvArchive/tvArchiveDuration) and to
     *  supply credentials for Xtream catch-up URL resolution. */
    readonly activeItem = signal<UnifiedCollectionItem | null>(null);
    readonly isSelecting = signal(false);
    /** Catch-up override for the active channel; null = live playback. */
    readonly activeTimeshift = signal<UnifiedLiveTimeshift | null>(null);
    readonly progressTick = signal(0);
    private readonly generation = createUnifiedLiveSelectionGeneration();

    private readonly view = createUnifiedLiveSelectionView({
        activeItem: this.activeItem,
        activeDetail: this.activeDetail,
        activeTimeshift: this.activeTimeshift,
    });
    readonly inlinePlayback = this.view.inlinePlayback;
    readonly currentStreamUrl = this.view.currentStreamUrl;
    readonly inlinePlayer = this.view.inlinePlayer;
    readonly shouldUseInlinePlayer = this.view.shouldUseInlinePlayer;
    readonly activeRadioChannel = this.view.activeRadioChannel;
    readonly isRadioSelection = this.view.isRadioSelection;
    readonly archiveContextKey = this.view.archiveContextKey;
    readonly openInPlaylistTarget = this.view.openInPlaylistTarget;
    readonly openInPlaylistName = this.view.openInPlaylistName;
    readonly playbackSessionKey = this.view.playbackSessionKey;

    private readonly catchup = createUnifiedLiveCatchup({
        activeTimeshift: this.activeTimeshift,
        activeItem: this.activeItem,
        activeDetail: this.activeDetail,
        isM3uSelection: this.view.isM3uSelection,
        currentM3uChannel: this.view.currentM3uChannel,
        shouldUseInlinePlayer: this.view.shouldUseInlinePlayer,
        generation: this.generation,
    });
    readonly activeTimeshiftProgram = this.catchup.activeProgram;

    private readonly epgView = createUnifiedLiveEpgView({
        activeDetail: this.activeDetail,
        activeItem: this.activeItem,
        activeTimeshift: this.activeTimeshift,
        isM3uSelection: this.view.isM3uSelection,
        currentM3uChannel: this.view.currentM3uChannel,
        currentM3uPrograms: this.view.currentM3uPrograms,
        currentPortalEpgItems: this.view.currentPortalEpgItems,
        progressTick: this.progressTick,
    });
    readonly epgViewMode = this.epgView.viewMode;
    readonly epgOffsetMinutes = this.epgView.offsetMinutes;
    readonly selectedLiveEpgDate = this.epgView.selectedDate;
    readonly isLiveEpgPanelCollapsed = this.epgView.isPanelCollapsed;
    readonly liveEpgPanelSummary = this.epgView.panelSummary;
    readonly liveEpgPanelSummaryLabelKey = this.epgView.panelSummaryLabelKey;
    readonly timelinePrograms = this.epgView.timelinePrograms;
    readonly timelineChannelName = this.epgView.timelineChannelName;
    readonly timelineChannelLogo = this.epgView.timelineChannelLogo;
    readonly timelineArchiveAvailable = this.epgView.timelineArchiveAvailable;
    readonly timelineArchiveDays = this.epgView.timelineArchiveDays;

    private readonly recording = createUnifiedLiveRecording({
        activeItem: this.activeItem,
        timelinePrograms: this.epgView.timelinePrograms,
        timelineChannelLogo: this.epgView.timelineChannelLogo,
        epgOffsetMinutes: this.epgView.offsetMinutes,
        progressTick: this.progressTick,
    });
    readonly recordingMetadata = this.recording.metadata;

    private readonly epgPrograms = createUnifiedLiveEpgMap({
        supportsEpg: this.supportsEpg,
        items: this.items,
        offsetMinutes: this.epgView.offsetMinutes,
    });
    readonly epgMap = this.epgPrograms.programs;

    private readonly selection = createUnifiedLiveSelection({
        activeUid: this.activeUid,
        activeItem: this.activeItem,
        activeDetail: this.activeDetail,
        activeTimeshift: this.activeTimeshift,
        isSelecting: this.isSelecting,
        generation: this.generation,
        supportsEpg: this.supportsEpg,
        isRadioDetail: (detail) => this.view.isRadioDetail(detail),
        shouldOpenExternalPlayback: (detail, startPlayback) =>
            this.view.shouldOpenExternalPlayback(detail, startPlayback),
        onItemPlayed: (item) => this.itemPlayed.emit(item),
        onAutoOpenHandled: () => this.autoOpenHandled.emit(),
    });

    private readonly channelRows = createUnifiedLiveChannelRows({
        items: this.items,
        searchTerm: this.searchTerm,
        mode: this.mode,
        sortMode: this.sortMode,
    });
    readonly channelsForList = this.channelRows.all;
    readonly visibleChannels = this.channelRows.visible;
    readonly fullscreenPanelChannels = this.channelRows.fullscreenPanel;

    constructor() {
        effect(() => {
            const items = this.items();
            if (this.supportsEpg) {
                this.epgPrograms.load(items);
            } else {
                this.epgPrograms.clear();
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

            // Handled only once the row is on screen: while it is merely the
            // pending highlight, `activeDetail` still belongs to the retained
            // stream, and `activate` folds this intent into the request in
            // flight instead of restarting it.
            if (
                this.activeUid() === matchedItem.uid &&
                this.activeItem()?.uid === matchedItem.uid &&
                this.activeDetail()
            ) {
                this.autoOpenHandled.emit();
                return;
            }

            void this.selection.activate(matchedItem, true);
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
            this.selection.dispose();
        });
    }

    async onChannelSelected(channel: UnifiedFavoriteChannel): Promise<void> {
        const item = this.itemFor(channel);
        if (item) {
            await this.selection.activate(item);
        }
    }

    async onChannelPlaybackRequested(
        channel: UnifiedFavoriteChannel
    ): Promise<void> {
        const item = this.itemFor(channel);
        if (item) {
            await this.selection.activate(item, false, true);
        }
    }

    onFavoriteToggled(channel: UnifiedFavoriteChannel): void {
        const item = this.itemFor(channel);
        if (!item) {
            return;
        }

        if (this.mode() === 'favorites') {
            this.removeItem.emit(item);
        } else {
            this.favoriteToggled.emit(item);
        }
    }

    openActiveItemInPlaylist(): void {
        const item = this.activeItem();
        if (item) {
            this.openInPlaylist(item);
        }
    }

    onOpenInPlaylistRequested(channel: UnifiedFavoriteChannel): void {
        const item = this.itemFor(channel);
        if (item) {
            this.openInPlaylist(item);
        }
    }

    onRemoveRequested(channel: UnifiedFavoriteChannel): void {
        const item = this.itemFor(channel);
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
        this.epgView.setPanelCollapsed(collapsed);
    }

    onLiveEpgDateNavigation(direction: EpgDateNavigationDirection): void {
        this.epgView.navigateDate(direction);
    }

    onLiveEpgSelectedDateChange(selectedDate: string): void {
        this.epgView.selectDate(selectedDate);
    }

    onTimelineProgramActivated(event: EpgProgramActivationEvent): void {
        this.catchup.handleProgramActivation(event);
    }

    returnToLivePlayback(): void {
        this.catchup.returnToLive();
    }

    /** Stop enrichment: programs overlapping the recorded window. */
    onRecordingStopped(event: RecordingStoppedEvent): void {
        this.recording.handleRecordingStopped(event);
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
        this.selection.close();
    }

    onEpgMappingChanged(): void {
        this.epgPrograms.load(this.items());
    }

    private openInPlaylist(item: UnifiedCollectionItem): void {
        const target = getLiveCollectionPlaylistNavigation(item);
        if (target) {
            void this.router.navigate(target.link, { state: target.state });
        }
    }

    /** The collection row the rendered channel row stands for. */
    private itemFor(
        channel: UnifiedFavoriteChannel
    ): UnifiedCollectionItem | undefined {
        return this.items().find((candidate) => candidate.uid === channel.uid);
    }
}
