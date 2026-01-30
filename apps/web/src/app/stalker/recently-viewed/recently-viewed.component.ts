import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistsService } from 'services';
import {
    VodDetailsItem,
    StalkerVodDetails,
    createStalkerVodItem,
} from 'shared-interfaces';
import { FavoritesLayoutComponent } from '../../shared/components/favorites-layout/favorites-layout.component';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';

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
    private readonly playlistService = inject(PlaylistsService);
    private readonly refreshTimestamp = signal<number>(Date.now());
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);

    itemDetails: any = null;
    vodDetailsItem: VodDetailsItem | null = null;

    readonly currentPlaylist = this.stalkerStore.currentPlaylist;

    readonly allFavorites = rxResource({
        params: () => ({
            refreshTimestamp: this.refreshTimestamp(),
        }),
        stream: () =>
            this.playlistService.getPortalRecentlyViewed(
                this.stalkerStore.currentPlaylist()?._id
            ),
    });

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

    removeFromRecentlyViewed(item: any) {
        this.stalkerStore.removeFromRecentlyViewed(item.id);
        setTimeout(() => {
            this.refreshTimestamp.set(Date.now());
        }, 100);
    }

    setCategoryId(categoryId: any) {
        this.selectedCategoryId.set(categoryId);
    }

    openItem(item: any) {
        this.stalkerStore.setSelectedContentType(item.category_id);
        switch (item.category_id) {
            case 'itv':
                this.createLinkToPlayVodItv(item.cmd, item.name, item.logo);
                break;
            case 'vod':
                // Normalize the item to ensure is_series flag is properly set
                const normalizedItem = this.normalizeRecentItem(item);
                this.itemDetails = normalizedItem;
                this.stalkerStore.setSelectedItem(normalizedItem);

                // Check if this VOD item is actually a series (Ministra is_series=1)
                const isVodSeries =
                    normalizedItem.is_series === true ||
                    normalizedItem.series?.length > 0;

                if (isVodSeries) {
                    // VOD series - will be rendered as series view
                    this.vodDetailsItem = null;
                } else {
                    // Regular VOD - create VodDetailsItem for the component
                    this.vodDetailsItem = createStalkerVodItem(
                        normalizedItem as StalkerVodDetails,
                        this.currentPlaylist()?._id ?? ''
                    );
                }
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
        if (event.item.type === 'stalker') {
            if (event.isFavorite) {
                this.removeFromFavorites(event.item.data.id);
            } else {
                this.addToFavorites({
                    ...event.item.data,
                    category_id: 'vod',
                    title: event.item.data.info?.name,
                    cover: event.item.data.info?.movie_image,
                    added_at: new Date().toISOString(),
                });
            }
        }
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.itemDetails = null;
        this.vodDetailsItem = null;
    }

    async createLinkToPlayVodItv(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        console.debug('Create link to play VOD/ITV', cmd, title, thumbnail);
        await this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }

    addToFavorites(item: any) {
        this.stalkerStore.addToFavorites(item);
    }

    removeFromFavorites(favoriteId: string) {
        this.stalkerStore.removeFromFavorites(favoriteId);
    }

    /**
     * Normalize recent item to ensure is_series flag is properly set
     * and all required fields are present for the series view
     */
    private normalizeRecentItem(item: any): any {
        // Normalize is_series to boolean true (can be 1, "1", or true)
        const rawIsSeries = item.is_series;
        const normalizedIsSeries =
            rawIsSeries === true ||
            rawIsSeries === 1 ||
            rawIsSeries === '1';

        // Ensure info object exists
        const info = item.info || {
            name: item.name || item.title || 'Unknown',
            movie_image: item.cover || item.screenshot_uri || item.logo,
            description: item.description,
        };

        return {
            ...item,
            info: info,
            is_series: normalizedIsSeries ? true : undefined,
            // Preserve video_id for season fetching
            video_id: item.video_id,
        };
    }
}
