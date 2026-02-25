import { Component, computed, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { PlaylistErrorViewComponent } from '../xtream-electron/playlist-error-view/playlist-error-view.component';
import {
    CategoryManagementDialogComponent,
    CategoryManagementDialogData,
} from '../xtream-electron/category-management-dialog/category-management-dialog.component';
import { CategoryViewComponent } from '../xtream-electron/category-view/category-view.component';
import { XtreamStore } from '../xtream-electron/stores/xtream.store';
import { StalkerStore } from '../stalker/stalker.store';

type WorkspaceProvider = 'xtreams' | 'stalker' | 'playlists';

interface WorkspaceContextRoute {
    provider: WorkspaceProvider;
    playlistId: string;
}

interface XtreamCategoryLike {
    id?: number | string;
    category_id?: string;
}

@Component({
    selector: 'app-workspace-context-panel',
    imports: [
        CategoryViewComponent,
        MatIcon,
        MatIconButton,
        MatTooltip,
        PlaylistErrorViewComponent,
    ],
    templateUrl: './workspace-context-panel.component.html',
    styleUrl: './workspace-context-panel.component.scss',
})
export class WorkspaceContextPanelComponent {
    private readonly router = inject(Router);
    private readonly dialog = inject(MatDialog);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);

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
            if (this.section() === 'vod') return 'Movie Categories';
            if (this.section() === 'series') return 'Series Categories';
            return 'Live Categories';
        }

        if (this.isStalkerCategories()) {
            if (this.section() === 'vod') return 'Movie Categories';
            if (this.section() === 'series') return 'Series Categories';
            return 'Live Categories';
        }

        return 'Categories';
    });

    readonly subtitle = computed(() => {
        if (this.isXtreamCategories()) {
            return 'Xtream source';
        }
        if (this.isStalkerCategories()) {
            return 'Stalker portal';
        }
        return '';
    });

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

    openXtreamCategoryManagement(): void {
        const context = this.context();
        const section = this.section();
        if (!this.isXtreamCategories()) {
            return;
        }

        const contentType =
            section === 'series'
                ? 'series'
                : section === 'live'
                  ? 'live'
                  : 'vod';

        const dialogRef = this.dialog.open<
            CategoryManagementDialogComponent,
            CategoryManagementDialogData,
            boolean
        >(CategoryManagementDialogComponent, {
            data: {
                playlistId: context.playlistId,
                contentType,
                itemCounts: this.xtreamCategoryItemCounts(),
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
}
