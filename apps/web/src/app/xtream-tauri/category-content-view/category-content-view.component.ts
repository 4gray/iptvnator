import { Component, inject, OnInit, computed } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    VodDetailsItem,
    StalkerVodDetails,
    createStalkerVodItem,
} from 'shared-interfaces';
import { GridListComponent } from '../../shared/components/grid-list/grid-list.component';
import { StalkerSeriesViewComponent } from '../../stalker/stalker-series-view/stalker-series-view.component';
import { StalkerStore } from '../../stalker/stalker.store';
import { VodDetailsComponent } from '../../xtream/vod-details/vod-details.component';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { XtreamStore } from '../stores/xtream.store';

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
    private readonly store = this.isStalker
        ? inject(StalkerStore)
        : inject(XtreamStore);

    readonly contentType = this.store.selectedContentType;

    readonly limit = this.store.limit;
    readonly pageIndex = this.store.page;
    readonly pageSizeOptions = this.isStalker ? [14] : [10, 25, 50, 100];
    readonly selectedCategory = this.store.getSelectedCategory;
    readonly paginatedContent = this.store.getPaginatedContent;

    readonly contentWithProgress = computed(() => {
        const items = this.store.getPaginatedContent();
        if (!items) return [];

        if (this.isStalker) return items;

        const xtreamStore = this.store as any;
        if (!xtreamStore.getProgressPercent) return items;

        return items.map((item: any) => {
            const isSeries = this.contentType() === 'series';
            // Use xtream_id (DB) or series_id/stream_id (API)
            const id = Number(
                item.xtream_id || item.series_id || item.stream_id
            );

            // console.log(`[CategoryContent] Processing item ${id}. isSeries=${isSeries}`);

            if (isSeries) {
                const hasProgress = xtreamStore.hasSeriesProgress(id);
                console.log(
                    `[CategoryContent] Checking series ${id} (xtream_id=${item.xtream_id}, series_id=${item.series_id}). Has progress: ${hasProgress}`
                );
                return {
                    ...item,
                    hasSeriesProgress: hasProgress,
                };
            } else {
                return {
                    ...item,
                    progress: xtreamStore.getProgressPercent(id, 'vod'),
                    isWatched: xtreamStore.isWatched(id, 'vod'),
                };
            }
        });
    });

    readonly isPaginatedContentLoading = this.store.isPaginatedContentLoading;
    readonly selectedItem = this.store.selectedItem;
    readonly totalPages = this.store.getTotalPages;
    readonly bigStore = inject(Store);

    /** Computed VodDetailsItem for the vod-details component */
    readonly vodDetailsItem = computed<VodDetailsItem | null>(() => {
        const item = this.selectedItem();
        if (!item || !this.isStalker) return null;
        // Access currentPlaylist from the store (type-safe since we're in stalker mode)
        const stalkerStore = this.store as unknown as {
            currentPlaylist: () => { _id: string } | null;
        };
        return createStalkerVodItem(
            item as StalkerVodDetails,
            stalkerStore.currentPlaylist()?._id ?? ''
        );
    });

    seasons = [];

    ngOnInit() {
        const { categoryId } = this.activatedRoute.snapshot.params;
        console.log(
            `[CategoryContent] ngOnInit. contentType=${this.contentType()}, isStalker=${this.isStalker}, categoryId=${categoryId}`
        );

        // Ensure playback positions are loaded (Xtream only)
        if (!this.isStalker) {
            const xtreamStore = this.store as any;
            if (xtreamStore.currentPlaylist()?.id) {
                xtreamStore.loadAllPositions(xtreamStore.currentPlaylist().id);
            }
        }

        // Clear any previous selectedItem when entering category view
        // This ensures the content-header is visible
        this.store.setSelectedItem(null);

        // Only set category if it's different from the currently selected one
        // This preserves the page state when navigating back from detail view
        if (categoryId) {
            if (this.store.selectedCategoryId() !== Number(categoryId)) {
                this.store.setSelectedCategory(categoryId);
            }
        } else {
            // No categoryId in route means "All Items"
            if (this.store.selectedCategoryId() !== null) {
                this.store.setSelectedCategory(null);
            }
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
                this.contentType() === 'vod' &&
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
            // When viewing "Recently Added" (no category selected), include category_id in path
            const categoryId = this.store.selectedCategoryId();
            if (categoryId) {
                this.router.navigate([item.xtream_id], {
                    relativeTo: this.activatedRoute,
                });
            } else {
                this.router.navigate([item.category_id, item.xtream_id], {
                    relativeTo: this.activatedRoute,
                });
            }
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

    /** Handle play from vod-details component */
    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            this.createLinkToPlayVod(
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
        this.store.setSelectedItem(null);
    }
}
