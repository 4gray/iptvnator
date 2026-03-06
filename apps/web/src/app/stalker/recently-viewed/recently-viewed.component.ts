import {
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from 'services';
import { VodDetailsItem } from 'shared-interfaces';
import {
    PortalCollectionShellComponent,
    PortalCollectionShellLayout,
} from '../../shared/components/portal-collection-shell/portal-collection-shell.component';
import { StalkerInlineDetailComponent } from '../../shared/components/stalker-inline-detail/stalker-inline-detail.component';
import {
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '../../shared/navigation/portal-route.utils';
import { createPortalCollectionContext } from '../../shared/utils/portal-collection-context';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '../../shared/utils/portal-collection-items';
import { createLogger } from '../../shared/utils/logger';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { StalkerSelectedVodItem, StalkerVodSource } from '../models';
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
} from '../stalker-vod.utils';
import { StalkerStore } from '../stalker.store';

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
    imports: [PortalCollectionShellComponent, StalkerInlineDetailComponent],
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
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerRecentlyViewed');
    private readonly favoritesCtx = inject(FavoritesContextService);

    itemDetails: StalkerSelectedVodItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;
    readonly isSelectedVodFavorite = signal<boolean>(false);

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
            textOf: (item: any) => `${item?.name ?? ''} ${item?.o_name ?? ''}`,
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

    constructor() {
        effect(() => {
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
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

    openItem(item: StalkerVodSource & { category_id: string }) {
        if (!RecentlyViewedComponent.isCategoryType(item.category_id)) {
            return;
        }

        this.stalkerStore.setSelectedContentType(item.category_id);
        switch (item.category_id) {
            case 'itv':
                this.createLinkToPlayVodItv(
                    item.cmd,
                    item.o_name || item.name,
                    item.logo
                );
                break;
            case 'vod': {
                // Normalize the item to ensure is_series flag is properly set
                const normalizedItem = this.normalizeRecentItem(item);
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
                this.itemDetails = this.normalizeRecentItem(item);
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
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = cleared.itemDetails;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
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

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails,
            this.vodDetailsItem
        );
    }

    showDetails() {
        return this.inlineDetail().categoryId !== null;
    }
}
