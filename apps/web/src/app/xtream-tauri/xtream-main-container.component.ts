import { Component, inject, OnInit } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from 'components';
import { XtreamCategory } from 'shared-interfaces';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from './category-management-dialog/category-management-dialog.component';
import { CategoryViewComponent } from './category-view/category-view.component';
import { XtreamStore } from './stores/xtream.store';

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: ['./xtream-main-container.component.scss', './sidebar.scss'],
    imports: [
        CategoryViewComponent,
        MatIcon,
        MatIconButton,
        MatTooltipModule,
        PlaylistSwitcherComponent,
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

    ngOnInit(): void {
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
        if (
            this.xtreamStore.getSelectedCategory() === null ||
            this.xtreamStore.getSelectedCategory() === undefined
        ) {
            return this.translateService.instant('PORTALS.SELECT_CATEGORY');
        } else {
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

            return `Content for ${categoryName}`;
        }
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
}
