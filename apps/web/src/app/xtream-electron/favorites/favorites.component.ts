import {
    Component,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from 'm3u-state';
import { BehaviorSubject, switchMap } from 'rxjs';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import {
    PortalCollectionShellComponent,
    PortalCollectionShellLayout,
} from '../../shared/components/portal-collection-shell/portal-collection-shell.component';
import { queryParamSignal } from '../../shared/navigation/portal-route.utils';
import { createPortalCollectionContext } from '../../shared/utils/portal-collection-context';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from '../../shared/utils/portal-collection-items';
import { FavoriteItem } from '../services/favorite-item.interface';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../stores/xtream.store';

const XTREAM_FAVORITES_LAYOUT: PortalCollectionShellLayout = {};
const XTREAM_COLLECTION_LABELS = {
    all: 'All',
    movie: 'Movies',
    live: 'Live TV',
    series: 'Series',
};

@Component({
    selector: 'app-favorites',
    imports: [PortalCollectionShellComponent, MatCardModule],
    templateUrl: './favorites.component.html',
    styleUrls: [
        './favorites.component.scss',
        '../../shared/styles/portal-sidebar.scss',
    ],
})
export class FavoritesComponent implements OnInit {
    private favoritesService = inject(FavoritesService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private store = inject(Store);
    private xtreamStore = inject(XtreamStore);
    private readonly favoritesCtx = inject(FavoritesContextService);

    readonly currentPlaylist = this.xtreamStore.currentPlaylist;
    readonly layout = XTREAM_FAVORITES_LAYOUT;
    readonly playlistSubtitle = 'Xtream Code';
    readonly playlistTitle = computed(
        () =>
            this.currentPlaylist()?.name ||
            this.currentPlaylist()?.title ||
            'Playlist'
    );

    readonly allItems = signal<FavoriteItem[]>([]);
    readonly series = signal<FavoriteItem[]>([]);
    readonly movies = signal<FavoriteItem[]>([]);
    readonly live = signal<FavoriteItem[]>([]);
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim().toLowerCase()
    );
    readonly categories = computed(() =>
        buildStandardCollectionCategories({
            labels: XTREAM_COLLECTION_LABELS,
            counts: {
                all: this.allItems().length,
                movie: this.movies().length,
                live: this.live().length,
                series: this.series().length,
            },
            includeLive: true,
        })
    );
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.favoritesCtx,
        categories: this.categories,
    });

    /** Synced with the workspace context service so panel clicks are reactive */
    readonly selectedCategoryId = this.collectionContext.selectedCategoryId;

    /** Items filtered by the active category — fully reactive, no imperative calls */
    readonly filteredFavoritesToShow = computed(() => {
        return filterCollectionBucket({
            selectedCategoryId: this.selectedCategoryId(),
            allItems: this.allItems(),
            buckets: {
                movie: this.movies(),
                live: this.live(),
                series: this.series(),
            },
            searchTerm: this.searchTerm(),
            textOf: (item) => `${item?.title ?? ''}`,
        });
    });

    private favoritesRefresh$ = new BehaviorSubject<void>(undefined);

    ngOnInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        const playlistId = this.store.selectSignal(selectActivePlaylist)()._id;
        this.favoritesRefresh$
            .pipe(
                switchMap(() => this.favoritesService.getFavorites(playlistId))
            )
            .subscribe((items) => {
                this.allItems.set(items);
                this.movies.set(
                    items.filter((item) => (item as any).type === 'movie')
                );
                this.live.set(items.filter((item) => item.type === 'live'));
                this.series.set(items.filter((item) => item.type === 'series'));
            });
    }

    setCategoryId(categoryId: string) {
        this.collectionContext.setCategoryId(categoryId);
    }

    async removeFromFavorites(item: any) {
        await this.favoritesService.removeFromFavorites(
            item.content_id,
            item.playlist_id
        );
        this.favoritesRefresh$.next();
    }

    openItem(item: any) {
        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.setSelectedContentType(type);
        if (type === 'live') {
            const streamUrl = this.xtreamStore.constructStreamUrl(item);
            this.xtreamStore.openPlayer(streamUrl, item.title, item.poster_url);
        } else {
            const routePlaylistId = this.route.snapshot.params['id'];
            const hasGlobalContext = this.router.url.includes(
                '/workspace/global-favorites'
            );
            const shouldNavigateAbsolute =
                hasGlobalContext ||
                (item.playlist_id &&
                    routePlaylistId &&
                    item.playlist_id !== routePlaylistId);

            if (shouldNavigateAbsolute && item.playlist_id) {
                this.router.navigate([
                    '/workspace',
                    'xtreams',
                    item.playlist_id,
                    type,
                    item.category_id,
                    item.xtream_id,
                ]);
                return;
            }

            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.route,
                }
            );
        }
    }
}
