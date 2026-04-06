import { NgComponentOutlet } from '@angular/common';
import {
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    GridListComponent,
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import {
    clearNavigationStateKeys,
    getOpenStalkerItemState,
    PortalCatalogFacade,
    OPEN_STALKER_ITEM_STATE_KEY,
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';

interface CategoryContentItem {
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    [key: string]: unknown;
}

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    imports: [
        GridListComponent,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatPaginatorModule,
        MatTooltip,
        NgComponentOutlet,
        PlaylistErrorViewComponent,
        TranslatePipe,
    ],
})
export class CategoryContentViewComponent implements OnInit {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly destroyRef = inject(DestroyRef);
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);
    private readonly catalog = inject(PORTAL_CATALOG_FACADE) as PortalCatalogFacade<
        CategoryContentItem,
        CategoryContentItem,
        CategoryContentItem
    >;

    readonly detailComponent = inject(PORTAL_CATALOG_DETAIL_COMPONENT);
    readonly contentType = this.catalog.contentType;
    readonly limit = this.catalog.limit;
    readonly pageIndex = this.catalog.pageIndex;
    readonly pageSizeOptions = Array.from(this.catalog.pageSizeOptions);
    readonly selectedCategory = this.catalog.selectedCategory;
    readonly paginatedContent = this.catalog.paginatedContent;
    readonly selectedCategoryTitle = this.catalog.selectedCategoryTitle;
    readonly categoryItemCount = this.catalog.categoryItemCount;
    readonly selectedItem = this.catalog.selectedItem;
    readonly totalPages = this.catalog.totalPages;
    readonly contentSortMode = this.catalog.contentSortMode;
    readonly isPaginatedContentLoading =
        this.catalog.isPaginatedContentLoading;
    readonly isXtreamLoadingSubtitle = computed(
        () =>
            this.catalog.provider === 'xtream' &&
            this.isPaginatedContentLoading()
    );
    readonly categoryItemSubtitle = computed(() => {
        if (this.isXtreamLoadingSubtitle()) {
            return this.translate.instant(
                'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
            );
        }

        const itemCount = this.categoryItemCount();
        return `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    });
    readonly canSortContent = computed(() => this.contentSortMode() !== null);
    readonly selectedDetailComponent = computed(() =>
        this.selectedItem() ? this.detailComponent : null
    );
    readonly contentWithProgress = computed(() =>
        (this.paginatedContent() ?? []).map((item: CategoryContentItem) => ({
            ...item,
            ...this.catalog.getItemProgress(item),
        }))
    );

    setContentSortMode(mode: PortalCatalogSortMode): void {
        this.catalog.setContentSortMode(mode);
    }

    ngOnInit(): void {
        this.activatedRoute.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                this.catalog.initialize(params.get('categoryId'));
                this.openStalkerItemFromNavigationState();
            });

        this.activatedRoute.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                this.catalog.setSearchQuery?.(params.get('q') ?? '');
            });
    }

    onPageChange(event: PageEvent): void {
        this.catalog.setPage(event.pageIndex);
        this.catalog.setLimit(event.pageSize);
    }

    onItemClick(item: CategoryContentItem): void {
        const navigation = this.catalog.selectItem(item);
        if (navigation?.length) {
            this.router.navigate(navigation, {
                relativeTo: this.activatedRoute,
            });
        }
    }

    private openStalkerItemFromNavigationState(): void {
        if (this.catalog.provider !== 'stalker') {
            return;
        }

        const item = getOpenStalkerItemState(window.history.state);
        if (!item) {
            return;
        }

        this.catalog.selectItem(item as CategoryContentItem);
        clearNavigationStateKeys([
            OPEN_STALKER_ITEM_STATE_KEY,
            'openFavoriteItem',
            'openRecentItem',
        ]);
    }
}
