import { Component, inject, OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { GridListComponent } from '../../shared/components/grid-list/grid-list.component';
import { StalkerSeriesViewComponent } from '../../stalker/stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../../stalker/stalker.store';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    imports: [
        MatCardModule,
        MatPaginatorModule,
        PlaylistErrorViewComponent,
        TranslatePipe,
        VodDetailsComponent,
        GridListComponent,
        StalkerSeriesViewComponent,
    ],
})
export class CategoryContentViewComponent implements OnInit {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly router = inject(Router);

    readonly isStalker = this.activatedRoute.snapshot.data['api'] === 'stalker';
    readonly contentType = this.activatedRoute.snapshot.data['contentType'];
    private readonly store = this.isStalker
        ? inject(StalkerStore)
        : inject(XtreamStore);

    readonly limit = this.store.limit;
    readonly pageIndex = this.store.page;
    readonly pageSizeOptions = [5, 10, 25, 50, 100];
    readonly selectedCategory = this.store.getSelectedCategory;
    readonly paginatedContent = this.store.getPaginatedContent;
    readonly isPaginatedContentLoading = this.store.isPaginatedContentLoading;
    readonly selectedItem = this.store.selectedItem;
    readonly totalPages = this.store.getTotalPages;
    readonly bigStore = inject(Store);

    seasons = [];

    ngOnInit() {
        const { categoryId } = this.activatedRoute.snapshot.params;
        if (categoryId) this.store.setSelectedCategory(categoryId);
    }

    onPageChange(event: PageEvent) {
        this.store.setPage(event.pageIndex);
        this.store.setLimit(event.pageSize);
        localStorage.setItem('xtream-page-size', event.pageSize.toString());
    }

    onItemClick(item: any) {
        const selectedItem = {
            id: item.id,
            cmd: item.cmd,
            info: {
                movie_image: item.screenshot_uri,
                description: item.description,
                name: item.name,
                director: item.director,
                releasedate: item.year,
                genre: item.genres_str,
                actors: item.actors,
                rating_imdb: item.rating_imdb,
                rating_kinopoisk: item.rating_kinopoisk,
            },
        };

        this.store.setSelectedItem(selectedItem);
        if (!this.isStalker) {
            this.router.navigate([item.xtream_id], {
                relativeTo: this.activatedRoute,
            });
        }
    }

    async createLinkToPlayVod(
        cmd?: string,
        title?: string,
        thumbnail?: string
    ) {
        await this.store.createLinkToPlayVod(cmd, title, thumbnail);
    }

    addToFavorites(item: any) {
        console.debug('Add to favorites', item);
        this.store.addToFavorites(item);
    }

    removeFromFavorites(favoriteId: string) {
        console.debug('Remove from favorites', favoriteId);
        this.store.removeFromFavorites(favoriteId);
    }
}
