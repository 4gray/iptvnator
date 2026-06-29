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
import { TranslatePipe } from '@ngx-translate/core';
import {
    isM3uCatchupPlaybackSupported,
    resolveM3uCatchupUrl,
} from '@iptvnator/shared/m3u-utils';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
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
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import {
    EpgDateNavigationDirection,
    EpgListComponent,
    EpgProgramActivationEvent,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import { PortalEmptyStateComponent } from '../portal-empty-state/portal-empty-state.component';
import {
    AudioPlayerComponent,
    type PlaybackFallbackRequest,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { ResizableDirective } from '@iptvnator/ui/components';
import { PlaylistsService, RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { EpgItem, EpgProgram, Playlist } from '@iptvnator/shared/interfaces';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';
import {
    LiveEpgPanelComponent,
    LiveEpgPanelSummary,
} from '@iptvnator/ui/shared-portals';
import { firstValueFrom } from 'rxjs';

@Component({
    selector: 'app-unified-live-tab',
    templateUrl: './unified-live-tab.component.html',
    styleUrl: './unified-live-tab.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AudioPlayerComponent,
        EpgListComponent,
        GlobalFavoritesListComponent,
        LiveEpgPanelComponent,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
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

    private readonly streamResolver = inject(StreamResolverService);
    private readonly recentData = inject(UnifiedRecentDataService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly destroyRef = inject(DestroyRef);
    private readonly xtreamUrlService = inject(XtreamUrlService);
    private readonly playlistsService = inject(PlaylistsService);

    /** Tracks the item whose detail is currently loaded for catchup lookups. */
    private readonly activeItem = signal<UnifiedCollectionItem | null>(null);

    readonly player = this.settingsStore.player;
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly isEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );

    readonly activeDetail = signal<ResolvedLiveCollectionDetail | null>(null);
    readonly activeUid = signal<string | null>(null);
    readonly isSelecting = signal(false);
    readonly epgMap = signal<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = signal(0);
    readonly liveEpgPanelState = signal<LiveEpgPanelState>(
        restoreLiveEpgPanelState()
    );
    readonly selectedLiveEpgDate = signal(getTodayEpgDateKey());
    readonly currentStreamUrl = computed(
        () => this.activeDetail()?.playback.streamUrl ?? ''
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
    /** Portal EPG items converted to EpgProgram for the interactive list component. */
    readonly currentPortalEpgPrograms = computed<EpgProgram[]>(() =>
        this.currentPortalEpgItems().map((item) => ({
            start: item.start,
            stop: item.stop ?? item.end,
            channel: item.channel_id ?? item.id,
            title: item.title,
            desc: item.description ?? null,
            category: null,
            startTimestamp: this.parseEpgTimestamp(item.start_timestamp),
            stopTimestamp: this.parseEpgTimestamp(item.stop_timestamp),
        }))
    );
    /** Archive window (days) for the selected portal stream, or 0 if unavailable. */
    readonly currentPortalArchiveDays = computed(() => {
        const item = this.activeItem();
        if (!item?.xtreamId) return 0;
        // Match the all-channels detection: explicit 0 means no archive.
        if (item.tvArchive === 0) return 0;
        // Items that have a stored duration get that window; everything
        // else (no tv_archive data in the DB) gets 0 so the EPG matches
        // the all-channels view's "history but no catchup" notice.
        if (item.tvArchiveDuration != null && item.tvArchiveDuration !== 0) {
            return Math.max(0, Number(item.tvArchiveDuration));
        }
        return 0;
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
    readonly liveEpgPanelSummary = computed(() => {
        this.progressTick();
        return this.getLiveEpgPanelSummary(this.activeDetail());
    });

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
            xtreamId: item.xtreamId,
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

        const tickInterval = setInterval(
            () => this.progressTick.update((tick) => tick + 1),
            30_000
        );
        this.destroyRef.onDestroy(() => clearInterval(tickInterval));
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

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }

    async onProgramActivated(event: EpgProgramActivationEvent): Promise<void> {
        const detail = this.activeDetail();
        const item = this.activeItem();
        if (!detail) {
            return;
        }

        if (event.type === 'live') {
            const originalDetail = item
                ? await this.streamResolver.resolveLiveDetail(item)
                : null;
            if (originalDetail) {
                this.activeDetail.set(originalDetail);
            }
            return;
        }

        // Timeshift / catchup — M3U path
        if (detail.epgMode === 'm3u' && detail.channel) {
            const catchupUrl = resolveM3uCatchupUrl(
                detail.channel,
                event.program
            );
            if (catchupUrl) {
                this.activeDetail.set({
                    ...detail,
                    playback: {
                        ...detail.playback,
                        streamUrl: catchupUrl,
                        isLive: false,
                    },
                });
            }
            return;
        }

        // Timeshift / catchup — Xtream (portal) path
        if (!item?.xtreamId) {
            return;
        }

        try {
            const credentials = await this.getXtreamCredentials(
                item.playlistId
            );
            if (!credentials) {
                return;
            }

            const startTimestamp = this.parseEpochSeconds(
                event.program.startTimestamp,
                event.program.start
            );
            const stopTimestamp = this.parseEpochSeconds(
                event.program.stopTimestamp,
                event.program.stop
            );
            if (startTimestamp == null || stopTimestamp == null) {
                return;
            }

            const catchupUrl = await this.xtreamUrlService.resolveCatchupUrl(
                item.playlistId,
                credentials,
                item.xtreamId,
                startTimestamp,
                stopTimestamp
            );
            if (catchupUrl) {
                this.activeDetail.set({
                    ...detail,
                    playback: {
                        ...detail.playback,
                        streamUrl: catchupUrl,
                        isLive: false,
                    },
                });
            }
        } catch {
            // Keep current playback going if catchup fails.
        }
    }

    onClose(): void {
        this.selectionRequestId += 1;
        this.isSelecting.set(false);
        this.activeDetail.set(null);
        this.activeUid.set(null);
        this.activeItem.set(null);
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
        this.activeDetail.set(null);
        this.isSelecting.set(true);
        this.activeItem.set(item);

        try {
            const detail =
                item.sourceType === 'm3u'
                    ? await this.streamResolver.resolveM3uPlaybackDetail(item)
                    : await this.streamResolver.resolveLiveDetail(item);
            if (requestId !== this.selectionRequestId) {
                return;
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

    private getLiveEpgPanelSummary(
        detail: ResolvedLiveCollectionDetail | null
    ): LiveEpgPanelSummary | null {
        if (!detail) {
            return null;
        }

        if (detail.epgMode === 'm3u') {
            return this.toLiveEpgPanelSummary(
                this.findCurrentM3uProgram(detail.epgPrograms ?? [])
            );
        }

        return this.toLiveEpgPanelSummary(
            this.findCurrentPortalProgram(detail.epgItems ?? [])
        );
    }

    private findCurrentM3uProgram(
        programs: readonly EpgProgram[]
    ): EpgProgram | null {
        const now = Date.now();
        return (
            programs.find((program) => {
                const start = this.getProgramTimeMs(
                    program.start,
                    program.startTimestamp
                );
                const stop = this.getProgramTimeMs(
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

    private findCurrentPortalProgram(
        programs: readonly EpgItem[]
    ): EpgItem | null {
        const now = Date.now();
        return (
            programs.find((program) => {
                const start = this.getProgramTimeMs(
                    program.start,
                    program.start_timestamp
                );
                const stop = this.getProgramTimeMs(
                    program.stop ?? program.end,
                    program.stop_timestamp
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

    private toLiveEpgPanelSummary(
        program: EpgItem | EpgProgram | null | undefined
    ): LiveEpgPanelSummary | null {
        if (!program) {
            return null;
        }

        return {
            title: program.title,
            start: program.start,
            stop: program.stop ?? ('end' in program ? program.end : null),
        };
    }

    private getProgramTimeMs(
        rawDate: string | null | undefined,
        rawTimestamp?: number | string | null
    ): number | null {
        const timestamp = Number.parseInt(String(rawTimestamp ?? ''), 10);
        if (Number.isFinite(timestamp) && timestamp > 0) {
            return timestamp * 1000;
        }

        const parsedDate = Date.parse(rawDate ?? '');
        return Number.isFinite(parsedDate) ? parsedDate : null;
    }

    private parseEpgTimestamp(
        value: string | undefined
    ): number | undefined {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    private parseEpochSeconds(
        timestamp: number | string | null | undefined,
        fallbackIso: string
    ): number | null {
        const parsed = Number.parseInt(String(timestamp ?? ''), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        const ms = Date.parse(fallbackIso);
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }

    private async getXtreamCredentials(
        playlistId: string
    ): Promise<{
        serverUrl: string;
        username: string;
        password: string;
    } | null> {
        const electronPlaylist =
            typeof window !== 'undefined'
                ? await window.electron?.dbGetAppPlaylist?.(playlistId)
                : null;
        const playlist: Playlist | null =
            electronPlaylist ??
            (await firstValueFrom(
                this.playlistsService.getPlaylistById(playlistId)
            ));

        if (
            !playlist ||
            !playlist.serverUrl ||
            !playlist.username ||
            !playlist.password
        ) {
            return null;
        }

        return {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };
    }
}
