import { Component, inject, OnInit } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
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
        GridListComponent,
        PlaylistErrorViewComponent,
        StalkerSeriesViewComponent,
        TranslatePipe,
        VodDetailsComponent,
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
    readonly pageSizeOptions = this.isStalker ? [14] : [10, 25, 50, 100];
    readonly selectedCategory = this.store.getSelectedCategory;
    readonly paginatedContent = this.store.getPaginatedContent;
    readonly isPaginatedContentLoading = this.store.isPaginatedContentLoading;
    readonly selectedItem = this.store.selectedItem;
    readonly totalPages = this.store.getTotalPages;
    readonly bigStore = inject(Store);

    seasons = [];

    ngOnInit() {
        const { categoryId } = this.activatedRoute.snapshot.params;

        // Clear any previous selectedItem when entering category view
        // This ensures the content-header is visible
        this.store.setSelectedItem(null);

        // Only set category if it's different from the currently selected one
        // This preserves the page state when navigating back from detail view
        if (
            categoryId &&
            this.store.selectedCategoryId() !== Number(categoryId)
        ) {
            this.store.setSelectedCategory(categoryId);
        }
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
            // For VOD items with embedded series array (Stalker vclub)
            series: item.series,
            // Preserve has_files for cmd transformation during playback
            has_files: item.has_files,
            // Flag for VOD items that are actually series (Ministra plugin)
            // is_series can be "1" (string) or 1 (number)
            // ONLY set this for VOD content type - regular series should use the standard series flow
            is_series:
                this.contentType === 'vod' &&
                (item.is_series === '1' || item.is_series === 1),
            // Store video_id for season fetching if available
            video_id: item.video_id,
            info: {
                movie_image: item.screenshot_uri,
                description: item.description,
                name: item.name || item.o_name,
                director: item.director,
                releasedate: item.year,
                genre: item.genres_str,
                actors: item.actors,
                rating_imdb: item.rating_imdb,
                rating_kinopoisk: item.rating_kinopoisk,
            },
        };

        if (this.isStalker) {
            this.store.setSelectedItem(selectedItem);
        } else {
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
