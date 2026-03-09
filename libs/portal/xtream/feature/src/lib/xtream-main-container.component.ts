import { Component, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { CategoryViewComponent } from '@iptvnator/portal/shared/ui';
import { isWorkspaceLayoutRoute } from '@iptvnator/portal/shared/util';
import {
    XtreamCategorySortMode,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from './category-management-dialog/category-management-dialog.component';

const XTREAM_CATEGORY_SORT_STORAGE_KEY = 'xtream-category-sort-mode';

interface XtreamCategoryLike {
    readonly id?: number | string;
    readonly category_id?: number | string;
    readonly name?: string;
}

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: [
        '../../../../shared/ui/src/lib/styles/portal-main-container.scss',
        '../../../../shared/ui/src/lib/styles/portal-sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        FormsModule,
        MatFormFieldModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
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
    readonly categorySearchTerm = this.xtreamStore.categorySearchTerm;
    readonly canShowSortMenu = computed(() => {
        const hasCategorySelected = this.selectedCategoryId() != null;
        const type = this.xtreamStore.selectedContentType();
        return hasCategorySelected && (type === 'vod' || type === 'series');
    });
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    readonly contentSortLabel = computed(() => {
        const mode = this.contentSortMode();
        if (mode === 'date-asc') return 'Date Added (Oldest First)';
        if (mode === 'name-asc') return 'Name A-Z';
        if (mode === 'name-desc') return 'Name Z-A';
        return 'Date Added (Latest First)';
    });

    ngOnInit(): void {
        const savedSortMode = localStorage.getItem(
            XTREAM_CATEGORY_SORT_STORAGE_KEY
        );
        if (
            savedSortMode === 'date-desc' ||
            savedSortMode === 'date-asc' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc'
        ) {
            this.xtreamStore.setContentSortMode(savedSortMode);
        }

        const { categoryId } = this.route.snapshot.params;
        if (categoryId) {
            this.xtreamStore.setSelectedCategory(Number(categoryId));
        }
    }

    categoryClicked(category: XtreamCategoryLike) {
        const categoryId = category.category_id ?? category.id;

        this.xtreamStore.setSelectedItem(null);
        this.xtreamStore.setSelectedCategory(Number(categoryId));

        this.router.navigate([categoryId], {
            relativeTo: this.route,
        });
    }

    getContentLabel(): string {
        const selectedCategoryId = this.xtreamStore.selectedCategoryId();

        if (selectedCategoryId === null || selectedCategoryId === undefined) {
            const recentlyAddedLabel = this.translateService.instant(
                'PORTALS.SIDEBAR.RECENTLY_ADDED'
            );

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
            ? (selectedCategory as XtreamCategoryLike).name
            : 'Category Content';

        if (
            !this.xtreamStore.selectedItem() &&
            this.xtreamStore.getTotalPages() > 1
        ) {
            const currentPage = this.xtreamStore.page() + 1;
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
                this.xtreamStore.reloadCategories();
            }
        });
    }

    setContentSortMode(mode: XtreamCategorySortMode): void {
        this.xtreamStore.setContentSortMode(mode);
        localStorage.setItem(XTREAM_CATEGORY_SORT_STORAGE_KEY, mode);
    }

    onCategorySearchChange(term: string): void {
        this.xtreamStore.setCategorySearchTerm(term);
    }

    clearCategorySearch(): void {
        this.xtreamStore.setCategorySearchTerm('');
    }
}
