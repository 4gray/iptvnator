import { Component, inject, OnInit } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { XtreamCategory } from 'shared-interfaces';
import { CategoryViewComponent } from './category-view/category-view.component';
import { XtreamStore } from './xtream.store';

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: ['./xtream-main-container.component.scss', './sidebar.scss'],
    imports: [
        CategoryViewComponent,
        TranslateModule,
        RouterOutlet,
        /* MpvPlayerBarComponent, */
        MatIcon,
        MatIconButton,
    ],
})
export class XtreamMainContainerComponent implements OnInit {
    readonly router = inject(Router);
    readonly route = inject(ActivatedRoute);
    readonly translateService = inject(TranslateService);
    readonly xtreamStore = inject(XtreamStore);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;

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
}
