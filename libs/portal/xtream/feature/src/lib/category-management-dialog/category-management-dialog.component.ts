import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe } from '@ngx-translate/core';
import { DatabaseService, XCategoryFromDb } from '@iptvnator/services';
import { createLogger } from '@iptvnator/portal/shared/util';

export interface CategoryManagementDialogData {
    playlistId: string;
    contentType: 'live' | 'vod' | 'series';
    itemCounts: Map<number, number>;
}

interface CategoryWithSelection extends XCategoryFromDb {
    selected: boolean;
}

@Component({
    selector: 'app-category-management-dialog',
    imports: [
        MatDialogModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslatePipe,
    ],
    templateUrl: './category-management-dialog.component.html',
    styleUrl: './category-management-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryManagementDialogComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly dialogRef = inject(
        MatDialogRef<CategoryManagementDialogComponent>
    );
    readonly data = inject<CategoryManagementDialogData>(MAT_DIALOG_DATA);
    private readonly logger = createLogger('CategoryManagementDialog');

    readonly isLoading = signal(true);
    readonly isSaving = signal(false);
    readonly categories = signal<CategoryWithSelection[]>([]);
    readonly searchTerm = signal('');

    readonly filteredCategories = computed(() => {
        const term = this.searchTerm().toLowerCase();
        if (!term) return this.categories();
        return this.categories().filter((c) =>
            c.name.toLowerCase().includes(term)
        );
    });

    readonly selectedCount = computed(
        () => this.categories().filter((c) => c.selected).length
    );

    readonly totalCount = computed(() => this.categories().length);

    readonly allSelected = computed(
        () =>
            this.categories().length > 0 &&
            this.categories().every((c) => c.selected)
    );

    readonly someSelected = computed(
        () => this.categories().some((c) => c.selected) && !this.allSelected()
    );

    async ngOnInit(): Promise<void> {
        await this.loadCategories();
    }

    private async loadCategories(): Promise<void> {
        try {
            const type = this.getDbType();
            const allCategories = await this.waitForCategories(type);
            this.categories.set(
                allCategories.map((c) => ({
                    ...c,
                    selected: !c.hidden,
                }))
            );
        } catch (error) {
            this.logger.error('Error loading categories', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    private async waitForCategories(
        type: 'live' | 'movies' | 'series'
    ): Promise<XCategoryFromDb[]> {
        const retryDeadlineMs = Date.now() + 10000;
        const expectedCategoryCount = this.data.itemCounts.size;

        while (true) {
            const categories = await this.dbService.getAllXtreamCategories(
                this.data.playlistId,
                type
            );

            if (
                categories.length > 0 ||
                expectedCategoryCount === 0 ||
                Date.now() >= retryDeadlineMs
            ) {
                return categories;
            }

            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }

    clearSearch(): void {
        this.searchTerm.set('');
    }

    getItemCount(category: CategoryWithSelection): number {
        const categoryId = Number(category.id);
        return this.data.itemCounts.get(categoryId) ?? 0;
    }

    private getDbType(): 'live' | 'movies' | 'series' {
        switch (this.data.contentType) {
            case 'live':
                return 'live';
            case 'vod':
                return 'movies';
            case 'series':
                return 'series';
        }
    }

    toggleCategory(category: CategoryWithSelection): void {
        this.categories.update((cats) =>
            cats.map((c) =>
                c.id === category.id ? { ...c, selected: !c.selected } : c
            )
        );
    }

    selectAll(): void {
        this.categories.update((cats) =>
            cats.map((c) => ({ ...c, selected: true }))
        );
    }

    deselectAll(): void {
        this.categories.update((cats) =>
            cats.map((c) => ({ ...c, selected: false }))
        );
    }

    toggleAll(): void {
        if (this.allSelected()) {
            this.deselectAll();
        } else {
            this.selectAll();
        }
    }

    async save(): Promise<void> {
        this.isSaving.set(true);
        try {
            const categories = this.categories();
            const toHide = categories.filter((c) => !c.selected).map((c) => c.id);
            const toShow = categories.filter((c) => c.selected).map((c) => c.id);

            if (toHide.length > 0) {
                await this.dbService.updateCategoryVisibility(toHide, true);
            }
            if (toShow.length > 0) {
                await this.dbService.updateCategoryVisibility(toShow, false);
            }

            this.dialogRef.close(true);
        } catch (error) {
            this.logger.error('Error saving category visibility', error);
            inject(MatSnackBar).open(
                'Failed to save category visibility',
                'Close',
                { duration: 3000 }
            );
        } finally {
            this.isSaving.set(false);
        }
    }

    cancel(): void {
        this.dialogRef.close(false);
    }
}
