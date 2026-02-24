import {
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { PlaylistsService } from 'services';
import { VodDetailsItem } from 'shared-interfaces';
import { FavoritesLayoutComponent } from '../../shared/components/favorites-layout/favorites-layout.component';
import { createLogger } from '../../shared/utils/logger';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { VodDetailsComponent } from '../../xtream-electron/vod-details/vod-details.component';
import { StalkerFavoriteItem } from '../models';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import {
    clearStalkerDetailViewState,
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

@Component({
    selector: 'app-stalker-favorites',
    templateUrl: './stalker-favorites.component.html',
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
export class StalkerFavoritesComponent implements OnDestroy {
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

    readonly allFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.stalkerStore.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly categories = computed(() => [
        {
            id: 1,
            category_id: 'all',
            category_name: this.translate.instant('PORTALS.ALL_CATEGORIES'),
            count: this.allFavorites.value()?.length ?? 0,
            parent_id: 0,
        },
        {
            id: 2,
            category_id: 'movie',
            category_name: this.translate.instant('PORTALS.SIDEBAR.MOVIES'),
            count: this.movies()?.length ?? 0,
            parent_id: 0,
        },
        {
            id: 3,
            category_id: 'itv',
            category_name: this.translate.instant('PORTALS.SIDEBAR.LIVE_TV'),
            count: this.live()?.length ?? 0,
            parent_id: 0,
        },
        {
            id: 4,
            category_id: 'series',
            category_name: this.translate.instant('PORTALS.SIDEBAR.SERIES'),
            count: this.series()?.length ?? 0,
            parent_id: 0,
        },
    ]);

    readonly favoritesToShow = computed(() => {
        const term = this.searchTerm();
        const filterByTerm = (items: StalkerFavoriteItem[] | undefined) => {
            if (!items) return [];
            if (!term) return items;

            return items.filter((item) =>
                `${item?.name ?? ''} ${item?.o_name ?? ''}`
                    .toLowerCase()
                    .includes(term)
            );
        };

        switch (this.selectedCategoryId()) {
            case 'all':
                return filterByTerm(this.allFavorites.value());
            case 'movie':
                return filterByTerm(this.movies());
            case 'itv':
                return filterByTerm(this.live());
            case 'series':
                return filterByTerm(this.series());
            default:
                return [];
        }
    });

    /** Synced with workspace context service so panel clicks are reactive */
    readonly selectedCategoryId = this.favoritesCtx.selectedCategoryId;
    readonly searchTerm = toSignal(
        this.route.queryParamMap.pipe(
            map((params) => (params.get('q') ?? '').trim().toLowerCase())
        ),
        { initialValue: '' }
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

        // Keep workspace context panel in sync with categories
        effect(() => {
            this.favoritesCtx.setCategories(this.categories());
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
        this.favoritesCtx.setCategoryId(categoryId);
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

    ngOnDestroy(): void {
        this.favoritesCtx.reset();
    }
}
