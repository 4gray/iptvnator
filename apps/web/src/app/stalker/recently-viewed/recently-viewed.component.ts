import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from 'services';
import {
    VodDetailsItem,
} from 'shared-interfaces';
import { FavoritesLayoutComponent } from '../../shared/components/favorites-layout/favorites-layout.component';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';
import { createLogger } from '../../shared/utils/logger';
import {
    StalkerSelectedVodItem,
    StalkerVodSource,
} from '../models';
import {
    createPortalCollectionResource,
    createPortalFavoritesResource,
    toggleStalkerVodFavorite,
    clearStalkerDetailViewState,
    createStalkerDetailViewState,
    createRefreshTrigger,
    normalizeStalkerVodDetailsItem,
    isSelectedStalkerVodFavorite,
} from '../stalker-vod.utils';

@Component({
    selector: 'app-recently-viewed',
    templateUrl: './recently-viewed.component.html',
    imports: [
        FavoritesLayoutComponent,
        StalkerSeriesViewComponent,
        VodDetailsComponent,
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
    private readonly playlistService = inject(PlaylistsService);
    private readonly collectionRefresh = createRefreshTrigger();
    private readonly favoritesRefresh = createRefreshTrigger();
    private readonly stalkerStore = inject(StalkerStore);
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerRecentlyViewed');

    itemDetails: (StalkerVodSource & { category_id?: string }) | null = null;
    vodDetailsItem: VodDetailsItem | null = null;
    readonly isSelectedVodFavorite = signal<boolean>(false);

    readonly currentPlaylist = this.stalkerStore.currentPlaylist;

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

    readonly categories = computed(() => [
        {
            id: 1,
            category_id: 'movie',
            category_name:
                this.translate.instant('PORTALS.SIDEBAR.MOVIES') +
                ' (' +
                (this.movies()?.length ?? 0) +
                ')',
            parent_id: 0,
        },
        {
            id: 2,
            category_id: 'itv',
            category_name:
                this.translate.instant('PORTALS.SIDEBAR.LIVE_TV') +
                ' (' +
                (this.live()?.length ?? 0) +
                ')',
            parent_id: 0,
        },
        {
            id: 3,
            category_id: 'series',
            category_name:
                this.translate.instant('PORTALS.SIDEBAR.SERIES') +
                ' (' +
                (this.series()?.length ?? 0) +
                ')',
            parent_id: 0,
        },
    ]);

    readonly itemsToShow = computed(() => {
        switch (this.selectedCategoryId()) {
            case 'movie':
                return this.movies();
            case 'itv':
                return this.live();
            case 'series':
                return this.series();
            default:
                return [];
        }
    });

    readonly selectedCategoryId = signal<string>('movie');

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
            const playlist = this.currentPlaylist();
            if (!playlist?._id) return;

            const state = this.router.getCurrentNavigation()?.extras?.state
                ?? window.history.state;
            const item = state?.openRecentItem;
            if (!item || !RecentlyViewedComponent.isCategoryType(item.category_id)) {
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
        this.selectedCategoryId.set(categoryId);
    }

    openItem(item: StalkerVodSource & { category_id: string }) {
        if (!RecentlyViewedComponent.isCategoryType(item.category_id)) {
            return;
        }

        this.stalkerStore.setSelectedContentType(item.category_id);
        switch (item.category_id) {
            case 'itv':
                this.createLinkToPlayVodItv(item.cmd, item.o_name || item.name, item.logo);
                break;
            case 'vod':
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
            case 'series':
                this.itemDetails = item;
                this.stalkerStore.setSelectedItem(item);
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
    onVodFavoriteToggled(event: { item: VodDetailsItem; isFavorite: boolean }): void {
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
    private normalizeRecentItem(item: StalkerVodSource): StalkerSelectedVodItem {
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
}
