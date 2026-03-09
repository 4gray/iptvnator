import { Component, effect, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule } from '@angular/material/paginator';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import { ResizableDirective } from 'components';
import {
    CategoryViewComponent,
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import { isWorkspaceLayoutRoute } from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';

@Component({
    selector: 'app-stalker-main-container',
    templateUrl: './stalker-main-container.component.html',
    styleUrls: [
        './stalker-main-container.component.scss',
        '../../../../shared/ui/src/lib/styles/portal-main-container.scss',
        '../../../../shared/ui/src/lib/styles/portal-sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        MatIcon,
        MatIconButton,
        MatPaginatorModule,
        PlaylistErrorViewComponent,
        PlaylistSwitcherComponent,
        ResizableDirective,
        RouterOutlet,
        TranslatePipe,
    ],
})
export class StalkerMainContainerComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly stalkerStore = inject(StalkerStore);
    private readonly translateService = inject(TranslateService);
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);

    currentLayout:
        | 'category_content'
        | 'serial-details'
        | 'vod-details'
        | 'not-available' = 'category_content';

    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;
    readonly currentPlaylist = this.stalkerStore.currentPlaylist;
    readonly categories = this.stalkerStore.getCategoryResource;
    readonly isCategoryLoading = this.stalkerStore.isCategoryResourceLoading;
    readonly isCategoryFailed = this.stalkerStore.isCategoryResourceFailed;
    readonly contentItems = this.stalkerStore.getPaginatedContent;
    readonly isContentLoading = this.stalkerStore.isPaginatedContentLoading;
    readonly skeletonRows = Array.from({ length: 12 }, (_, index) => index);
    readonly skeletonLabelWidths = [
        82, 70, 77, 66, 86, 73, 79, 62, 84, 68, 76, 71,
    ];

    constructor() {
        effect(() => {
            this.stalkerStore.selectedContentType();
        });
    }

    categoryClicked(item: {
        category_name?: string;
        category_id?: string | number;
    }) {
        const categoryId = String(item.category_id ?? '*');
        this.stalkerStore.setSelectedCategory(categoryId);
        this.currentLayout = 'category_content';
        this.stalkerStore.setPage(0);
        this.stalkerStore.setSelectedItem(undefined);

        this.router.navigate(['.', categoryId], {
            relativeTo: this.route,
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
        const selectedContentType = this.stalkerStore.selectedContentType();
        const selectedCategoryId = this.stalkerStore.selectedCategoryId();
        const typeLabelByContentType: Record<string, string> = {
            vod: this.translateService.instant('PORTALS.SIDEBAR.MOVIES'),
            series: this.translateService.instant('PORTALS.SIDEBAR.SERIES'),
            itv: this.translateService.instant('PORTALS.SIDEBAR.LIVE_TV'),
        };
        const selectedTypeLabel =
            typeLabelByContentType[selectedContentType] ?? '';

        const selectedCategoryName =
            this.stalkerStore.getSelectedCategoryName();
        let categoryName = selectedCategoryName;

        if (selectedCategoryId === '*') {
            categoryName = `${selectedTypeLabel} - ${this.translateService.instant(
                'PORTALS.ALL_CATEGORIES'
            )}`;
        } else if (!categoryName) {
            categoryName = selectedTypeLabel;
        }

        if (
            !this.stalkerStore.selectedItem() &&
            !this.isContentLoading() &&
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
