import {
    Component,
    OnDestroy,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from 'm3u-state';
import { BehaviorSubject, map, switchMap } from 'rxjs';
import { XtreamCategory } from 'shared-interfaces';
import { FavoritesLayoutComponent } from '../../shared/components/favorites-layout/favorites-layout.component';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { FavoriteItem } from '../services/favorite-item.interface';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../stores/xtream.store';

@Component({
    selector: 'app-favorites',
    imports: [FavoritesLayoutComponent, MatCardModule],
    templateUrl: './favorites.component.html',
    styleUrls: ['./favorites.component.scss', '../sidebar.scss'],
})
export class FavoritesComponent implements OnInit, OnDestroy {
    private favoritesService = inject(FavoritesService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private store = inject(Store);
    private xtreamStore = inject(XtreamStore);
    private readonly favoritesCtx = inject(FavoritesContextService);

    readonly categories = signal<XtreamCategory[]>([]);
    readonly currentPlaylist = this.xtreamStore.currentPlaylist;

    readonly allItems = signal<FavoriteItem[]>([]);
    readonly series = signal<FavoriteItem[]>([]);
    readonly movies = signal<FavoriteItem[]>([]);
    readonly live = signal<FavoriteItem[]>([]);
    readonly searchTerm = toSignal(
        this.route.queryParamMap.pipe(
            map((params) => (params.get('q') ?? '').trim().toLowerCase())
        ),
        { initialValue: '' }
    );

    /** Synced with the workspace context service so panel clicks are reactive */
    readonly selectedCategoryId = this.favoritesCtx.selectedCategoryId;

    /** Items filtered by the active category — fully reactive, no imperative calls */
    readonly filteredFavoritesToShow = computed(() => {
        const term = this.searchTerm();
        const categoryId = this.selectedCategoryId();

        let items: FavoriteItem[];
        switch (categoryId) {
            case 'movie':
                items = this.movies();
                break;
            case 'live':
                items = this.live();
                break;
            case 'series':
                items = this.series();
                break;
            default:
                items = this.allItems();
        }

        if (!term) return items;
        return items.filter((item) =>
            `${item?.title ?? ''}`.toLowerCase().includes(term)
        );
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
                this.initCategories();
            });
    }

    initCategories() {
        const updated: XtreamCategory[] = [
            {
                id: 1,
                category_id: 'all',
                category_name: 'All',
                count: this.allItems().length,
                parent_id: 0,
            },
            {
                id: 2,
                category_id: 'movie',
                category_name: 'Movies',
                count: this.movies().length,
                parent_id: 0,
            },
            {
                id: 3,
                category_id: 'live',
                category_name: 'Live TV',
                count: this.live().length,
                parent_id: 0,
            },
            {
                id: 4,
                category_id: 'series',
                category_name: 'Series',
                count: this.series().length,
                parent_id: 0,
            },
        ];
        this.categories.set(updated);
        this.favoritesCtx.setCategories(updated);
    }

    setCategoryId(categoryId: string) {
        this.favoritesCtx.setCategoryId(categoryId);
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
            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.route,
                }
            );
        }
    }

    ngOnDestroy(): void {
        this.favoritesCtx.reset();
    }
}
