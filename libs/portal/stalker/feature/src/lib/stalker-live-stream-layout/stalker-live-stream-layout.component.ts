import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    NgZone,
    OnDestroy,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    ChannelListItemComponent,
    PlaylistSwitcherComponent,
    ResizableDirective,
} from 'components';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { PlaylistsService } from 'services';
import { EpgItem, EpgProgram } from 'shared-interfaces';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';
import {
    PORTAL_PLAYER,
    createLogger,
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isWorkspaceLayoutRoute,
} from '@iptvnator/portal/shared/util';
import {
    CategoryViewComponent,
    PlaylistErrorViewComponent,
    PortalEmptyStateComponent,
} from '@iptvnator/portal/shared/ui';
import {
    StalkerFavoriteItem,
    StalkerItvChannel,
    normalizeStalkerEntityId,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';

@Component({
    selector: 'app-stalker-live-stream-layout',
    templateUrl: './stalker-live-stream-layout.component.html',
    styleUrls: ['./stalker-live-stream-layout.component.scss'],
    imports: [
        CategoryViewComponent,
        ChannelListItemComponent,
        EpgViewComponent,
        FormsModule,
        MatButton,
        MatFormFieldModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatProgressSpinnerModule,
        NgxSkeletonLoaderModule,
        PlaylistErrorViewComponent,
        PlaylistSwitcherComponent,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerLiveStreamLayoutComponent implements OnDestroy {
    private readonly route = inject(ActivatedRoute);
    readonly stalkerStore = inject(StalkerStore);
    private readonly playlistService = inject(PlaylistsService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerLiveStream');

    /** Categories */
    readonly categories = this.stalkerStore.getCategoryResource;
    readonly isCategoryLoading = this.stalkerStore.isCategoryResourceLoading;
    readonly isCategoryFailed = this.stalkerStore.isCategoryResourceFailed;
    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;
    readonly currentPlaylist = this.stalkerStore.currentPlaylist;
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);

    /** Channels */
    readonly itvChannels = this.stalkerStore.itvChannels;
    readonly hasMoreItems = this.stalkerStore.hasMoreChannels;
    readonly isLoadingMore = signal(false);

    /** Search */
    readonly searchString = signal('');
    readonly selectedChannelId = this.stalkerStore.selectedItvId;
    protected readonly normalizeStalkerEntityId = normalizeStalkerEntityId;

    /** Player */
    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    streamUrl = '';

    /** EPG */
    readonly epgItems = signal<EpgItem[]>([]);
    readonly isLoadingEpg = signal(false);
    readonly hasMoreEpg = signal(false);
    private epgPageSize = 10;
    private epgChannelId: number | string | null = null;

    /** Channel list EPG preview */
    readonly epgPreviewPrograms = new Map<string | number, EpgProgram>();
    readonly currentProgramsProgress = new Map<string | number, number>();
    private readonly requestedEpgChannels = new Set<string | number>();
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);

    /** Favorites */
    readonly favorites = new Map<string | number, boolean>();

    /** Scroll */
    readonly scrollContainer = viewChild<ElementRef>('scrollContainer');
    private scrollListener: (() => void) | null = null;
    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;

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
        });

        // Reset loading state when channels load + check viewport fill + load EPG previews
        effect(() => {
            const channels = this.itvChannels();
            if (channels.length > 0) {
                this.isLoadingMore.set(false);
                setTimeout(() => this.checkIfNeedsMoreContent(), 100);
                this.loadEpgPreviewsForChannels(channels);
            }
        });

        // Setup scroll listener when container becomes available
        effect(() => {
            const container = this.scrollContainer();
            if (container) {
                this.setupScrollListener();
            }
        });

        // Debounced server-side search
        effect(() => {
            const search = this.searchString();
            if (this.searchDebounceTimer)
                clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                this.stalkerStore.setItvChannels([]);
                this.stalkerStore.setSearchPhrase(search);
            }, 500);
        });

        effect(() => {
            if (!window.electron?.updateRemoteControlStatus) {
                return;
            }

            const selectedItem = this.stalkerStore.selectedItem();
            const selectedType = this.stalkerStore.selectedContentType();
            const channels = this.itvChannels();
            const epgItems = this.epgItems();

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
            const currentProgram = epgItems?.[0];

            window.electron.updateRemoteControlStatus({
                portal: 'stalker',
                isLiveView: true,
                channelName: selectedItem.o_name || selectedItem.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: currentProgram?.title,
                epgStart: currentProgram?.start,
                epgEnd: currentProgram?.end,
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
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
    }

    selectCategory(item: { category_id?: string | number }) {
        this.stalkerStore.setSelectedCategory(String(item.category_id ?? '*'));
        this.stalkerStore.setPage(0);
    }

    backToCategories() {
        this.searchString.set('');
        this.stalkerStore.setSearchPhrase('');
        this.stalkerStore.setSelectedCategory(null);
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

            this.loadEpgForChannel(item.id);

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

    async loadMoreEpg() {
        if (!this.epgChannelId || this.isLoadingEpg()) return;
        this.epgPageSize += 10;
        this.isLoadingEpg.set(true);
        try {
            const items = await this.stalkerStore.fetchChannelEpg(
                this.epgChannelId,
                this.epgPageSize
            );
            this.epgItems.set(items);
            this.hasMoreEpg.set(items.length >= this.epgPageSize);
        } catch {
            this.hasMoreEpg.set(false);
        } finally {
            this.isLoadingEpg.set(false);
        }
    }

    private async loadEpgForChannel(channelId: number | string) {
        this.epgChannelId = channelId;
        this.epgPageSize = 10;
        this.isLoadingEpg.set(true);
        this.epgItems.set([]);
        this.hasMoreEpg.set(false);
        try {
            const items = await this.stalkerStore.fetchChannelEpg(
                channelId,
                this.epgPageSize
            );
            this.epgItems.set(items);
            this.hasMoreEpg.set(items.length >= this.epgPageSize);
        } catch {
            this.epgItems.set([]);
        } finally {
            this.isLoadingEpg.set(false);
        }
    }

    private async loadEpgPreviewsForChannels(channels: StalkerItvChannel[]) {
        const newChannels = channels.filter(
            (ch) =>
                ch.id &&
                !this.requestedEpgChannels.has(normalizeStalkerEntityId(ch.id))
        );
        if (newChannels.length === 0) return;

        // Mark all as requested immediately to avoid duplicates
        for (const ch of newChannels) {
            this.requestedEpgChannels.add(normalizeStalkerEntityId(ch.id));
        }

        // Process in batches of 3 with a small delay between batches
        const batchSize = 3;
        for (let i = 0; i < newChannels.length; i += batchSize) {
            const batch = newChannels.slice(i, i + batchSize);
            await Promise.all(
                batch.map((ch) => this.loadSingleEpgPreview(ch.id))
            );
            // Re-enter Angular zone to trigger change detection for OnPush
            this.ngZone.run(() => this.cdr.markForCheck());
            // Small delay between batches to avoid overwhelming the portal
            if (i + batchSize < newChannels.length) {
                await new Promise((r) => setTimeout(r, 150));
            }
        }
    }

    private async loadSingleEpgPreview(channelId: number | string) {
        try {
            const items = await this.stalkerStore.fetchChannelEpg(channelId, 1);
            if (items.length > 0) {
                const program = items[0];
                const id = normalizeStalkerEntityId(channelId);
                this.epgPreviewPrograms.set(
                    id,
                    this.toPreviewProgram(program, id)
                );

                const now = Date.now() / 1000;
                const start = parseInt(program.start_timestamp, 10);
                const end = parseInt(program.stop_timestamp, 10);

                if (start && end && now >= start && now <= end) {
                    const progress = ((now - start) / (end - start)) * 100;
                    this.currentProgramsProgress.set(id, progress);
                } else {
                    this.currentProgramsProgress.delete(id);
                }
            }
        } catch {
            // Silently skip — channel just won't show EPG preview
        }
    }

    private clearEpgPreviewMaps() {
        this.epgPreviewPrograms.clear();
        this.currentProgramsProgress.clear();
        this.requestedEpgChannels.clear();
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

    private toPreviewProgram(
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
        };
    }

    private handleRemoteChannelChange(direction: 'up' | 'down'): void {
        const activeItem = this.stalkerStore.selectedItem();
        if (!activeItem?.id) {
            return;
        }

        const channels = this.itvChannels();
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
            this.itvChannels(),
            command.number
        );
        if (!channel) {
            return;
        }

        void this.playChannel(channel);
    }
}
