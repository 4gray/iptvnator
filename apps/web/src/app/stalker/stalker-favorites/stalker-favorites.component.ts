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
import { queryParamSignal } from '../../shared/navigation/portal-route.utils';
import { createPortalCollectionContext } from '../../shared/utils/portal-collection-context';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '../../shared/utils/portal-collection-items';
import { createLogger } from '../../shared/utils/logger';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { StalkerFavoriteItem } from '../models';
import {
    clearStalkerDetailViewState,
    createStalkerInlineDetailState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    isSelectedStalkerVodFavorite,
    NormalizedStalkerFavoriteItem,
    normalizeStalkerEntityId,
    normalizeStalkerFavoriteItem,
    toggleStalkerVodFavorite,
} from '../stalker-vod.utils';
import { StalkerStore } from '../stalker.store';

const STALKER_FAVORITES_LAYOUT: PortalCollectionShellLayout = {};

@Component({
    selector: 'app-stalker-favorites',
    templateUrl: './stalker-favorites.component.html',
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
export class StalkerFavoritesComponent {
    private static isCategoryType(
        value: unknown
    ): value is 'vod' | 'series' | 'itv' {
        const normalized = String(value ?? '').toLowerCase();
        return (
            normalized === 'vod' ||
            normalized === 'series' ||
            normalized === 'itv'
        );
    }

    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly playlistService = inject(PlaylistsService);
    private readonly favoritesRefresh = createRefreshTrigger();
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerFavorites');
    private readonly favoritesCtx = inject(FavoritesContextService);

    itemDetails: NormalizedStalkerFavoriteItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;
    readonly isSelectedVodFavorite = signal<boolean>(false);

    readonly currentPlaylist = this.stalkerStore.currentPlaylist;
    readonly layout = STALKER_FAVORITES_LAYOUT;
    readonly playlistSubtitle = 'Stalker Portal';
    readonly playlistTitle = computed(
        () => this.currentPlaylist()?.title || 'Portal'
    );

    readonly allFavorites = createPortalFavoritesResource(
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

    readonly favoritesToShow = computed(() => {
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
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim().toLowerCase()
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
            this.allFavorites.value();
            this.syncSelectedVodFavorite();
        });

        effect(() => {
            const playlist = this.currentPlaylist();
            if (!playlist?._id) {
                return;
            }

            const state =
                this.router.currentNavigation()?.extras?.state ??
                window.history.state;
            const item = state?.openFavoriteItem;
            if (
                !item ||
                !StalkerFavoritesComponent.isCategoryType(item.category_id)
            ) {
                return;
            }

            this.openItem(item);

            try {
                window.history.replaceState({}, document.title);
            } catch {
                // no-op
            }
        });
    }

    removeFromFavorites(
        item: Pick<StalkerFavoriteItem, 'id'>,
        onDone?: () => void
    ) {
        this.stalkerStore.removeFromFavorites(
            normalizeStalkerEntityId(item.id),
            () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
                onDone?.();
            }
        );
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.stalkerStore.addToFavorites(item, () => {
            this.favoritesRefresh.refresh();
            this.syncSelectedVodFavorite();
            onDone?.();
        });
    }

    setCategoryId(categoryId: string) {
        this.collectionContext.setCategoryId(categoryId);
    }

    openItem(item: StalkerFavoriteItem) {
        this.logger.debug('Open item', item);
        const normalizedCategory =
            item.category_id === 'movie' ? 'vod' : item.category_id;
        const itemToOpen = {
            ...item,
            category_id: normalizedCategory,
        } as StalkerFavoriteItem;
        const normalizedItem = normalizeStalkerFavoriteItem(itemToOpen);

        switch (itemToOpen.category_id) {
            case 'itv':
                this.stalkerStore.setSelectedContentType('itv');
                this.createLinkToPlayVodItv(
                    itemToOpen.cmd,
                    itemToOpen.o_name || itemToOpen.name,
                    itemToOpen.logo
                );
                break;
            case 'vod': {
                this.itemDetails = normalizedItem;
                this.stalkerStore.setSelectedItem(normalizedItem.details);
                this.stalkerStore.setSelectedContentType('vod');

                const detailViewState = createStalkerDetailViewState(
                    normalizedItem.details,
                    this.currentPlaylist()?._id ?? ''
                );
                this.itemDetails = {
                    ...normalizedItem,
                    details: detailViewState.itemDetails,
                };
                this.vodDetailsItem = detailViewState.vodDetailsItem;
                this.syncSelectedVodFavorite();
                break;
            }
            case 'series':
                this.itemDetails = normalizedItem;
                this.stalkerStore.setSelectedItem(normalizedItem.details);
                this.stalkerStore.setSelectedContentType('series');
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
                this.removeFromFavorites({ id: favoriteId }, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
            },
        });
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.resetDetailsView(true);
    }

    onSeriesBack(): void {
        this.resetDetailsView(true);
    }

    private resetDetailsView(refreshList: boolean): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = null;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
        if (refreshList) {
            this.favoritesRefresh.refresh();
        }
    }

    private syncSelectedVodFavorite(): void {
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                this.vodDetailsItem,
                this.allFavorites.value() ?? []
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
}
