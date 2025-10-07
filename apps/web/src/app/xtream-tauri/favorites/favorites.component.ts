import { Component, OnInit, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { BehaviorSubject, switchMap } from 'rxjs';
import { XtreamCategory } from '../../../shared/xtream-category.interface';
import { FavoritesLayoutComponent } from '../../shared/components/favorites-layout/favorites-layout.component';
import { selectActivePlaylist } from '../../state/selectors';
import { FavoriteItem } from '../services/favorite-item.interface';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-favorites',
    imports: [FavoritesLayoutComponent, MatCardModule],
    templateUrl: './favorites.component.html',
    styleUrls: ['./favorites.component.scss', '../sidebar.scss'],
})
export class FavoritesComponent implements OnInit {
    private favoritesService = inject(FavoritesService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private store = inject(Store);
    private xtreamStore = inject(XtreamStore);

    readonly categories = signal<XtreamCategory[]>([]);

    readonly series = signal<FavoriteItem[]>([]);
    readonly movies = signal<FavoriteItem[]>([]);
    readonly live = signal<FavoriteItem[]>([]);

    readonly favoritesToShow = signal<FavoriteItem[]>([]);
    readonly selectedCategoryId = signal<string>('movie');

    private favoritesRefresh$ = new BehaviorSubject<void>(undefined);

    ngOnInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        const playlistId = this.store.selectSignal(selectActivePlaylist)()._id;
        this.favoritesRefresh$
            .pipe(
                switchMap(() => this.favoritesService.getFavorites(playlistId))
            )
            .subscribe((items) => {
                this.movies.set(
                    items.filter((item) => (item as any).type === 'movie')
                );
                this.live.set(items.filter((item) => item.type === 'live'));
                this.series.set(items.filter((item) => item.type === 'series'));
                this.initCategories();
                this.setCategoryContent(this.selectedCategoryId());
            });
    }

    initCategories() {
        this.categories.set([
            {
                id: 1,
                category_id: 'movie',
                category_name: 'Movies' + ' (' + this.movies().length + ')',
                parent_id: 0,
            },
            {
                id: 2,
                category_id: 'live',
                category_name: 'Live TV' + ' (' + this.live().length + ')',
                parent_id: 0,
            },
            {
                id: 3,
                category_id: 'series',
                category_name: 'Series' + ' (' + this.series().length + ')',
                parent_id: 0,
            },
        ]);
    }

    setCategoryId(categoryId: string) {
        this.selectedCategoryId.set(categoryId);
        this.setCategoryContent(categoryId);
    }

    setCategoryContent(categoryId: string) {
        switch (categoryId) {
            case 'movie':
                this.favoritesToShow.set(this.movies());
                break;
            case 'live':
                this.favoritesToShow.set(this.live());
                break;
            case 'series':
                this.favoritesToShow.set(this.series());
                break;
            default:
                this.favoritesToShow.set(this.movies());
                break;
        }
    }

    async removeFromFavorites(item: any) {
        await this.favoritesService.removeFromFavorites(
            item.id,
            item.playlist_id
        );
        // Refresh favorites after removal
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
}
