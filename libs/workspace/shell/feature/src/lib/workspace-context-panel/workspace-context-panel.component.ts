import { Component, computed, DestroyRef, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { WorkspaceContextCategoryViewComponent } from './components/workspace-context-category-view.component';
import { WorkspaceContextErrorViewComponent } from './components/workspace-context-error-view.component';

type WorkspaceProvider = 'xtreams' | 'stalker' | 'playlists';

interface WorkspaceContextRoute {
    provider: WorkspaceProvider;
    playlistId: string;
}

interface XtreamCategoryLike {
    id?: number | string;
    category_id?: number | string;
}

@Component({
    selector: 'app-workspace-context-panel',
    imports: [
        MatIconButton,
        MatIcon,
        MatTooltip,
        TranslatePipe,
        WorkspaceContextCategoryViewComponent,
        WorkspaceContextErrorViewComponent,
    ],
    templateUrl: './workspace-context-panel.component.html',
    styleUrl: './workspace-context-panel.component.scss',
})
export class WorkspaceContextPanelComponent {
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly dialog = inject(MatDialog);
    private readonly destroyRef = inject(DestroyRef);

    readonly context = input.required<WorkspaceContextRoute>();
    readonly section = input.required<string>();

    readonly isXtreamCategories = computed(
        () =>
            this.context().provider === 'xtreams' &&
            (this.section() === 'vod' ||
                this.section() === 'series' ||
                this.section() === 'live')
    );
    readonly isStalkerCategories = computed(
        () =>
            this.context().provider === 'stalker' &&
            (this.section() === 'vod' ||
                this.section() === 'series' ||
                this.section() === 'itv')
    );

    readonly xtreamCategories = this.xtreamStore.getCategoriesBySelectedType;
    readonly xtreamCategoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly xtreamSelectedCategoryId = this.xtreamStore.selectedCategoryId;

    readonly stalkerCategories = this.stalkerStore.getCategoryResource;
    readonly stalkerSelectedCategoryId = this.stalkerStore.selectedCategoryId;
    readonly isStalkerCategoryLoading =
        this.stalkerStore.isCategoryResourceLoading;
    readonly isStalkerCategoryFailed =
        this.stalkerStore.isCategoryResourceFailed;
    readonly skeletonRows = Array.from({ length: 14 }, (_, index) => index);
    readonly skeletonLabelWidths = [
        78, 66, 74, 59, 83, 69, 76, 62, 81, 64, 72, 67, 79, 61,
    ];

    readonly title = computed(() => {
        if (this.isXtreamCategories()) {
            if (this.section() === 'vod') {
                return 'WORKSPACE.CONTEXT.MOVIE_CATEGORIES';
            }
            if (this.section() === 'series') {
                return 'WORKSPACE.CONTEXT.SERIES_CATEGORIES';
            }
            return 'WORKSPACE.CONTEXT.LIVE_CATEGORIES';
        }

        if (this.isStalkerCategories()) {
            if (this.section() === 'vod') {
                return 'WORKSPACE.CONTEXT.MOVIE_CATEGORIES';
            }
            if (this.section() === 'series') {
                return 'WORKSPACE.CONTEXT.SERIES_CATEGORIES';
            }
            return 'WORKSPACE.CONTEXT.LIVE_CATEGORIES';
        }

        return 'WORKSPACE.CONTEXT.CATEGORIES';
    });

    readonly subtitle = computed(() => {
        if (this.isXtreamCategories()) {
            return 'WORKSPACE.CONTEXT.XTREAM_SOURCE';
        }
        if (this.isStalkerCategories()) {
            return 'WORKSPACE.CONTEXT.STALKER_PORTAL';
        }
        return '';
    });

    openManageCategories(): void {
        const context = this.context();
        const section = this.section();
        const contentType =
            section === 'series'
                ? 'series'
                : section === 'live'
                  ? 'live'
                  : 'vod';

        void import('@iptvnator/portal/xtream/feature').then(
            ({ CategoryManagementDialogComponent }) => {
                const dialogRef = this.dialog.open(
                    CategoryManagementDialogComponent,
                    {
                        data: {
                            playlistId: context.playlistId,
                            contentType,
                            itemCounts: this.xtreamStore.getCategoryItemCounts(),
                        },
                        width: '500px',
                        maxHeight: '80vh',
                    }
                );

                dialogRef
                    .afterClosed()
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe((result) => {
                        if (result) {
                            this.xtreamStore.reloadCategories();
                        }
                    });
            }
        );
    }

    onXtreamCategoryClicked(category: XtreamCategoryLike): void {
        const context = this.context();
        const section = this.section();
        const rawCategoryId = category.category_id ?? category.id;
        if (rawCategoryId === undefined || rawCategoryId === null) {
            return;
        }
        const numericCategoryId = Number(rawCategoryId);
        if (Number.isNaN(numericCategoryId)) {
            return;
        }
        const categoryId = numericCategoryId;

        this.xtreamStore.setSelectedItem(null);
        this.xtreamStore.setSelectedCategory(categoryId);

        if (section === 'live') {
            return;
        }

        this.router.navigate([
            '/workspace',
            'xtreams',
            context.playlistId,
            section,
            categoryId,
        ]);
    }

    onStalkerCategoryClicked(item: { category_id?: string | number }): void {
        const context = this.context();
        const section = this.section();
        const categoryId = String(item.category_id ?? '*');

        this.stalkerStore.setSelectedCategory(categoryId);
        this.stalkerStore.setPage(0);
        this.stalkerStore.clearSelectedItem();

        if (section === 'itv') {
            return;
        }

        if (categoryId === '*') {
            this.router.navigate([
                '/workspace',
                'stalker',
                context.playlistId,
                section,
            ]);
            return;
        }

        this.router.navigate([
            '/workspace',
            'stalker',
            context.playlistId,
            section,
            categoryId,
        ]);
    }
}
