import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { PlaylistsService } from '@iptvnator/services';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FavoritesLayoutComponent } from '../../shared/components/favorites-layout/favorites-layout.component';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-recently-viewed',
    templateUrl: './recently-viewed.component.html',
    imports: [
        FavoritesLayoutComponent,
        MatButton,
        MatIcon,
        StalkerSeriesViewComponent,
        TranslatePipe,
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
            case 'series':
                this.itemDetails = item;
                this.stalkerStore.setSelectedItem(item);
                break;
            default:
                break;
        }
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
}
