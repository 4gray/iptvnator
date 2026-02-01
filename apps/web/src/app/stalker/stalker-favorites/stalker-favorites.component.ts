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
            this.playlistService.getPortalFavorites(
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

    removeFromFavorites(item: any) {
        this.stalkerStore.removeFromFavorites(item.id);
        setTimeout(() => {
            this.refreshTimestamp.set(Date.now());
        }, 100);
    }

    setCategoryId(categoryId: any) {
        this.selectedCategoryId.set(categoryId);
    }

    openItem(item: any) {
        console.debug('Open item', item);
        const normalizedItem = this.normalizeFavoriteItem(item);

        switch (item.category_id) {
            case 'itv':
                this.stalkerStore.setSelectedContentType('itv');
                this.createLinkToPlayVodItv(item.cmd, item.o_name || item.name, item.logo);
                break;
            case 'vod':
                this.itemDetails = normalizedItem;
                this.stalkerStore.setSelectedItem(normalizedItem.details);
                this.stalkerStore.setSelectedContentType('vod');

                // Check if this VOD item is actually a series (Ministra is_series=1)
                const isVodSeries =
                    normalizedItem.details?.is_series === true ||
                    normalizedItem.details?.is_series === 1 ||
                    normalizedItem.details?.is_series === '1' ||
                    item.is_series === true ||
                    item.is_series === 1 ||
                    item.is_series === '1';

                if (isVodSeries || normalizedItem.details?.series?.length > 0) {
                    // VOD series - will be rendered as series view
                    this.vodDetailsItem = null;
                } else {
                    // Regular VOD - create VodDetailsItem for the component
                    this.vodDetailsItem = createStalkerVodItem(
                        normalizedItem.details as StalkerVodDetails,
                        this.currentPlaylist()?._id ?? ''
                    );
                }
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
        if (event.isFavorite && event.item.type === 'stalker') {
            this.removeFromFavorites({ id: event.item.data.id });
        }
    }

    /** Handle back from vod-details component */
    onVodBack(): void {
        this.itemDetails = null;
        this.vodDetailsItem = null;
    }

    private normalizeFavoriteItem(item: any): any {
        if (item.details && item.details.info) {
            return item;
        }

        const source = item.details || item;
        const info = source.info || {
            name: item.o_name || item.name || item.title || 'Unknown',
            o_name: item.o_name,
            movie_image: item.cover || item.screenshot_uri || item.logo,
            description: item.description,
            releasedate: item.releasedate || item.year,
            genre: item.genre || item.genres_str,
            duration: item.duration,
            rating_imdb: item.rating_imdb || item.rating,
            country: item.country,
            actors: item.actors,
            director: item.director,
            backdrop_path:
                item.backdrop_path ||
                [item.cover, item.screenshot_uri].filter(Boolean),
        };

        // Normalize is_series to boolean true (can be 1, "1", or true)
        const rawIsSeries =
            item.is_series || source.is_series;
        const normalizedIsSeries =
            rawIsSeries === true ||
            rawIsSeries === 1 ||
            rawIsSeries === '1';

        return {
            ...item,
            details: {
                ...source,
                info: info,
                cmd: item.cmd || source.cmd,
                id: item.stream_id || item.id || source.id,
                series: item.series || source.series,
                is_series: normalizedIsSeries ? true : undefined,
                // Preserve video_id for season fetching
                video_id: item.video_id || source.video_id,
            },
        };
    }

    async createLinkToPlayVodItv(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        console.debug('Create link to play VOD/ITV', cmd, title, thumbnail);
        await this.stalkerStore.createLinkToPlayVod(cmd, title, thumbnail);
    }
}
