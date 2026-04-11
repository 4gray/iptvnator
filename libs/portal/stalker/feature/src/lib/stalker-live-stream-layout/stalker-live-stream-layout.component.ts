import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    OnDestroy,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    ChannelListItemComponent,
    ResizableDirective,
} from 'components';
import { PlaylistsService } from 'services';
import { Channel, EpgItem, EpgProgram } from 'shared-interfaces';
import { EpgListComponent } from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from 'shared-portals';
import {
    PORTAL_PLAYER,
    createLogger,
    getAdjacentChannelItem,
    getChannelItemByNumber,
} from '@iptvnator/portal/shared/util';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    StalkerFavoriteItem,
    StalkerItvChannel,
    StalkerStore,
    normalizeStalkerEntityId,
} from '@iptvnator/portal/stalker/data-access';

@Component({
    selector: 'app-stalker-live-stream-layout',
    templateUrl: './stalker-live-stream-layout.component.html',
    styleUrls: ['./stalker-live-stream-layout.component.scss'],
    imports: [
        ChannelListItemComponent,
        EpgListComponent,
        MatProgressSpinnerModule,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerLiveStreamLayoutComponent implements OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    private readonly playlistService = inject(PlaylistsService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerLiveStream');
    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;

    /** Channels */
    readonly itvChannels = this.stalkerStore.itvChannels;
    readonly searchTerm = computed(() =>
        this.stalkerStore.searchPhrase().trim().toLowerCase()
    );
    readonly visibleChannels = computed(() => {
        const channels = this.itvChannels();
        const term = this.searchTerm();

        if (!term) {
            return channels;
        }

        return channels.filter((item) =>
            `${item.o_name ?? ''} ${item.name ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });
    readonly hasMoreItems = this.stalkerStore.hasMoreChannels;
    readonly isLoadingMore = signal(false);

    readonly selectedChannelId = this.stalkerStore.selectedItvId;
    protected readonly normalizeStalkerEntityId = normalizeStalkerEntityId;

    /** Player */
    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    streamUrl = '';

    /** EPG */
    readonly fallbackEpgPrograms = signal<EpgProgram[]>([]);
    readonly isLoadingFallbackEpg = signal(false);
    readonly activeEpgPrograms = computed(() => {
        const bulkPrograms = this.stalkerStore.selectedItvEpgPrograms();
        return bulkPrograms.length > 0
            ? bulkPrograms
            : this.fallbackEpgPrograms();
    });
    readonly currentProgram = computed(() =>
        this.findCurrentProgram(this.activeEpgPrograms())
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
            url: this.streamUrl || String(selectedItem.cmd ?? ''),
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

    /** Favorites */
    readonly favorites = new Map<string | number, boolean>();

    /** Scroll */
    readonly scrollContainer = viewChild<ElementRef>('scrollContainer');
    private scrollListener: (() => void) | null = null;
    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private epgLoadRequestId = 0;
    private lastPlaylistId: string | null | undefined = undefined;

    constructor() {
        // Load favorites for current playlist
        this.playlistService
            .getPortalFavorites(this.stalkerStore.currentPlaylist()?._id)
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

        // Reset channels/page on category change
        effect(() => {
            this.stalkerStore.selectedCategoryId();
            this.stalkerStore.setItvChannels([]);
            this.stalkerStore.setPage(0);
            this.clearEpgPreviewMaps();
            this.epgLoadRequestId += 1;
            this.fallbackEpgPrograms.set([]);
            this.isLoadingFallbackEpg.set(false);
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

            this.syncBulkEpgPreviews(channels);
        });

        effect(() => {
            const playlistId = this.stalkerStore.currentPlaylist()?._id ?? null;
            if (playlistId === this.lastPlaylistId) {
                return;
            }

            this.lastPlaylistId = playlistId;
            this.epgLoadRequestId += 1;
            this.fallbackEpgPrograms.set([]);
            this.isLoadingFallbackEpg.set(false);
            this.stalkerStore.clearBulkItvEpgCache();
        });

        // Setup scroll listener when container becomes available
        effect(() => {
            const container = this.scrollContainer();
            if (container) {
                this.setupScrollListener();
            }
        });

        effect(() => {
            if (!window.electron?.updateRemoteControlStatus) {
                return;
            }

            const selectedItem = this.stalkerStore.selectedItem();
            const selectedType = this.stalkerStore.selectedContentType();
            const channels = this.visibleChannels();

            if (selectedType !== 'itv' || !selectedItem?.id) {
                window.electron.updateRemoteControlStatus({
                    portal: 'stalker',
                    isLiveView: false,
                    supportsVolume: false,
                });
                return;
            }

            const currentIndex = channels.findIndex(
                (item) => Number(item.id) === Number(selectedItem.id)
            );
            const currentProgram = this.currentProgram();

            window.electron.updateRemoteControlStatus({
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

        if (window.electron?.onChannelChange) {
            const unsubscribe = window.electron.onChannelChange(
                (data: { direction: 'up' | 'down' }) => {
                    this.handleRemoteChannelChange(data.direction);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteChannelChange = unsubscribe;
            }
        }
        if (window.electron?.onRemoteControlCommand) {
            const unsubscribe = window.electron.onRemoteControlCommand(
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
        this.removeScrollListener();
    }

    isSelectedChannel(item: StalkerItvChannel): boolean {
        return (
            this.selectedChannelId() === this.normalizeStalkerEntityId(item.id)
        );
    }

    async playChannel(item: StalkerItvChannel) {
        this.stalkerStore.setSelectedItem(item);

        try {
            const playback = await this.stalkerStore.resolveItvPlayback(item);
            void this.loadEpgForChannel(item);

            if (this.usesEmbeddedPlayer()) {
                this.streamUrl = playback.streamUrl;
            } else {
                void this.portalPlayer.openResolvedPlayback(playback, true);
            }
        } catch (error) {
            this.logger.error('Playback failed', error);
            const errorMessage =
                error?.message === 'nothing_to_play'
                    ? this.translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                    : this.translate.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, null, { duration: 3000 });
        }
    }

    toggleFavorite(item: StalkerItvChannel) {
        const itemId = normalizeStalkerEntityId(item.id);
        if (this.favorites.has(itemId)) {
            this.stalkerStore.removeFromFavorites(itemId);
            this.favorites.delete(itemId);
        } else {
            this.stalkerStore.addToFavorites({
                ...item,
                category_id: 'itv',
                title: item.o_name || item.name,
                cover: item.logo,
                added_at: new Date().toISOString(),
            });
            this.favorites.set(itemId, true);
        }
    }

    loadMore() {
        if (this.isLoadingMore() || !this.hasMoreItems()) return;
        this.isLoadingMore.set(true);
        const nextPage = this.stalkerStore.page() + 1;
        this.stalkerStore.setPage(nextPage);
    }

    private async loadEpgForChannel(item: StalkerItvChannel) {
        const requestId = ++this.epgLoadRequestId;
        const normalizedChannelId = normalizeStalkerEntityId(item.id);
        const playlistId = this.stalkerStore.currentPlaylist()?._id ?? null;
        const shouldEnsureBulk =
            !this.stalkerStore.bulkItvEpgLoaded() ||
            this.stalkerStore.bulkItvEpgPlaylistId() !== playlistId ||
            this.stalkerStore.bulkItvEpgPeriodHours() !== 168;

        this.fallbackEpgPrograms.set([]);
        this.isLoadingFallbackEpg.set(false);

        try {
            if (shouldEnsureBulk) {
                await this.stalkerStore.ensureBulkItvEpg(168);
                if (
                    !this.isCurrentEpgRequest(
                        requestId,
                        normalizedChannelId
                    )
                ) {
                    return;
                }
            }

            if (this.stalkerStore.selectedItvEpgPrograms().length > 0) {
                return;
            }

            this.isLoadingFallbackEpg.set(true);
            const fallbackItems = await this.stalkerStore.fetchChannelEpg(
                item.id
            );
            if (
                !this.isCurrentEpgRequest(requestId, normalizedChannelId)
            ) {
                return;
            }

            this.fallbackEpgPrograms.set(
                fallbackItems.map((epgItem) =>
                    this.toProgram(epgItem, normalizedChannelId)
                )
            );
        } catch (error) {
            this.logger.warn('Failed to load Stalker live EPG', error);
            if (
                this.isCurrentEpgRequest(requestId, normalizedChannelId)
            ) {
                this.fallbackEpgPrograms.set([]);
            }
        } finally {
            if (
                this.isCurrentEpgRequest(requestId, normalizedChannelId)
            ) {
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
        if (
            channels.length === 0 ||
            Object.keys(bulkProgramsByChannel).length === 0
        ) {
            this.cdr.markForCheck();
            return;
        }

        for (const channel of channels) {
            const channelId = normalizeStalkerEntityId(channel.id);
            const currentProgram = this.findCurrentProgram(
                bulkProgramsByChannel[channelId] ?? []
            );

            if (!currentProgram) {
                continue;
            }

            this.epgPreviewPrograms.set(channelId, currentProgram);
            this.updateProgramProgress(channelId, currentProgram);
        }

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
        const nowMs = Date.now();

        if (
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

    private setupScrollListener() {
        this.removeScrollListener();

        const container = this.scrollContainer()?.nativeElement;
        if (!container) return;

        const onScroll = () => {
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

    private toProgram(
        item: EpgItem,
        channelId: string | number
    ): EpgProgram {
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
        const now = Date.now();
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
                return start !== null && stop !== null && now >= start && now < stop;
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

    private handleRemoteChannelChange(direction: 'up' | 'down'): void {
        const activeItem = this.stalkerStore.selectedItem();
        if (!activeItem?.id) {
            return;
        }

        const channels = this.visibleChannels();
        const nextItem = getAdjacentChannelItem(
            channels,
            activeItem.id,
            direction,
            (item) => item.id
        );

        if (!nextItem) {
            return;
        }

        void this.playChannel(nextItem);
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
            this.visibleChannels(),
            command.number
        );
        if (!channel) {
            return;
        }

        void this.playChannel(channel);
    }
}
