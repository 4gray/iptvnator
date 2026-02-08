import { Component, effect, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule } from '@angular/material/paginator';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { CategoryViewComponent } from '../xtream-tauri/category-view/category-view.component';
import { PlaylistErrorViewComponent } from '../xtream/playlist-error-view/playlist-error-view.component';
import { StalkerStore } from './stalker.store';

@Component({
    selector: 'app-stalker-main-container',
    templateUrl: './stalker-main-container.component.html',
    styleUrls: [
        './stalker-main-container.component.scss',
        '../xtream-tauri/xtream-main-container.component.scss',
        '../xtream-tauri/sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        MatIcon,
        MatIconButton,
        MatPaginatorModule,
        NgxSkeletonLoaderModule,
        PlaylistErrorViewComponent,
        PlaylistSwitcherComponent,
        ResizableDirective,
        RouterOutlet,
        TranslatePipe,
    ],
})
export class StalkerMainContainerComponent {
    readonly stalkerStore = inject(StalkerStore);
    private readonly translateService = inject(TranslateService);

    currentLayout:
        | 'category_content'
        | 'serial-details'
        | 'vod-details'
        | 'not-available' = 'category_content';

    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;
    readonly currentPlaylist = this.stalkerStore.currentPlaylist;

    /** categories */
    readonly categories = this.stalkerStore.getCategoryResource;
    readonly isCategoryLoading = this.stalkerStore.isCategoryResourceLoading;
    readonly isCategoryFailed = this.stalkerStore.isCategoryResourceFailed;

    /** content items */
    readonly contentItems = this.stalkerStore.getPaginatedContent;
    readonly isContentLoading = this.stalkerStore.isPaginatedContentLoading;

    constructor(
        private readonly activatedRoute: ActivatedRoute,
        private readonly router: Router
    ) {
        // reset category title after changing content type
        effect(() => {
            this.stalkerStore.selectedContentType();
        });
    }

    categoryClicked(item: { category_name: string; category_id: string }) {
        this.stalkerStore.setSelectedCategory(item.category_id || '*');
        this.currentLayout = 'category_content';
        this.stalkerStore.setPage(0);
        this.stalkerStore.setSelectedItem(undefined);

        this.router.navigate(['.', item.category_id], {
            relativeTo: this.activatedRoute,
        });
    }

    historyBack() {
        this.currentLayout = 'category_content';
    }

    backToCategories() {
        this.stalkerStore.setSelectedCategory(null);
    }

    goBackToList() {
        this.stalkerStore.clearSelectedItem();
    }

    getContentLabel(): string {
        const categoryName = this.stalkerStore.getSelectedCategoryName();

        // Show page number when viewing category content (not detail view)
        if (
            !this.stalkerStore.selectedItem() &&
            this.stalkerStore.getTotalPages() > 1
        ) {
            const currentPage = this.stalkerStore.page() + 1;
            const totalPages = this.stalkerStore.getTotalPages();
            const pageLabel = this.translateService.instant('PORTALS.PAGE');
            return `${categoryName} (${pageLabel} ${currentPage}/${totalPages})`;
        }

        return categoryName;
    }
}
