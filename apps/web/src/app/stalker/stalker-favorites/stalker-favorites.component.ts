import { Component, computed, effect, inject, signal } from '@angular/core';
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
    StalkerFavoriteItem,
} from '../models';
import {
    clearStalkerDetailViewState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    normalizeStalkerEntityId,
    NormalizedStalkerFavoriteItem,
    normalizeStalkerFavoriteItem,
    isSelectedStalkerVodFavorite,
    toggleStalkerVodFavorite,
} from '../stalker-vod.utils';

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
export class StalkerFavoritesComponent {
    private readonly playlistService = inject(PlaylistsService);
    private readonly favoritesRefresh = createRefreshTrigger();
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('StalkerFavorites');

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

    readonly favoritesToShow = computed(() => {
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
            this.allFavorites.value();
            this.syncSelectedVodFavorite();
        });
    }

    removeFromFavorites(item: Pick<StalkerFavoriteItem, 'id'>, onDone?: () => void) {
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
        this.selectedCategoryId.set(categoryId);
    }

    openItem(item: StalkerFavoriteItem) {
        this.logger.debug('Open item', item);
        const normalizedItem = normalizeStalkerFavoriteItem(item);

        switch (item.category_id) {
            case 'itv':
                this.stalkerStore.setSelectedContentType('itv');
                this.createLinkToPlayVodItv(item.cmd, item.o_name || item.name, item.logo);
                break;
            case 'vod':
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
    onVodFavoriteToggled(event: { item: VodDetailsItem; isFavorite: boolean }): void {
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
}
