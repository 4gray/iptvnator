import { NgOptimizedImage } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    standalone: true,
    imports: [
        MatCardModule,
        MatIcon,
        MatPaginatorModule,
        MatTooltip,
        NgOptimizedImage,
        TranslateModule,
    ],
})
export class CategoryContentViewComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);

    readonly limit = this.xtreamStore.limit;
    readonly pageSizeOptions = [5, 10, 25, 50, 100];
    readonly paginatedContent = this.xtreamStore.getPaginatedContent;
    readonly selectedCategory = this.xtreamStore.getSelectedCategory;
    readonly totalPages = this.xtreamStore.getTotalPages;

    onPageChange(event: PageEvent) {
        this.xtreamStore.setPage(event.pageIndex + 1);
        this.xtreamStore.setLimit(event.pageSize);
        localStorage.setItem('xtream-page-size', event.pageSize.toString());
    }

    onItemClick(item: any) {
        console.log(item);
        this.xtreamStore.setSelectedItem(item);
        this.router.navigate([item.xtream_id], {
            relativeTo: this.activatedRoute,
        });
    }
}
