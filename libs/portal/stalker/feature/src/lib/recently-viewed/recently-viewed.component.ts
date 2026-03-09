import {
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from 'services';
import { EpgItem, VodDetailsItem } from 'shared-interfaces';
import { PortalCollectionLiveShellComponent } from '@iptvnator/portal/shared/ui';
import {
    FavoriteLayoutItem,
    PortalCollectionMode,
    PortalCollectionShellComponent,
    PortalCollectionShellLayout,
} from '@iptvnator/portal/shared/ui';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';
import {
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { createPortalCollectionContext } from '@iptvnator/portal/shared/util';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '@iptvnator/portal/shared/util';
import {
    createLogger,
    FavoritesContextService,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { StalkerSelectedVodItem, StalkerVodSource } from '@iptvnator/portal/stalker/data-access';
import {
    clearStalkerDetailViewState,
    createStalkerInlineDetailState,
    createPortalCollectionResource,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    isSelectedStalkerVodFavorite,
    normalizeStalkerVodDetailsItem,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import { StalkerCollectionChannelsListComponent } from '../stalker-collection-channels-list/stalker-collection-channels-list.component';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';

const STALKER_RECENT_LAYOUT: Omit<
    PortalCollectionShellLayout,
    'showHeaderAction'
> = {
    titleTranslationKey: 'PORTALS.SIDEBAR.RECENT',
    removeTooltip: 'Remove from recent',
    emptyIcon: 'history',
    headerActionIcon: 'delete_sweep',
    headerActionTooltip: 'Clear recently viewed',
};

@Component({
    selector: 'app-recently-viewed',
    templateUrl: './recently-viewed.component.html',
    imports: [
        PortalCollectionLiveShellComponent,
        PortalCollectionShellComponent,
        StalkerCollectionChannelsListComponent,
        StalkerInlineDetailComponent,
        TranslatePipe,
    ],
    styles: [
        `
            :host {
                display: block;
                height: 100%;
                width: 100%;
                position: relative;
            }

            .back-button {
                margin: 10px 0 0 16px;
            }
        `,
    ],
})
export class RecentlyViewedComponent {
    private static isCategoryType(
        value: string
    ): value is 'vod' | 'series' | 'itv' {
        return value === 'vod' || value === 'series' || value === 'itv';
    }
    private readonly route = inject(ActivatedRoute);
    private readonly playlistService = inject(PlaylistsService);
    private readonly collectionRefresh = createRefreshTrigger();
    private readonly favoritesRefresh = createRefreshTrigger();
    private readonly stalkerStore = inject(StalkerStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerRecentlyViewed');
    private readonly favoritesCtx = inject(FavoritesContextService);
    private previousSelectedCategoryId: string | null = null;

    itemDetails: StalkerSelectedVodItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;
    readonly isSelectedVodFavorite = signal<boolean>(false);
    readonly selectedLiveItem = signal<StalkerVodSource | null>(null);
    readonly liveStreamUrl = signal('');
    readonly epgItems = signal<EpgItem[]>([]);
    readonly isLoadingEpg = signal(false);
    readonly hasMoreEpg = signal(false);
    readonly isResolvingPlayback = signal(false);

    readonly currentPlaylist = this.stalkerStore.currentPlaylist;
    readonly playlistSubtitle = 'Stalker Portal';
    readonly playlistTitle = computed(
        () => this.currentPlaylist()?.title || 'Portal'
    );

    readonly allFavorites = createPortalCollectionResource(
        this.playlistService,
        () => this.stalkerStore.currentPlaylist()?._id,
        () => this.collectionRefresh.refreshVersion(),
        (playlistService, portalId) =>
            playlistService.getPortalRecentlyViewed(portalId)
    );
    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.stalkerStore.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly categories = computed(() =>
        buildStandardCollectionCategories({
            labels: {
                all: this.translate.instant('PORTALS.ALL_CATEGORIES'),
                movie: this.translate.instant('PORTALS.SIDEBAR.MOVIES'),
                live: this.translate.instant('PORTALS.SIDEBAR.LIVE_TV'),
                series: this.translate.instant('PORTALS.SIDEBAR.SERIES'),
            },
            counts: {
                all: this.allFavorites.value()?.length ?? 0,
                movie: this.movies()?.length ?? 0,
                live: this.live()?.length ?? 0,
                series: this.series()?.length ?? 0,
            },
            includeLive: true,
            liveCategoryId: 'itv',
        })
    );
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.favoritesCtx,
        categories: this.categories,
    });
    readonly itemsToShow = computed(() => {
        return filterCollectionBucket({
            selectedCategoryId: this.selectedCategoryId(),
            allItems: this.allFavorites.value(),
            buckets: {
                movie: this.movies(),
                live: this.live(),
                series: this.series(),
            },
            searchTerm: this.searchTerm(),
            liveCategoryId: 'itv',
            textOf: (item: StalkerVodSource) =>
                `${item.name ?? ''} ${item.o_name ?? ''}`,
        });
    });

    /** Synced with workspace context service so panel clicks are reactive */
    readonly selectedCategoryId = this.collectionContext.selectedCategoryId;
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    readonly layout: PortalCollectionShellLayout = {
        ...STALKER_RECENT_LAYOUT,
        showHeaderAction: !this.isWorkspaceLayout,
    };
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim().toLowerCase()
    );
    readonly refreshToken = queryParamSignal(
        this.route,
        'refresh',
        (value) => value ?? ''
    );
    readonly liveItemsToShow = computed<
        (StalkerVodSource & { category_id: string })[]
    >(() =>
        ((this.allFavorites.value() ?? []) as (StalkerVodSource & {
            category_id: string;
        })[]).filter((item) => {
            if (item.category_id !== 'itv') {
                return false;
            }

            const term = this.searchTerm();
            if (!term) {
                return true;
            }

            return `${item?.name ?? ''} ${item?.o_name ?? ''}`
                .toLowerCase()
                .includes(term);
        })
    );
    readonly isLiveCategory = computed(() => this.selectedCategoryId() === 'itv');
    readonly isEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    private epgPageSize = 10;
    private epgChannelId: number | string | null = null;

    readonly series = computed(() =>
        this.allFavorites
            .value()
            ?.filter((item) => item.category_id === 'series')
    );
    readonly movies = computed(() =>
        this.allFavorites.value()?.filter((item) => item.category_id === 'vod')
    );
    readonly live = computed(() =>
        this.allFavorites.value()?.filter((item) => item.category_id === 'itv')
    );

    get mode(): PortalCollectionMode {
        if (this.isLiveCategory()) {
            return 'live';
        }

        return this.showDetails() ? 'detail' : 'grid';
    }

    constructor() {
        effect(() => {
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
        });

        effect(() => {
            const selectedCategoryId = this.selectedCategoryId();
            const hasInlineDetail = this.inlineDetail().categoryId !== null;
            const previousCategoryId = this.previousSelectedCategoryId;

            this.previousSelectedCategoryId = selectedCategoryId;

            if (
                hasInlineDetail &&
                previousCategoryId !== null &&
                previousCategoryId !== selectedCategoryId
            ) {
                this.clearDetailsView();
            }
        });

        effect(() => {
            const refresh = this.refreshToken();
            if (!refresh) {
                return;
            }

            this.collectionRefresh.refresh();
        });

        effect(() => {
            const playlist = this.currentPlaylist();
            if (!playlist?._id) return;

            const state =
                this.router.currentNavigation()?.extras?.state ??
                window.history.state;
            const item = state?.openRecentItem;
            if (
                !item ||
                !RecentlyViewedComponent.isCategoryType(item.category_id)
            ) {
                return;
            }

            this.openItem(item);

            // Clear consumed history state to avoid reopening item on reload/back.
            try {
                window.history.replaceState({}, document.title);
            } catch {
                // no-op
            }
        });

        effect(() => {
            const selectedItem = this.selectedLiveItem();
            if (!selectedItem) {
                return;
            }

            const stillExists = this.liveItemsToShow().some(
                (item) => String(item.id ?? '') === String(selectedItem.id ?? '')
            );

            if (!stillExists) {
                this.clearLiveSelection();
            }
        });

        effect(() => {
            if (this.isLiveCategory()) {
                return;
            }

            this.clearLiveSelection();
        });
    }

    removeFromRecentlyViewed(item: Pick<StalkerVodSource, 'id'>) {
        const id = String(item.id ?? '').trim();
        if (!id) return;
        this.stalkerStore.removeFromRecentlyViewed(id, () => {
            this.collectionRefresh.refresh();
        });
    }

    clearAllRecentlyViewed() {
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        if (!playlistId) return;
        this.playlistService.clearPortalRecentlyViewed(playlistId).subscribe({
            next: () => this.collectionRefresh.refresh(),
            error: (error) =>
                this.logger.error(
                    'Failed to clear recently viewed items',
                    error
                ),
        });
    }

    setCategoryId(categoryId: string) {
        this.collectionContext.setCategoryId(categoryId);
    }

    openItem(item: FavoriteLayoutItem) {
        const categoryId = String(item.category_id ?? '');
        if (!RecentlyViewedComponent.isCategoryType(categoryId)) {
            return;
        }

        this.stalkerStore.setSelectedContentType(categoryId);
        switch (categoryId) {
            case 'itv': {
                this.setCategoryId('itv');
                const cleared = clearStalkerDetailViewState();
                this.itemDetails = cleared.itemDetails;
                this.vodDetailsItem = cleared.vodDetailsItem;
                this.isSelectedVodFavorite.set(false);
                void this.selectLiveItem(
                    item as StalkerVodSource & { category_id: string }
                );
                break;
            }
            case 'vod': {
                // Normalize the item to ensure is_series flag is properly set
                const normalizedItem = this.normalizeRecentItem(
                    item as StalkerVodSource & { category_id: string }
                );
                const detailViewState = createStalkerDetailViewState(
                    normalizedItem,
                    this.currentPlaylist()?._id ?? ''
                );
                this.itemDetails = {
                    ...(detailViewState.itemDetails ?? normalizedItem),
                    category_id: 'vod',
                };
                this.vodDetailsItem = detailViewState.vodDetailsItem;
                this.stalkerStore.setSelectedItem(detailViewState.itemDetails);
                this.syncSelectedVodFavorite();
                break;
            }
            case 'series':
                this.itemDetails = this.normalizeRecentItem(
                    item as StalkerVodSource & { category_id: string }
                );
                this.stalkerStore.setSelectedItem(this.itemDetails);
                break;
            default:
                break;
        }
    }

    /** Handle play from vod-details component */
    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            this.createLinkToPlayVodItv(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    /** Handle favorite toggle from vod-details component */
    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) => this.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
            },
        });
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.clearDetailsView();
    }

    async selectLiveItem(item: StalkerVodSource) {
        this.selectedLiveItem.set(item);
        this.liveStreamUrl.set('');
        this.stalkerStore.setSelectedContentType('itv');
        this.stalkerStore.setSelectedItem(item);
        this.isResolvingPlayback.set(true);

        try {
            const playback = await this.stalkerStore.resolveItvPlayback(item);
            await this.loadEpgForChannel(item.id);
            this.liveStreamUrl.set(playback.streamUrl);

            if (!this.isEmbeddedPlayer()) {
                void this.portalPlayer.openResolvedPlayback(playback, true);
            }
        } catch (error) {
            this.logger.error('Failed to resolve ITV playback', error);
            this.showPlaybackError(error);
        } finally {
            this.isResolvingPlayback.set(false);
        }
    }

    async loadMoreEpg() {
        if (!this.epgChannelId || this.isLoadingEpg()) {
            return;
        }

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

    async createLinkToPlayVodItv(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        this.logger.debug('Create link to play VOD/ITV', {
            cmd,
            title,
            thumbnail,
        });
        await this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.stalkerStore.addToFavorites(item, onDone);
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void) {
        this.stalkerStore.removeFromFavorites(favoriteId, onDone);
    }

    toggleLiveFavorite(item: StalkerVodSource): void {
        const itemId = String(item.id ?? '');
        if (this.liveFavoriteIds().has(itemId)) {
            this.removeFromFavorites(itemId);
            return;
        }

        this.addToFavorites({
            ...item,
            category_id: 'itv',
            title: item.o_name || item.name,
            cover: item.logo || item.cover,
            added_at: new Date().toISOString(),
        });
    }

    readonly liveFavoriteIds = computed(() => {
        const ids = new Map<string | number, boolean>();
        for (const item of (this.portalFavorites.value() ?? []) as StalkerVodSource[]) {
            if (item.category_id === 'itv') {
                ids.set(String(item.id ?? ''), true);
            }
        }
        return ids;
    });

    private clearLiveSelection() {
        this.selectedLiveItem.set(null);
        this.liveStreamUrl.set('');
        this.isResolvingPlayback.set(false);
        this.epgItems.set([]);
        this.isLoadingEpg.set(false);
        this.hasMoreEpg.set(false);
        this.epgChannelId = null;
        this.stalkerStore.setSelectedItem(null);
    }

    /**
     * Normalize recent item to ensure is_series flag is properly set
     * and all required fields are present for the series view
     */
    private normalizeRecentItem(
        item: StalkerVodSource
    ): StalkerSelectedVodItem {
        return normalizeStalkerVodDetailsItem(item);
    }

    private syncSelectedVodFavorite(): void {
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                this.vodDetailsItem,
                this.portalFavorites.value() ?? []
            )
        );
    }

    private clearDetailsView(): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = cleared.itemDetails;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
    }

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails,
            this.vodDetailsItem
        );
    }

    showDetails() {
        return this.inlineDetail().categoryId !== null;
    }

    private async loadEpgForChannel(channelId: number | string | undefined) {
        if (channelId === undefined || channelId === null) {
            this.epgItems.set([]);
            this.hasMoreEpg.set(false);
            return;
        }

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

    private showPlaybackError(error: unknown): void {
        const errorMessage =
            error instanceof Error && error.message === 'nothing_to_play'
                ? this.translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                : this.translate.instant('PORTALS.PLAYBACK_ERROR');
        this.snackBar.open(errorMessage, undefined, { duration: 3000 });
    }
}
