import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    effect,
    ElementRef,
    inject,
    NgZone,
    OnDestroy,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { PlaylistsService } from 'services';
import { EpgItem } from 'shared-interfaces';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';
import { SettingsStore } from '../../services/settings-store.service';
import { PlayerService } from '../../services/player.service';
import { CategoryViewComponent } from '../../xtream-tauri/category-view/category-view.component';
import { PlaylistErrorViewComponent } from '../../xtream/playlist-error-view/playlist-error-view.component';
import { StalkerStore } from '../stalker.store';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';

@Component({
    selector: 'app-stalker-live-stream-layout',
    templateUrl: './stalker-live-stream-layout.component.html',
    styleUrls: [
        './stalker-live-stream-layout.component.scss',
        '../../xtream-tauri/sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        DatePipe,
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
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerLiveStreamLayoutComponent implements OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    private readonly settingsStore = inject(SettingsStore);
    private readonly playlistService = inject(PlaylistsService);
    private readonly playerService = inject(PlayerService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    /** Categories */
    readonly categories = this.stalkerStore.getCategoryResource;
    readonly isCategoryLoading = this.stalkerStore.isCategoryResourceLoading;
    readonly isCategoryFailed = this.stalkerStore.isCategoryResourceFailed;
    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;
    readonly currentPlaylist = this.stalkerStore.currentPlaylist;

    /** Channels */
    readonly itvChannels = this.stalkerStore.itvChannels;
    readonly hasMoreItems = this.stalkerStore.hasMoreChannels;
    readonly isLoadingMore = signal(false);

    /** Search */
    readonly searchString = signal('');

    /** Player */
    readonly player = this.settingsStore.player;
    streamUrl = '';

    /** EPG */
    readonly epgItems = signal<EpgItem[]>([]);
    readonly isLoadingEpg = signal(false);
    readonly hasMoreEpg = signal(false);
    private epgPageSize = 10;
    private epgChannelId: number | string | null = null;

    /** Channel list EPG preview */
    readonly currentPrograms = new Map<number, string>();
    readonly currentProgramsProgress = new Map<number, number>();
    readonly programTimings = new Map<number, { start: number; end: number }>();
    private readonly requestedEpgChannels = new Set<number>();
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);

    /** Favorites */
    readonly favorites = new Map<number, boolean>();

    /** Scroll */
    readonly scrollContainer = viewChild<ElementRef>('scrollContainer');
    private scrollListener: (() => void) | null = null;
    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        // Load favorites for current playlist
        this.playlistService
            .getPortalFavorites(this.stalkerStore.currentPlaylist()?._id)
            .pipe(takeUntilDestroyed())
            .subscribe((favs) => {
                favs.forEach((fav: any) => {
                    this.favorites.set(fav.id, true);
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
            if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                this.stalkerStore.setItvChannels([]);
                this.stalkerStore.setSearchPhrase(search);
            }, 500);
        });
    }

    ngOnDestroy() {
        this.removeScrollListener();
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
    }

    selectCategory(item: { category_name: string; category_id: string }) {
        this.stalkerStore.setSelectedCategory(item.category_id || '*');
        this.stalkerStore.setPage(0);
    }

    backToCategories() {
        this.searchString.set('');
        this.stalkerStore.setSearchPhrase('');
        this.stalkerStore.setSelectedCategory(null);
    }

    async playChannel(item: any) {
        this.stalkerStore.setSelectedItem(item);

        const isEmbeddedPlayer =
            this.player() === 'videojs' ||
            this.player() === 'html5' ||
            this.player() === 'artplayer';

        try {
            const url = await this.stalkerStore.fetchLinkToPlay(
                this.currentPlaylist().portalUrl,
                this.currentPlaylist().macAddress,
                item.cmd
            );

            this.loadEpgForChannel(item.id);

            if (isEmbeddedPlayer) {
                this.streamUrl = url;
            } else {
                this.playerService.openPlayer(
                    url,
                    item.o_name || item.name,
                    item.logo,
                    true,
                    true,
                    this.currentPlaylist()?.userAgent,
                    this.currentPlaylist()?.referrer,
                    this.currentPlaylist()?.origin
                );
            }

            // Add to recently viewed
            this.stalkerStore.addToRecentlyViewed({
                ...item,
                id: item.id,
                cover: item.logo,
                title: item.o_name || item.name,
            });
        } catch (error) {
            console.error('[StalkerLiveStream] Playback failed:', error);
            const errorMessage =
                error?.message === 'nothing_to_play'
                    ? this.translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                    : this.translate.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, null, { duration: 3000 });
        }
    }

    toggleFavorite(item: any) {
        if (this.favorites.has(item.id)) {
            this.stalkerStore.removeFromFavorites(item.id);
            this.favorites.delete(item.id);
        } else {
            this.stalkerStore.addToFavorites({
                ...item,
                category_id: 'itv',
                title: item.o_name || item.name,
                cover: item.logo,
                added_at: new Date().toISOString(),
            });
            this.favorites.set(item.id, true);
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

    private async loadEpgPreviewsForChannels(channels: any[]) {
        const newChannels = channels.filter(
            (ch) => ch.id && !this.requestedEpgChannels.has(ch.id)
        );
        if (newChannels.length === 0) return;

        // Mark all as requested immediately to avoid duplicates
        for (const ch of newChannels) {
            this.requestedEpgChannels.add(ch.id);
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

    private async loadSingleEpgPreview(channelId: number) {
        try {
            const items = await this.stalkerStore.fetchChannelEpg(
                channelId,
                1
            );
            if (items.length > 0) {
                const program = items[0];
                this.currentPrograms.set(channelId, program.title);

                const now = Date.now() / 1000;
                const start = parseInt(program.start_timestamp, 10);
                const end = parseInt(program.stop_timestamp, 10);

                if (start && end && now >= start && now <= end) {
                    const progress =
                        ((now - start) / (end - start)) * 100;
                    this.currentProgramsProgress.set(
                        channelId,
                        progress
                    );
                    this.programTimings.set(channelId, {
                        start: start * 1000,
                        end: end * 1000,
                    });
                }
            }
        } catch {
            // Silently skip — channel just won't show EPG preview
        }
    }

    private clearEpgPreviewMaps() {
        this.currentPrograms.clear();
        this.currentProgramsProgress.clear();
        this.programTimings.clear();
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
}
