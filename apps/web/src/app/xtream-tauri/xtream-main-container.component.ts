import { Component, computed, inject, OnInit } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { XtreamCategory } from 'shared-interfaces';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from './category-management-dialog/category-management-dialog.component';
import { CategoryViewComponent } from './category-view/category-view.component';
import { XtreamStore } from './stores/xtream.store';
import { XtreamCategorySortMode } from './stores/features/with-selection.feature';

const XTREAM_CATEGORY_SORT_STORAGE_KEY = 'xtream-category-sort-mode';

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: ['./xtream-main-container.component.scss', './sidebar.scss'],
    imports: [
        CategoryViewComponent,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatTooltipModule,
        PlaylistSwitcherComponent,
        ResizableDirective,
        RouterOutlet,
        TranslateModule,
    ],
})
export class XtreamMainContainerComponent implements OnInit {
    readonly router = inject(Router);
    readonly route = inject(ActivatedRoute);
    readonly translateService = inject(TranslateService);
    readonly xtreamStore = inject(XtreamStore);
    private readonly dialog = inject(MatDialog);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly categoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly currentPlaylist = this.xtreamStore.currentPlaylist;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    readonly contentSortMode = this.xtreamStore.contentSortMode;
    readonly canShowSortMenu = computed(() => {
        const hasCategorySelected = this.selectedCategoryId() != null;
        const type = this.xtreamStore.selectedContentType();
        return hasCategorySelected && (type === 'vod' || type === 'series');
    });
    readonly contentSortLabel = computed(() => {
        const mode = this.contentSortMode();
        if (mode === 'date-asc') return 'Date Added (Oldest First)';
        if (mode === 'name-asc') return 'Name A-Z';
        if (mode === 'name-desc') return 'Name Z-A';
        return 'Date Added (Latest First)';
    });

    ngOnInit(): void {
        const savedSortMode = localStorage.getItem(XTREAM_CATEGORY_SORT_STORAGE_KEY);
        if (
            savedSortMode === 'date-desc' ||
            savedSortMode === 'date-asc' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc'
        ) {
            this.xtreamStore.setContentSortMode(savedSortMode);
        }

        const { categoryId } = this.route.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));
    }

    categoryClicked(category: XtreamCategory) {
        const categoryId = (category as any).category_id ?? category.id;

        // Clear any selected item when switching categories
        this.xtreamStore.setSelectedItem(null);

        this.xtreamStore.setSelectedCategory(Number(categoryId));

        this.router.navigate([categoryId], {
            relativeTo: this.route,
        });
    }

    getContentLabel(): string {
        const selectedCategoryId = this.xtreamStore.selectedCategoryId();

        // When no category is selected, show "Recently Added"
        if (selectedCategoryId === null || selectedCategoryId === undefined) {
            const recentlyAddedLabel = this.translateService.instant('PORTALS.SIDEBAR.RECENTLY_ADDED');

            // Show page number when viewing recently added (not detail view)
            if (
                !this.xtreamStore.selectedItem() &&
                this.xtreamStore.getTotalPages() > 1
            ) {
                const currentPage = this.xtreamStore.page() + 1;
                const totalPages = this.xtreamStore.getTotalPages();
                const pageLabel = this.translateService.instant('PORTALS.PAGE');
                return `${recentlyAddedLabel} (${pageLabel} ${currentPage}/${totalPages})`;
            }

            return recentlyAddedLabel;
        }

        const selectedCategory = this.xtreamStore.getSelectedCategory();
        const categoryName = selectedCategory
            ? (selectedCategory as any).name
            : 'Category Content';

        // Show page number when viewing category content (not detail view)
        if (
            !this.xtreamStore.selectedItem() &&
            this.xtreamStore.getTotalPages() > 1
        ) {
            const currentPage = this.xtreamStore.page() + 1; // +1 because page is 0-indexed
            const totalPages = this.xtreamStore.getTotalPages();
            const pageLabel = this.translateService.instant('PORTALS.PAGE');
            return `${categoryName} (${pageLabel} ${currentPage}/${totalPages})`;
        }

        return categoryName;
    }

    historyBack() {
        this.router.navigate(['.', this.xtreamStore.selectedCategoryId()], {
            relativeTo: this.route,
        });
    }

    openCategoryManagement(): void {
        // The playlist id is in the parent route (xtreams/:id)
        const playlistId = this.route.parent?.snapshot.params['id'];
        const contentType = this.xtreamStore.selectedContentType();

        const dialogRef = this.dialog.open<
            CategoryManagementDialogComponent,
            CategoryManagementDialogData,
            boolean
        >(CategoryManagementDialogComponent, {
            data: {
                playlistId,
                contentType,
                itemCounts: this.categoryItemCounts(),
            },
            width: '500px',
            maxHeight: '80vh',
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                // Reload categories from database to reflect visibility changes
                this.xtreamStore.reloadCategories();
            }
        });
    }

    setContentSortMode(mode: XtreamCategorySortMode): void {
        this.xtreamStore.setContentSortMode(mode);
        localStorage.setItem(XTREAM_CATEGORY_SORT_STORAGE_KEY, mode);
    }
}
